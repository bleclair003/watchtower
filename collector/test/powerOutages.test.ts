// @vitest-environment node
/** Phase 16: power outages — ODIN (US) and the per-region power-outage meter. */
import { describe, expect, it } from 'vitest';
import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import type { MeterInput } from '../../shared/domain/meters/input.ts';
import { isPowerHeadline, outerRings, packRings, simplifyRing, unpackRings, type PowerOutageSnapshot } from '../../shared/domain/powerOutages.ts';
import { buildOutageSnapshot, odinPowerOutages, outageEvents, stepOf, ODIN_MAP_URL, ODIN_STATUS_URL } from '../adapters/odin.ts';
import { powerOutageMeter } from '../../shared/domain/meters/power.ts';
import type { FetchResult } from '../lib/http.ts';

const NOW = Date.parse('2026-11-21T22:30:00Z');
const iso = (t: number) => new Date(t).toISOString();
const square = (x: number, y: number, d = 0.5) => ({ type: 'Polygon', coordinates: [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]] });
const row = (fips: string, county: string, state: string, out: number, utility = 'Demo Utility') => ({
  id: fips, countyName: county, stateName: state, metersOut: out, outages: [{ utilityName: utility, metersOut: out }], feature: square(-95, 30),
});

describe('ODIN snapshot', () => {
  it('sums counties into states, keeps only mapped counties above the floor, and counts reporting utilities', () => {
    const snap = buildOutageSnapshot(
      [row('48201', 'Harris', 'Texas', 30_000, 'CenterPoint'), row('48157', 'Fort Bend', 'Texas', 2_000, 'CenterPoint'), row('12057', 'Hillsborough', 'Florida', 40), { id: 'bad', metersOut: 5 }],
      [{ totalOutages: 3, hasError: false }, { totalOutages: 0, hasError: false }, { totalOutages: 1, hasError: true }],
      iso(NOW),
    );
    expect(snap.totalOut).toBe(32_040);
    expect(snap.states.map((s) => [s.name, s.out, s.counties])).toEqual([['Texas', 32_000, 2], ['Florida', 40, 1]]);
    expect(snap.states[0].top).toEqual([{ name: 'CenterPoint', out: 32_000 }]);
    expect(snap.counties.map((c) => c.name)).toEqual(['Harris', 'Fort Bend']); // Hillsborough is under 50
    expect(unpackRings(snap.counties[0].path)[0]).toHaveLength(5);
    expect(snap.utilitiesReporting).toBe(2);
    expect(snap.utilitiesWithOutages).toBe(1);
  });

  it('records a state once per day per step reached (25k, 100k …)', () => {
    expect(stepOf(24_999)).toBe(0);
    expect(stepOf(25_000)).toBe(25_000);
    expect(stepOf(130_000)).toBe(100_000);
    const snap = buildOutageSnapshot([row('48201', 'Harris', 'Texas', 130_000)], [], iso(NOW));
    const [e] = outageEvents(snap, iso(NOW));
    expect(e.title).toBe('Power outages — Texas: 130,000 customers without power (1 county)');
    expect(e.regionIds).toEqual(['united-states']);
    expect(e.metadata?.usStates).toEqual(['TX']);
    expect(e.locationPrecision).toBe('region');
    expect(e.latitude).toBeUndefined();
    const again = outageEvents(buildOutageSnapshot([row('48201', 'Harris', 'Texas', 140_000)], [], iso(NOW + 3_600_000)), iso(NOW + 3_600_000))[0];
    expect(again.id).toBe(e.id); // same state, day and step: not recorded twice
  });

  it('fetches both endpoints and returns the snapshot as state', async () => {
    const ok = (body: unknown): FetchResult => ({ kind: 'ok', status: 200, body: JSON.stringify(body), validators: {}, bytes: 1 });
    const res = await odinPowerOutages.collect({
      now: NOW,
      state: null,
      fetch: async (url) => (url === ODIN_MAP_URL ? ok([row('48201', 'Harris', 'Texas', 26_000)]) : url === ODIN_STATUS_URL ? ok([{ totalOutages: 1 }]) : ok([])),
    });
    expect(res.events).toHaveLength(1);
    expect(res.state?.latest?.totalOut).toBe(26_000);
  });
});

describe('geometry', () => {
  it('simplifies, packs and unpacks county outlines', () => {
    // A 1-degree square traced with 200 points: simplifies to its corners.
    const side = (k: number): [number, number][] => Array.from({ length: 50 }, (_, i) => {
      const t = i / 50;
      return ([[t, 0], [1, t], [1 - t, 1], [0, 1 - t]] as [number, number][])[k];
    });
    const traced: [number, number][] = [...side(0), ...side(1), ...side(2), ...side(3), [0, 0]];
    const simple = simplifyRing(traced, 0.01);
    expect(simple.length).toBeLessThanOrEqual(6);
    expect(simple.length).toBeGreaterThanOrEqual(4);
    // A ring smaller than the tolerance still keeps four points.
    expect(simplifyRing(traced.map(([x, y]) => [x / 1000, y / 1000] as [number, number]), 0.01)).toHaveLength(4);
    const rings = outerRings({ type: 'MultiPolygon', coordinates: [square(1, 1).coordinates, square(3, 3).coordinates] });
    expect(rings).toHaveLength(2);
    expect(unpackRings(packRings(rings))).toEqual(rings);
    expect(outerRings(null)).toEqual([]);
  });
});

