// @vitest-environment node
/**
 * Free-key sources. No live key exists in the repository, so these tests use SYNTHETIC
 * responses built to the documented formats (FIRMS area CSV, Cloudflare Radar annotations).
 * They test WATCHTOWER's logic, not the providers; the adapters are verified live separately.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FetchResult } from '../lib/http.ts';
import { firms, parseFirmsCsv, cellId, FIRMS_KEY_ENV, type FirmsState } from '../adapters/firms.ts';
import { cloudflareRadarOutages, RADAR_TOKEN_ENV } from '../adapters/cloudflareRadar.ts';
import { redactSecrets, registerSecret } from '../lib/secrets.ts';
import { validateEvent } from '../lib/validate.ts';
import { INDICATOR_CATALOG } from '../../shared/domain/indicators/catalog.ts';
import { evaluateIndicator } from '../../shared/domain/indicators/evaluate.ts';

const NOW = Date.parse('2026-11-21T06:00:00Z');
const ok = (body: string): FetchResult => ({ kind: 'ok', status: 200, body, bytes: body.length, validators: {} });
const HEAD = 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight';
const row = (lat: number, lon: number, date: string, conf = 'n', frp = 5, time = '1030') =>
  `${lat},${lon},330.1,0.4,0.4,${date},${time},N20,VIIRS,${conf},2.0NRT,290.2,${frp},D`;

afterEach(() => {
  delete process.env[FIRMS_KEY_ENV];
  delete process.env[RADAR_TOKEN_ENV];
});

describe('secret redaction', () => {
  it('removes registered keys from any text', () => {
    registerSecret('abc123SECRETkey');
    expect(redactSecrets('GET https://x/api/area/csv/abc123SECRETkey/VIIRS failed')).toBe('GET https://x/api/area/csv/[redacted]/VIIRS failed');
  });
});

describe('NASA FIRMS adapter (synthetic CSV)', () => {
  it('parses by header name and rejects unknown layouts', () => {
    expect(parseFirmsCsv(`${HEAD}\n${row(48.5, 35.1, '2026-11-20')}`)).toHaveLength(1);
    expect(() => parseFirmsCsv('Invalid MAP_KEY.')).toThrow(/unexpected response/);
    expect(() => parseFirmsCsv('latitude,longitude\n1,2')).toThrow(/column "acq_date" missing/);
  });

  it('reports only NEW clusters of usable detections, at a real detection point', async () => {
    process.env[FIRMS_KEY_ENV] = 'firmsTESTkey123';
    const csv = [
      HEAD,
      // Cell A: burning on both days → persistent, not reported.
      row(48.51, 35.11, '2026-11-19'), row(48.52, 35.12, '2026-11-19'), row(48.51, 35.11, '2026-11-20'), row(48.52, 35.12, '2026-11-20'), row(48.53, 35.13, '2026-11-20'),
      // Cell B: new on the 20th with 3 usable detections → reported; strongest is the point.
      row(47.81, 37.61, '2026-11-20', 'h', 40), row(47.82, 37.62, '2026-11-20', 'n', 10), row(47.83, 37.63, '2026-11-20', 'n', 12),
      // Cell C: only 2 usable + 1 low-confidence → not reported.
      row(46.01, 33.01, '2026-11-20'), row(46.02, 33.02, '2026-11-20'), row(46.03, 33.03, '2026-11-20', 'l'),
    ].join('\n');
    const calls: string[] = [];
    const fetch = vi.fn(async (url: string) => {
      calls.push(url);
      return ok(url.includes('19,43.5,41,57.5') ? csv : HEAD);
    });
    const r = await firms.collect({ now: NOW, state: null, fetch });
    expect(r.events).toHaveLength(1);
    const e = r.events[0];
    expect([e.latitude, e.longitude]).toEqual([47.81, 37.61]);
    expect(e.regionIds).toEqual(['eastern-europe']);
    expect(e.countryCodes).toEqual(['UA']);
    expect(e.metadata).toMatchObject({ detections: 3, subtype: 'thermal-anomaly-cluster', frpTotalMw: 62 });
    expect(e.summary).toMatch(/cannot tell which/);
    expect(e.sourceUrl).not.toContain('firmsTESTkey123');
    expect(JSON.stringify(r.state)).not.toContain('firmsTESTkey123');
    expect(validateEvent(e, NOW)).toBeNull();
    // One request per geographic watch area (6), 5 days on the first run.
    expect(calls).toHaveLength(6);
    expect(calls.every((u) => u.endsWith('/5'))).toBe(true);
  });

  it('drops clusters inside the watch box but outside the region\'s countries (north-east China in the Korea box)', async () => {
    process.env[FIRMS_KEY_ENV] = 'firmsTESTkey123';
    const csv = [HEAD, row(35.5, 129.0, '2026-11-19', 'n', 1, '0100'), row(42.99, 126.24, '2026-11-20'), row(42.98, 126.24, '2026-11-20'), row(42.98, 126.23, '2026-11-20'),
      row(39.03, 125.75, '2026-11-20'), row(39.04, 125.76, '2026-11-20'), row(39.03, 125.76, '2026-11-20')].join('\n');
    const r = await firms.collect({ now: NOW, state: null, fetch: vi.fn(async (u: string) => ok(u.includes('124,33,131,43') ? csv : HEAD)) });
    expect(r.events.map((e) => e.countryCodes[0])).toEqual(['KP']);
  });

  it('assigns Crimea to Ukraine and says so', async () => {
    process.env[FIRMS_KEY_ENV] = 'firmsTESTkey123';
    const csv = [HEAD, row(50.0, 30.0, '2026-11-19', 'n', 1), row(44.951, 34.1, '2026-11-20'), row(44.952, 34.1, '2026-11-20'), row(44.953, 34.1, '2026-11-20')].join('\n');
    const r = await firms.collect({ now: NOW, state: null, fetch: vi.fn(async (u: string) => ok(u.includes('19,43.5,41,57.5') ? csv : HEAD)) });
    expect(r.events[0].countryCodes).toEqual(['UA']);
    expect(r.events[0].metadata!.countryBasis).toMatch(/Crimea assigned to UA/);
  });

  it('uses stored history on later runs', async () => {
    process.env[FIRMS_KEY_ENV] = 'firmsTESTkey123';
    const state: FirmsState = { cellDays: { [cellId(47.81, 37.61)]: ['2026-11-17'] }, firstRunAt: 'x' };
    const csv = [HEAD, row(47.81, 37.61, '2026-11-21'), row(47.82, 37.62, '2026-11-21'), row(47.83, 37.63, '2026-11-21')].join('\n');
    const r = await firms.collect({ now: NOW, state, fetch: vi.fn(async (u: string) => ok(u.includes('19,43.5,41,57.5') ? csv : HEAD)) });
    expect(r.events).toHaveLength(0); // fire in the cell 4 days earlier → not new
  });

  it('refuses to run without a key', async () => {
    await expect(firms.collect({ now: NOW, state: null, fetch: vi.fn() })).rejects.toThrow(/FIRMS_MAP_KEY is not set/);
  });
});

describe('Cloudflare Radar outages (synthetic response)', () => {
  const body = JSON.stringify({
    success: true,
    result: {
      annotations: [
        {
          id: 'syn-1',
          description: 'SYNTHETIC: nationwide shutdown during exams',
          startDate: '2026-11-20T03:00:00Z',
          endDate: '2026-11-20T07:00:00Z',
          locations: ['IQ'],
          locationsDetails: [{ code: 'IQ', name: 'Iraq' }],
          asns: [],
          linkedUrl: 'https://example.org/report',
          outage: { outageCause: 'GOVERNMENT_DIRECTED', outageType: 'NATIONWIDE' },
          scope: null,
        },
        {
          id: 'syn-2',
          description: 'SYNTHETIC: cable damage',
          startDate: '2026-11-19T10:00:00Z',
          locations: ['YE'],
          locationsDetails: [{ code: 'YE', name: 'Yemen' }],
          outage: { outageCause: 'CABLE_CUT', outageType: 'NATIONWIDE' },
        },
        { description: 'no id' },
      ],
    },
  });

  it('sends the token only in the Authorization header and keeps Cloudflare’s cause', async () => {
    process.env[RADAR_TOKEN_ENV] = 'radarTESTtoken456';
    const fetch = vi.fn(async () => ok(body));
    const r = await cloudflareRadarOutages.collect({ now: NOW, state: null, fetch });
    const [url, , headers] = fetch.mock.calls[0] as unknown as [string, unknown, Record<string, string>];
    expect(url).not.toContain('radarTESTtoken456');
    expect(headers.Authorization).toBe('Bearer radarTESTtoken456');
    expect(r.events).toHaveLength(2);
    expect(r.rejected).toHaveLength(1);
    const iq = r.events.find((e) => e.countryCodes[0] === 'IQ')!;
    expect(iq).toMatchObject({ category: 'unrest', regionIds: ['middle-east'], locationPrecision: 'country' });
    expect(iq.title).toBe('Internet outage — Iraq: government-directed shutdown (nationwide)');
    expect(iq.summary).toMatch(/Cloudflare's attributed cause/);
    expect(r.events.every((e) => validateEvent(e, NOW) === null)).toBe(true);
    expect(JSON.stringify(r)).not.toContain('radarTESTtoken456');
  });

  it('the attributed-outage indicator fires on government-directed shutdowns only', async () => {
    process.env[RADAR_TOKEN_ENV] = 'radarTESTtoken456';
    const r = await cloudflareRadarOutages.collect({ now: NOW, state: null, fetch: vi.fn(async () => ok(body)) });
    const iso = (t: number) => new Date(t).toISOString();
    const status = [
      {
        sourceId: 'cloudflare-radar-outages', health: 'ONLINE' as const, lastAttemptAt: iso(NOW - 6e5), lastSuccessAt: iso(NOW - 6e5),
        firstSuccessAt: iso(NOW - 864e5), lastNewItemAt: null, consecutiveFailures: 0, parseErrors: 0, lastError: null,
      },
    ];
    const me = INDICATOR_CATALOG.find((d) => d.id === 'middle-east.outage-attributed')!;
    const rs = INDICATOR_CATALOG.find((d) => d.id === 'red-sea.outage-attributed')!;
    expect(evaluateIndicator(me, r.events, status, NOW).state).toBe('TRIGGERED');
    expect(evaluateIndicator(rs, r.events, status, NOW).state).toBe('NORMAL'); // cable cut is not a shutdown
  });
});
