// @vitest-environment node
/** Phase 19: space weather — CME Earth arrivals (NASA DONKI), NOAA scales, Kp and messages, the meter. */
import { describe, expect, it } from 'vitest';
import { gFromKp, isNotableMessage, parseSwpcMessage, type SpaceWeatherSnapshot } from '../../shared/domain/spaceWeather.ts';
import { arrivalRecords, earthArrivals, nasaDonki, parseKp, parseScales } from '../adapters/spaceWeather.ts';
import { spaceWeatherMeter } from '../../shared/domain/meters/spaceWeatherMeter.ts';
import { upcomingCalendar } from '../../shared/domain/meters/clocks.ts';
import type { FetchResult } from '../lib/http.ts';

const NOW = Date.parse('2026-11-21T23:30:00Z');
const iso = (t: number) => new Date(t).toISOString();
const H = 3_600_000;

const sim = (id: string, cme: string, arrival: string | null, run: string, extra: Record<string, unknown> = {}) => ({
  simulationID: id, modelCompletionTime: run, estimatedShockArrivalTime: arrival, isEarthGB: true, kp_90: 2, kp_180: 4, link: `https://ccmc.example/${id}`,
  cmeInputs: [{ CMEID: cme, cmeStartTime: '2026-11-19T08:09Z', speed: 360 }], ...extra,
});

describe('CME arrivals (NASA DONKI)', () => {
  it('keeps the latest model run per CME with an Earth arrival, with the analysed speed', () => {
    const arrivals = earthArrivals(
      [sim('A/1', 'CME-1', '2026-11-22T18:00Z', '2026-11-19T10:00Z'), sim('A/2', 'CME-1', '2026-11-23T00:00Z', '2026-11-19T13:15Z'), sim('B/1', 'CME-2', null, '2026-11-20T00:00Z'), sim('C/1', 'CME-3', '2026-11-15T00:00Z', '2026-11-13T00:00Z')],
      [{ associatedCMEID: 'CME-1', speed: 364 }],
      NOW,
    );
    expect(arrivals).toEqual([{ cmeId: 'CME-1', start: '2026-11-19T08:09:00.000Z', speed: 364, arrival: '2026-11-23T00:00:00.000Z', glancing: true, kpLow: 2, kpHigh: 4, modelRunAt: '2026-11-19T13:15:00.000Z', url: 'https://ccmc.example/A/2' }]);
    const [r] = arrivalRecords(arrivals, iso(NOW));
    expect(r.title).toBe('CME expected to reach Earth ~23/11 00:00 UTC (glancing blow), model Kp 2–4');
    expect(r.locationPrecision).toBe('none');
    // A revised arrival 6+ hours away is a new record; a small revision is not.
    expect(arrivalRecords([{ ...arrivals[0], arrival: '2026-11-23T03:00:00.000Z' }], iso(NOW))[0].id).toBe(r.id);
    expect(arrivalRecords([{ ...arrivals[0], arrival: '2026-11-23T08:00:00.000Z' }], iso(NOW))[0].id).not.toBe(r.id);
  });

  it('sends the api.data.gov key as a header, never in the URL, and reads every 2 hours', async () => {
    process.env.CONGRESS_API_KEY = 'test-key';
    const seen: { url: string; headers?: Record<string, string> }[] = [];
    const ok = (body: unknown): FetchResult => ({ kind: 'ok', status: 200, body: JSON.stringify(body), validators: {}, bytes: 1 });
    const res = await nasaDonki.collect({
      now: NOW,
      state: null,
      fetch: async (url, _v, headers) => {
        seen.push({ url, headers });
        return ok(url.includes('WSAEnlil') ? [sim('A/2', 'CME-1', '2026-11-23T00:00Z', '2026-11-19T13:15Z')] : url.includes('GST') ? [{ gstID: 'G1', startTime: '2026-11-20T03:00Z', allKpIndex: [{ kpIndex: 6.33 }], link: 'https://g' }] : []);
      },
    });
    delete process.env.CONGRESS_API_KEY;
    expect(seen.every((s) => !s.url.includes('test-key') && s.headers?.['X-Api-Key'] === 'test-key')).toBe(true);
    expect(res.events.map((e) => e.title)).toEqual(['CME expected to reach Earth ~23/11 00:00 UTC (glancing blow), model Kp 2–4', 'Geomagnetic storm G2 (Kp 6.33) from 20/11 03:00 UTC']);
    const again = await nasaDonki.collect({ now: NOW + H, state: res.state!, fetch: async () => ok([]) });
    expect(again.notModified).toBe(true);
  });
});