describe('power headlines', () => {
  it('matches power cuts, not media or internet blackouts', () => {
    for (const t of ['Russian strikes leave Kyiv without power', 'Massive blackout hits Cuba', 'Eskom announces load-shedding', 'Power plant struck in Kharkiv', 'Strikes on energy infrastructure across Ukraine'])
      expect(isPowerHeadline(t), t).toBe(true);
    for (const t of ['Media blackout imposed on Gaza', 'Internet blackout in Iran', 'NFL blackout rule changed', 'Power struggle in Tehran'])
      expect(isPowerHeadline(t), t).toBe(false);
  });
});

let n = 0;
function ev(title: string, hoursAgo: number, p: Partial<IntelligenceEvent> = {}): IntelligenceEvent {
  const id = `p${++n}`;
  return {
    id, contentHash: id, dataOrigin: 'live', sourceId: 'bbc-world', sourceName: 'BBC', sourceClass: 'media', sourceUrl: `https://example.test/${id}`,
    title, category: 'general', regionIds: ['eastern-europe'], countryCodes: [], publishedAt: iso(NOW - hoursAgo * 3_600_000), occurredAt: null, collectedAt: iso(NOW - hoursAgo * 3_600_000),
    credibility: 'single-source', verificationStatus: 'unreviewed', locationPrecision: 'country', ...p,
  };
}
const input = (events: IntelligenceEvent[], extra: Partial<MeterInput> = {}): MeterInput => ({ now: NOW, events, historyStart: NOW - 2 * 86_400_000, sourceStatus: [], regionScores: [], scoreHistory: [], ...extra });

describe('power-outage meter', () => {
  it('scores internet outages from power cuts and headlines from several publishers', () => {
    expect(powerOutageMeter(input([]), 'eastern-europe').label).toBe('QUIET');
    const cut = ev('Internet outage — Ukraine: power outage (nationwide)', 5, { sourceId: 'cloudflare-radar-outages', category: 'cyber', metadata: { outageCause: 'POWER_OUTAGE', outageType: 'NATIONWIDE', endedAt: null } });
    const heads = ['Russian strikes leave Kyiv without power', 'Massive blackout across Ukraine after attack'].map((t, i) => ev(t, 2, { sourceId: i ? 'aljazeera' : 'bbc-world' }));
    const m = powerOutageMeter(input([cut, ...heads]), 'eastern-europe');
    expect(m.label).toBe('ELEVATED'); // nationwide 3 + two publishers 2 = 5
    expect(m.components[0].value).toBe('1 (1 nationwide)');
    expect(m.components[1].value).toBe('2 from 2 publishers');
    expect(m.evidence.map((x) => x.why)).toEqual(['headline', 'headline', 'internet outage from a power cut']); // newest first
  });

  it('uses ODIN customer counts in the United States, and ignores a stale reading', () => {
    const snap: PowerOutageSnapshot = { fetchedAt: iso(NOW - 600_000), utilitiesReporting: 150, utilitiesWithOutages: 5, totalOut: 140_000, states: [{ fips: '48', name: 'Texas', out: 120_000, counties: 9, top: [] }], counties: [] };
    const m = powerOutageMeter(input([], { powerOutages: snap }), 'united-states');
    expect(m.label).toBe('ELEVATED'); // 120k in one state ≥ 100k
    expect(m.reading).toContain('140,000 US customers without power');
    const stale = powerOutageMeter(input([], { powerOutages: { ...snap, fetchedAt: iso(NOW - 5 * 3_600_000) } }), 'united-states');
    expect(stale.label).toBe('QUIET');
    expect(stale.components.at(-1)?.value).toBe('no recent reading');
  });
});

describe('snapshot size guard', () => {
  it('drops the oldest records until the snapshot (layers included) fits', async () => {
    const { fitSnapshot } = await import('../pipeline.ts');
    const { SNAPSHOT_MAX_BYTES } = await import('../../shared/domain/snapshot.ts');
    const big = 'x'.repeat(2_000);
    const events = Array.from({ length: 600 }, (_, i) => ev(`r${i}`, i, { summary: big }));
    const snap = { events, powerOutages: { counties: [{ path: 'y'.repeat(100_000) }] } } as never as Parameters<typeof fitSnapshot>[0];
    const dropped = fitSnapshot(snap);
    expect(dropped).toBeGreaterThan(0);
    expect(Buffer.byteLength(JSON.stringify(snap))).toBeLessThanOrEqual(SNAPSHOT_MAX_BYTES);
    expect(snap.events[0].title).toBe('r0'); // newest kept
  });
});
