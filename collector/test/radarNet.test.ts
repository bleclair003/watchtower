// @vitest-environment node
/** Cloudflare Radar route hijacks, leaks and DDoS (v0.70.0). Networks use private-use AS numbers and documentation prefixes. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { radarIso } from '../../shared/domain/netAttacks.ts';
import { parseDaily, parseHijacks, parseLeaks, radarBgp, radarDdos, scoreDdos, type BgpState, type DdosState } from '../adapters/radarNet.ts';
import { validateEvent } from '../lib/validate.ts';
import type { FetchResult } from '../lib/http.ts';

const NOW = Date.parse('2026-11-24T06:00:00Z');
const ok = (o: unknown): FetchResult => {
  const body = JSON.stringify(o);
  return { kind: 'ok', status: 200, body, validators: {}, bytes: body.length };
};
const asnInfo = [
  { asn: 64512, country_code: 'RU', org_name: 'Test Transit' },
  { asn: 64513, country_code: 'UA', org_name: 'Test Telecom' },
  { asn: 64514, country_code: 'DE', org_name: 'Test Hosting' },
  { asn: 64515, country_code: 'FR', org_name: 'Test Carrier' },
];
const hijack = (id: number, hijacker: number, country: string, victims: number[], victimCountries: string[]) => ({
  id, confidence_score: 9, min_hijack_ts: '2026-11-24T01:00:00', max_hijack_ts: '2026-11-24T03:00:00', hijacker_asn: hijacker, hijacker_country: country,
  victim_asns: victims, victim_countries: victimCountries, prefixes: ['192.0.2.0/24', 'not-a-prefix'], is_stale: false, tags: [{ name: 'test', score: 1 }],
});

beforeEach(() => {
  process.env.CLOUDFLARE_RADAR_TOKEN = 'test-token';
});
afterEach(() => {
  delete process.env.CLOUDFLARE_RADAR_TOKEN;
});

const urlsBefore = (u: string[]) => u.length;

describe('routing events', () => {
  it('parses hijacks and leaks with network names from asn_info', () => {
    const [h] = parseHijacks({ asn_info: asnInfo, events: [hijack(1, 64512, 'RU', [64513], ['UA'])] });
    expect(h).toMatchObject({ id: 1, from: '2026-11-24T01:00:00.000Z', confidence: 9, hijacker: { asn: 64512, org: 'Test Transit', country: 'RU' }, victims: [{ asn: 64513, org: 'Test Telecom', country: 'UA' }], prefixes: ['192.0.2.0/24'], prefixCount: 1 });
    const [l] = parseLeaks({ asn_info: asnInfo, events: [{ id: 7, detected_ts: '2026-11-24T02:00:00Z', leak_asn: 64514, countries: ['de', 'IR'], prefix_count: 340, origin_count: 3, peer_count: 2, finished: true }] });
    expect(l).toMatchObject({ id: 7, leaker: { asn: 64514, country: 'DE' }, countries: ['DE', 'IR'], prefixCount: 340, finished: true });
    expect(parseHijacks({ events: [{ id: 'x' }] })).toEqual([]);
    expect(radarIso('2026-11-24T01:00:00')).toBe('2026-11-24T01:00:00.000Z');
    expect(radarIso('nonsense')).toBeNull();
  });

  it('keeps only events involving watch-region countries, records them, and reads hourly', async () => {
    const urls: string[] = [];
    const headers: Record<string, string>[] = [];
    const fetch = async (u: string, _v?: unknown, h?: Record<string, string>) => {
      urls.push(u);
      headers.push(h ?? {});
      if (u.includes('/hijacks/')) {
        return ok({ success: true, result: { asn_info: asnInfo, events: [hijack(1, 64512, 'RU', [64513], ['UA']), hijack(2, 64514, 'DE', [64515], ['FR']), hijack(3, 64513, 'UA', [64513], ['UA'])] }, result_info: { total_count: 3 } });
      }
      return ok({
        success: true,
        result: {
          asn_info: asnInfo,
          events: [
            { id: 7, detected_ts: '2026-11-24T02:00:00Z', leak_asn: 64514, countries: ['IR'], prefix_count: 340, origin_count: 3, peer_count: 2, finished: true },
            { id: 8, detected_ts: '2026-11-24T02:00:00Z', leak_asn: 64514, countries: ['FR'], prefix_count: 3, origin_count: 1, peer_count: 1, finished: true },
          ],
        },
        result_info: { total_count: 2 },
      });
    };
    const r = await radarBgp.collect({ now: NOW, state: null, fetch });
    expect(urls[0]).toContain('/radar/bgp/hijacks/events?dateRange=7d&minConfidence=8');
    expect(urls[0]).toContain('&page=1&per_page=100');
    expect(headers[0]).toEqual({ Authorization: 'Bearer test-token' });
    expect(r.state.hijacks.map((h) => h.id).sort()).toEqual([1, 3]);
    // Cross-border between watch-region countries is notable; within one country is routine.
    expect(r.events.find((e) => e.metadata?.radarId === 1)?.metadata?.routine).toBe(false);
    expect(r.events.find((e) => e.metadata?.radarId === 3)?.metadata?.routine).toBe(true);
    expect(r.state.leaks.map((l) => l.id)).toEqual([7]);
    const hj = r.events.find((e) => e.metadata?.radarId === 1)!;
    expect(hj.title).toBe('Route hijack: AS64512 Test Transit (RU) announced 1 address block of AS64513 Test Telecom (UA)');
    expect(hj).toMatchObject({ countryCodes: ['RU', 'UA'], regionIds: ['eastern-europe'], category: 'cyber', sourceUrl: 'https://radar.cloudflare.com/as64512' });
    expect(validateEvent(hj, NOW)).toBeNull();
    const lk = r.events.find((e) => e.metadata?.subtype === 'bgp-leak')!;
    expect(lk).toMatchObject({ countryCodes: ['IR'], regionIds: ['middle-east'] });
    expect(lk.metadata?.routine).toBe(false);
    expect(validateEvent(lk, NOW)).toBeNull();
    const again = await radarBgp.collect({ now: NOW + 10 * 60_000, state: r.state, fetch });
    expect(again.notModified).toBe(true);
    // State from the first version (no recordsVersion) re-reads 7 days at once to rewrite its records.
    const { recordsVersion: _v, ...legacy } = r.state;
    const n = urlsBefore(urls);
    const redo = await radarBgp.collect({ now: NOW + 10 * 60_000, state: legacy, fetch });
    expect(redo.notModified).toBe(false);
    expect(urls[n]).toContain('dateRange=7d');
  });

  it('follows pages and drops events older than 7 days from the kept list', async () => {
    const many = Array.from({ length: 100 }, (_, i) => hijack(100 + i, 64512, 'RU', [64513], ['UA']));
    const urls: string[] = [];
    const fetch = async (u: string) => {
      urls.push(u);
      if (u.includes('/hijacks/') && u.includes('page=1&')) return ok({ success: true, result: { asn_info: asnInfo, events: many }, result_info: { total_count: 101 } });
      if (u.includes('/hijacks/')) return ok({ success: true, result: { asn_info: asnInfo, events: [hijack(999, 64512, 'RU', [64513], ['UA'])] }, result_info: { total_count: 101 } });
      return ok({ success: true, result: { events: [] }, result_info: { total_count: 0 } });
    };
    const old: BgpState = { hijacks: [{ ...parseHijacks({ events: [hijack(5, 64512, 'RU', [], [])] })[0], from: '2026-11-10T00:00:00.000Z' }], leaks: [], fetchedAt: '2026-11-24T04:00:00.000Z', firstRunAt: '2026-11-20T00:00:00.000Z', recordsVersion: 2 };
    const r = await radarBgp.collect({ now: NOW, state: old, fetch });
    expect(urls.filter((u) => u.includes('/hijacks/'))).toHaveLength(2);
    expect(urls[0]).toContain('dateRange=2d');
    expect(r.state.hijacks).toHaveLength(101);
    expect(r.state.hijacks.some((h) => h.id === 5)).toBe(false);
  });

  it('fails clearly without the token or on an API error', async () => {
    delete process.env.CLOUDFLARE_RADAR_TOKEN;
    await expect(radarBgp.collect({ now: NOW, state: null, fetch: async () => ok({}) })).rejects.toThrow(/CLOUDFLARE_RADAR_TOKEN is not set/);
    process.env.CLOUDFLARE_RADAR_TOKEN = 'test-token';
    await expect(radarBgp.collect({ now: NOW, state: null, fetch: async () => ok({ success: false, errors: [{ message: 'bad param' }] }) })).rejects.toThrow(/bad param/);
  });
});

describe('DDoS levels', () => {
  const series = (last: number, today = true) => {
    const ts: string[] = [];
    const vs: string[] = [];
    for (let d = 28; d >= (today ? 0 : 1); d--) {
      ts.push(new Date(Date.parse('2026-11-24T00:00:00Z') - d * 86_400_000).toISOString());
      vs.push(String(d === 1 ? last : d === 0 ? 0.99 : 0.2 + (d % 3) / 100));
    }
    return { serie_0: { timestamps: ts, values: vs }, meta: { normalization: 'MIN0_MAX' } };
  };

  it("reads daily values without today's partial day and scores the last day", () => {
    const { days, values } = parseDaily(series(0.9), NOW);
    expect(days).toHaveLength(28);
    expect(days.at(-1)).toBe('2026-11-23');
    const c = scoreDdos('IL', days, values)!;
    expect(c).toMatchObject({ country: 'IL', day: '2026-11-23', latest: 0.9, peakShare: 1, peakDay: '2026-11-23' });
    // Spiky series: a quiet day is a small share of the peak, whatever the median.
    const quiet = scoreDdos('UA', ['a', 'b', 'c', 'd'], [0, 1, 0, 0.1])!;
    expect(quiet).toMatchObject({ peakShare: 0.1, peakDay: 'b', activeDays: 2 });
    expect(scoreDdos('IL', [], [])).toBeNull();
  });

  it('records a surge once a day, asks for attacks by target, and tolerates countries without data', async () => {
    const urls: string[] = [];
    const fetch = async (u: string) => {
      urls.push(u);
      if (u.includes('location=IL&')) return ok({ success: true, result: series(0.9) });
      if (u.includes('location=KP&')) return ok({ success: false, errors: [{ message: 'no data' }] });
      return ok({ success: true, result: series(0.05) });
    };
    const r = await radarDdos.collect({ now: NOW, state: null, fetch });
    expect(urls[0]).toMatch(/\/radar\/attacks\/layer3\/timeseries\?location=[A-Z]{2}&direction=TARGET&dateRange=29d&aggInterval=1d&format=JSON/);
    expect(r.events.map((e) => e.countryCodes[0])).toEqual(['IL']);
    const ev = r.events[0];
    expect(ev.title).toBe('DDoS surge: biggest day of attacks on targets in IL in 28 days (2026-11-23)');
    expect(ev.metadata).toMatchObject({ routine: false, peakShare: 1 });
    expect(ev.regionIds).toEqual(['middle-east']);
    expect(validateEvent(ev, NOW)).toBeNull();
    expect(r.state.noData).toContain('KP');
    expect(r.state.day).toBe('2026-11-23');
    const later = await radarDdos.collect({ now: NOW + 3 * 3_600_000, state: r.state as DdosState, fetch });
    expect(later.notModified).toBe(true);
  });

  it('re-reads once to rewrite records the first version made under its median rule', async () => {
    const fetch = async (u: string) => ok({ success: true, result: series(u.includes('location=IL&') ? 0.9 : 0.05) });
    const legacy = { fetchedAt: '2026-11-24T01:00:00.000Z', day: '2026-11-23', noData: [], countries: [{ country: 'KR', day: '2026-11-23', score: 77, ratio: 115 }] } as unknown as DdosState;
    const r = await radarDdos.collect({ now: NOW, state: legacy, fetch });
    expect(r.notModified).toBe(false);
    const kr = r.events.find((e) => e.countryCodes[0] === 'KR')!;
    expect(kr.metadata).toMatchObject({ routine: true, revisionKey: 'v2:true' });
    expect(r.events.find((e) => e.countryCodes[0] === 'IL')?.metadata?.routine).toBe(false);
    expect(r.state.recordsVersion).toBe(2);
  });
});