describe('NOAA SWPC', () => {
  it('reads current scales and the three-day outlook', () => {
    const body = {
      '0': { DateStamp: '2026-11-21', R: { Scale: '0' }, S: { Scale: '0' }, G: { Scale: '1' } },
      '1': { DateStamp: '2026-11-21', R: { Scale: null, MinorProb: '10', MajorProb: '1' }, S: { Scale: null, Prob: '1' }, G: { Scale: '2' } },
    };
    expect(parseScales(body)).toEqual({ now: { r: 0, s: 0, g: 1 }, forecast: [{ date: '2026-11-21', rMinor: 10, rMajor: 1, s: 1, g: 2 }] });
  });

  it('reads the K-index (latest and 24-hour max)', () => {
    const rows = [{ time_tag: '2026-11-21T03:00:00', Kp: 2.67 }, { time_tag: '2026-11-21T18:00:00', Kp: 1.33 }, { time_tag: '2026-11-20T00:00:00', Kp: 7 }];
    expect(parseKp(rows.slice(0, 2), NOW)).toEqual({ latest: 1.33, at: '2026-11-21T18:00:00.000Z', max24h: 2.67 });
    expect(gFromKp(6.33)).toBe(2);
    expect(gFromKp(4.67)).toBe(0);
  });

  it('parses messages and keeps only notable ones', () => {
    const msg = (headline: string, body = '') => parseSwpcMessage({ product_id: 'X', issue_datetime: '2026-11-21 10:00:00.000', message: `Space Weather Message Code: WATA30\r\nSerial Number: 1234\r\nIssue Time: 2026 Nov 21 1000 UTC\r\n\r\n${headline}\r\n${body}` })!;
    const g2 = msg('WATCH: Geomagnetic Storm Category G2 Predicted', 'NOAA Scale: G2 - Moderate\nCME passage expected.');
    expect([g2.code, g2.serial, g2.issued, g2.scale, g2.mentionsCme]).toEqual(['WATA30', '1234', '2026-11-21T10:00:00.000Z', 'G2', true]);
    expect(isNotableMessage(g2)).toBe(true);
    expect(isNotableMessage(msg('WARNING: Geomagnetic K-index of 4 expected'))).toBe(false);
    expect(isNotableMessage(msg('ALERT: Geomagnetic K-index of 6'))).toBe(true);
    expect(isNotableMessage(msg('ALERT: X-Ray Flux exceeded M5', 'NOAA Scale: R2 - Moderate'))).toBe(false);
    expect(isNotableMessage(msg('ALERT: X-Ray Flux exceeded X1', 'NOAA Scale: R3 - Strong'))).toBe(true);
    expect(isNotableMessage(msg('CANCEL WATCH: Geomagnetic Storm Category G2', 'NOAA Scale: G2'))).toBe(false);
  });
});

describe('space weather meter and calendar', () => {
  const base: SpaceWeatherSnapshot = { fetchedAt: iso(NOW), now: { r: 0, s: 0, g: 0 }, forecast: [], kp: { latest: 1.33, at: iso(NOW), max24h: 2 }, arrivals: [], cmes7d: 18, fastest7d: 981, storms: [], messages: [] };
  const input = (sw: SpaceWeatherSnapshot) => ({ now: NOW, events: [], historyStart: null, sourceStatus: [], regionScores: [], scoreHistory: [], spaceWeather: sw });
  const arrival = { cmeId: 'CME-1', start: null, speed: 800, arrival: iso(NOW + 24 * H), glancing: false, kpLow: 5, kpHigh: 7, modelRunAt: null, url: 'https://x' };

  it('takes the highest of current storms, forecast and CMEs due within 72 hours', () => {
    expect(spaceWeatherMeter(input(base)).label).toBe('QUIET');
    expect(spaceWeatherMeter(input({ ...base, now: { r: 0, s: 0, g: 2 } })).label).toBe('GUARDED');
    expect(spaceWeatherMeter(input({ ...base, forecast: [{ date: 'x', rMinor: 1, rMajor: 1, s: 1, g: 3 }] })).label).toBe('GUARDED'); // forecast one step lower
    const due = spaceWeatherMeter(input({ ...base, arrivals: [arrival] }));
    expect(due.label).toBe('ELEVATED'); // model Kp 7 = G3
    expect(due.reading).toContain('CME expected at Earth');
    expect(spaceWeatherMeter(input({ ...base, arrivals: [{ ...arrival, kpLow: null, kpHigh: null, glancing: true }] })).label).toBe('LOW');
    expect(spaceWeatherMeter(input({ ...base, arrivals: [{ ...arrival, arrival: iso(NOW + 100 * H) }] })).label).toBe('QUIET'); // beyond 72 h
  });

  it('puts predicted arrivals on the calendar', () => {
    const cal = upcomingCalendar({ ...input({ ...base, arrivals: [arrival] }) });
    expect(cal.find((c) => c.source === 'NASA DONKI (WSA-Enlil)')?.title).toBe('CME expected at Earth, model Kp up to 7 (±7 h)');
  });
});
