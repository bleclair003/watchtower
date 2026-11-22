// @vitest-environment node
/**
 * Phase 14 meters. Synthetic records exercise each rule; the last block runs the whole engine over
 * the real records and snapshot saved on 2026-11-21 (fixtures) and checks the readings reviewed then.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import type { MeterInput } from '../../shared/domain/meters/input.ts';
import { computeMeters, allMeters } from '../../shared/domain/meters/index.ts';
import { buildupVsNoise, escalationLadder, evacuationRisk } from '../../shared/domain/meters/region.ts';
import { airSurge, armsFlow, cyberWeather, diplomaticTemperature, informationBlackout, sanctionsPressure, strategicWeapons } from '../../shared/domain/meters/topics.ts';
import { corroboration, visibility } from '../../shared/domain/meters/quality.ts';
import { daysSince, upcomingCalendar } from '../../shared/domain/meters/clocks.ts';
import { appendLong, appendShort, leadLag, packValues, unpackValues, type HistoryPoint } from '../../shared/domain/meters/history.ts';
import { isStrikeNews } from '../../shared/domain/meters/signals.ts';
import { afterHours, easternHour, ROLE_RECORDING_START } from '../../shared/domain/meters/afterHours.ts';
import { usualLevel } from '../../shared/domain/meters/util.ts';
import { upcomingLaunches, type LL2Launch } from '../adapters/launches.ts';
import { runCollection } from '../pipeline.ts';
import { MemoryStore } from '../store/memory.ts';

const NOW = Date.parse('2026-11-21T14:00:00Z');
const H = 3_600_000;
const DAY = 24 * H;
const iso = (t: number) => new Date(t).toISOString();
let n = 0;
function ev(title: string, hoursAgo: number, p: Partial<IntelligenceEvent> = {}): IntelligenceEvent {
  const id = `e${++n}`;
  return {
    id, contentHash: id, dataOrigin: 'live', sourceId: 'bbc-world', sourceName: 'BBC', sourceClass: 'media', sourceUrl: `https://example.test/${id}`,
    title, category: 'military', regionIds: ['middle-east'], countryCodes: [], publishedAt: iso(NOW - hoursAgo * H), occurredAt: null, collectedAt: iso(NOW - hoursAgo * H),
    credibility: 'single-source', verificationStatus: 'unreviewed', locationPrecision: 'country', ...p,
  };
}
const input = (events: IntelligenceEvent[], extra: Partial<MeterInput> = {}): MeterInput => ({
  now: NOW, events, historyStart: NOW - 2 * DAY, sourceStatus: [], regionScores: [], scoreHistory: [], ...extra,
});

describe('strike headlines', () => {
  it('counts acts of force, not topics', () => {
    const yes = ['Israeli attacks on Gaza kill at least four', 'Ukraine strikes Kerch Bridge', 'Iran’s IRGC downs US drone over Hormuz', 'Saudi-led coalition intercepts three Houthi missiles', 'Russian missile hits Poland'];
    const no = ['US missile shortages create a range problem', 'New tools for troops to gun down drones', 'At least four killed in fire at power station', 'German attack drones pass live-fire tests', 'Guterres calls for an instrument on killer robots'];
    for (const t of yes) expect(isStrikeNews(ev(t, 1)), t).toBe(true);
    for (const t of no) expect(isStrikeNews(ev(t, 1)), t).toBe(false);
  });
});

describe('usual level', () => {
  it('is withheld until enough history, then a per-window mean', () => {
    const events = Array.from({ length: 14 }, (_, d) => ev('x', 24 * (d + 3) + 1));
    expect(usualLevel(events, () => true, NOW, 72, NOW - 5 * DAY).status).toBe('building');
    const u = usualLevel([...events, ev('y', 1), ev('z', 2)], () => true, NOW, 72, NOW - 20 * DAY, 14);
    expect(u.status).toBe('ok');
    expect(u.current).toBe(2);
    expect(u.usual).toBe(2.5); // 14 earlier records over 17 days = 5.67 windows of 72 h, rounded to 0.1
  });
});

describe('region meters', () => {
  it('escalation ladder: highest active rung, with kinetic needing 2 publishers or 4 reports', () => {
    const rhetoric = [1, 2, 3].map((h) => ev('Talks on Iran stall', h, { category: 'diplomatic' }));
    expect(escalationLadder(input(rhetoric), 'middle-east').label).toBe('RUNG 1 · RHETORIC');
    const oneStrike = [...rhetoric, ev('Israeli attacks on Gaza kill four', 1)];
    expect(escalationLadder(input(oneStrike), 'middle-east').value).toBe(1);
    const twoPublishers = [...oneStrike, ev('Israel strikes on Gaza camp kill 7', 2, { sourceId: 'aljazeera' })];
    const m = escalationLadder(input(twoPublishers), 'middle-east');
    expect(m.label).toBe('RUNG 3 · KINETIC');
    expect(m.evidence[0].why).toBe('strike report');
  });

  it('escalation ladder: severe chokepoint or currency stress is a consequence; US kinetic needs hard signals', () => {
    const chokepoints = { fetchedAt: iso(NOW), latestDate: '2026-11-15', items: [{ id: 'hormuz', name: 'Strait of Hormuz', regionId: 'middle-east', lat: 26, lon: 56, ref2025: null, series: [], mean7: 2.3, meanPrior28: 3.8, status: 'severe', latestDate: '2026-11-15' }] } as never;
    expect(escalationLadder(input([], { chokepoints }), 'middle-east').value).toBe(4);
    const usStrikes = [ev('Man attacked in New York subway', 1, { regionIds: ['united-states'] }), ev('Police: two attacked downtown', 2, { regionIds: ['united-states'], sourceId: 'npr-national' })];
    expect(escalationLadder(input(usStrikes), 'united-states').value).toBeLessThan(3);
  });

  it('evacuation risk scores drawdowns, not standing Level 4 advisories', () => {
    const standing = ev('Iraq — Level 4: Do Not Travel', 400, { sourceId: 'state-travel-advisories', category: 'diplomatic', countryCodes: ['IQ'], metadata: { advisoryLevel: 4, change: 'initial' } });
    expect(evacuationRisk(input([standing]), 'middle-east').level).toBe(0);
    const ordered = ev('Embassy Baghdad: ordered departure', 5, { sourceId: 'state-travel-advisories', category: 'diplomatic', countryCodes: ['IQ'], metadata: { subtype: 'embassy-posture', postureChange: 'ordered-departure' } });
    const m = evacuationRisk(input([standing, ordered]), 'middle-east');
    expect(m.value).toBe(3);
    expect(m.level).toBe(2);
    expect(m.reading).toMatch(/1 embassy drawdown/);
  });

  it('buildup vs noise is withheld while the baseline builds, then classifies', () => {
    expect(buildupVsNoise(input([]), 'middle-east')).toMatchObject({ level: null, label: 'BUILDING BASELINE', baseline: 'building' });
    // 20 days of history: 1 news report a day and 1 posture signal every 4 days; then a posture spike.
    const past = Array.from({ length: 17 }, (_, d) => ev(`News ${d}`, 24 * (d + 3) + 1, { category: 'diplomatic' }));
    const air = { sourceId: 'adsb-military', sourceClass: 'aggregator' as const };
    const postures = [4, 8, 12, 16].map((d) => ev('Military tanker aircraft seen', 24 * d, { ...air, metadata: { aircraftClass: 'tanker' } }));
    const spike = [1, 2, 3, 4, 5, 6].map((h) => ev('Military tanker aircraft seen', h, { ...air, metadata: { aircraftClass: h % 2 ? 'tanker' : 'airlift' } }));
    const m = buildupVsNoise(input([...past, ...postures, ...spike, ev('News today', 2, { category: 'diplomatic' })], { historyStart: NOW - 20 * DAY }), 'middle-east');
    expect(m.label).toBe('QUIET BUILDUP');
    expect(airSurge(input([...postures, ...spike], { historyStart: NOW - 20 * DAY }), 'middle-east').level).toBe(4);
  });
});

describe('topic meters', () => {
  it('sanctions pressure ranks target countries by designations', () => {
    const e = [
      ev('UK sanctions: 20 new designations targeting Russia', 30, { sourceId: 'uk-sanctions', category: 'economic', countryCodes: ['RU'], metadata: { subtype: 'sanctions-designations', count: 20, list: 'uk' } }),
      ev('OFAC: 3 new designations Iran', 300, { sourceId: 'ofac-sdn', category: 'economic', countryCodes: ['IR'], metadata: { subtype: 'sanctions-designations', count: 3, list: 'ofac' } }),
    ];
    const m = sanctionsPressure(input(e));
    expect(m.label).toBe('20 IN 7 D');
    expect(m.level).toBe(3);
    expect(m.components[0]).toMatchObject({ label: 'RU', value: '20 (7 d) · 20 (30 d)' });
  });

  it('arms flow levels on munitions dollars; strategic weapons tops out on a nuclear test', () => {
    const c = ev('DoD contract: $6B', 10, { sourceId: 'dod-contracts', metadata: { amountUsd: 6e9, munitions: true, fmsCountries: ['PL'] } });
    expect(armsFlow(input([c]))).toMatchObject({ level: 3, label: '$6.0B MUNITIONS' });
    expect(strategicWeapons(input([ev('DPRK nuclear test', 30, { sourceId: 'yonhap-dprk-launches', metadata: { subtype: 'dprk-nuclear-test' } })])).level).toBe(4);
  });

  it('diplomatic temperature caps batches of UK advice updates', () => {
    const uk = Array.from({ length: 12 }, (_, i) => ev(`Country ${i} — UK travel advice updated`, 5, { sourceId: 'uk-fcdo-travel', category: 'diplomatic', metadata: { changeNote: 'Updated information about regional tensions' } }));
    expect(diplomaticTemperature(input(uk), 'middle-east').value).toBe(2);
  });

  it('information blackout: attributed outages count, technical ones count less', () => {
    const mil = ev('Internet outage — Ukraine: military action', 5, { sourceId: 'cloudflare-radar-outages', category: 'cyber', regionIds: ['eastern-europe'], metadata: { outageCause: 'MILITARY_ACTION' } });
    expect(informationBlackout(input([mil]), 'eastern-europe').level).toBe(3);
  });

  it('cyber weather weights ransomware-linked KEV', () => {
    const kev = Array.from({ length: 5 }, (_, i) => ev(`KEV added ${i}`, 10, { sourceId: 'cisa-kev', category: 'cyber', regionIds: [], metadata: { knownRansomwareUse: i < 3 } }));
    expect(cyberWeather(input(kev)).value).toBe(11);
  });
});

describe('Pentagon after-hours', () => {
  const T = ROLE_RECORDING_START + 20 * DAY; // 20 days after VIP recording began
  const at = (iso: string, p: Partial<IntelligenceEvent>) => ev('x', (T - Date.parse(iso)) / H, p);
  const post = (iso: string) => ({ ...at(iso, { sourceId: 'war-gov-news', sourceClass: 'official', regionIds: ['united-states'] }), publishedAt: iso });
  const vip = (iso: string) => ({ ...at(iso, { sourceId: 'adsb-military', sourceClass: 'aggregator', regionIds: ['united-states'], metadata: { aircraftRole: 'vip' } }), publishedAt: iso });
  const nowAt = (events: IntelligenceEvent[], historyStart: number) => afterHours({ now: T, events: events.map((e) => ({ ...e, collectedAt: e.publishedAt! })), historyStart, sourceStatus: [], regionScores: [], scoreHistory: [] });

  it('uses US Eastern night (22:00–06:00), across daylight-saving changes', () => {
    expect(easternHour('2026-11-21T03:30:00Z')).toBe(22); // EST, UTC−5
    expect(easternHour('2026-07-01T03:30:00Z')).toBe(23); // EDT, UTC−4
  });

  it('is withheld while building, then flags a burst of night work against the usual level', () => {
    const iso = (daysAgo: number, utcHour: number) => new Date(Date.UTC(new Date(T).getUTCFullYear(), new Date(T).getUTCMonth(), new Date(T).getUTCDate() - daysAgo, utcHour)).toISOString();
    // One night post every 6 days as background; then 4 night posts and 3 night VIP flights in the last 3 days.
    const background = [4, 10, 16].map((d) => post(iso(d, 5))); // 05:00 UTC = 00:00 ET
    const burst = [post(iso(1, 4)), post(iso(1, 6)), post(iso(2, 5)), post(iso(2, 7)), vip(iso(1, 5)), vip(iso(2, 4)), vip(iso(0, 6))];
    const day = post(iso(1, 17)); // midday ET: not counted
    expect(nowAt([...background, ...burst, day], T - 5 * DAY).baseline).toBe('building');
    const m = nowAt([...background, ...burst, day], T - 30 * DAY);
    expect(m.baseline).toBe('ok');
    expect(m.level).toBe(4);
    expect(m.components[0].value).toMatch(/^4 \(usual/);
  });

  it('one late post never moves it; VIP flights before recording began do not set the usual level', () => {
    const iso = (h: number) => new Date(T - h * H).toISOString();
    const lone = [post(new Date(Date.UTC(2026, 11, 10, 5)).toISOString())];
    expect(nowAt(lone, T - 30 * DAY).level).toBeLessThanOrEqual(1);
    const m = nowAt([vip(iso(30)), vip(iso(40)), vip(iso(50))], T - 60 * DAY);
    expect(m.components[1].value).toMatch(/usual 0,/); // baseline counted from ROLE_RECORDING_START only
  });
});

describe('quality, clocks and history', () => {
  it('corroboration counts single reports as stories of one', () => {
    const e = [ev('Israel strikes Gaza camp', 1), ev('Israel strikes Gaza camp, officials say', 2, { sourceId: 'aljazeera' }), ev('Unrelated Kuwait budget news', 3)];
    const m = corroboration(input(e), 'middle-east');
    expect(m.reading).toMatch(/^1 of 2 stories/);
  });

  it('visibility: share of the region’s sources online', () => {
    const m = visibility(input([]), 'korean-peninsula');
    expect(m.label).toBe('0% SOURCES ONLINE');
    expect(m.components.some((c) => c.label === 'Known gap')).toBe(true);
  });

  it('days-since counters carry forward and keep the newest', () => {
    const first = daysSince(input([ev('Ordered departure', 50, { sourceId: 'state-travel-advisories', metadata: { postureChange: 'ordered-departure' } })]));
    const od = first.find((c) => c.id === 'ordered-departure')!;
    expect(od.lastAt).toBe(iso(NOW - 50 * H));
    const later = daysSince(input([], { previous: { counters: first } as never }));
    expect(later.find((c) => c.id === 'ordered-departure')!.lastAt).toBe(od.lastAt);
  });

  it('calendar: upcoming launches and future hearings, 30 days', () => {
    const hearing = ev('Senate Armed Services hearing', 1, { sourceId: 'congress', occurredAt: iso(NOW + 5 * DAY) });
    const cal = upcomingCalendar(input([hearing], { upcomingLaunches: [{ name: 'Falcon 9 | NROL-1', net: iso(NOW + 2 * DAY), provider: 'SpaceX', country: 'US', status: 'Go', url: null }, { name: 'Late', net: iso(NOW + 40 * DAY), provider: null, country: null, status: 'TBD', url: null }] }));
    expect(cal.filter((c) => c.kind !== 'known-date').map((c) => c.kind)).toEqual(['launch', 'hearing']);
    expect(cal.find((c) => c.kind === 'known-date')!.title).toMatch(/Taiwan local elections/); // 28 Nov 2026
  });

  it('upcoming launches come from the same Launch Library response', () => {
    const l = (id: string, net: number, status: string, type = 'Government/Top Secret'): LL2Launch => ({ id, name: `Rocket | ${id}`, net: iso(net), status: { abbrev: status, name: status }, mission: { type }, pad: { country: { alpha_2_code: 'US' } } });
    const up = upcomingLaunches([l('a', NOW + DAY, 'Go'), l('b', NOW - DAY, 'Success'), l('c', NOW + 2 * DAY, 'TBD', 'Communications')], NOW);
    expect(up.map((u) => u.name)).toEqual(['Rocket | a']);
  });

  it('packs history compactly and spaces the long history 3 hours apart', () => {
    expect(unpackValues(packValues({ 'escalation.middle-east': 3, cyber: 12.345, x: null }))).toEqual({ 'escalation.middle-east': 3, cyber: 12.3 });
    let long: HistoryPoint[] = [];
    for (let i = 0; i < 12; i++) long = appendLong(long, { at: iso(NOW + i * 30 * 60_000), packed: 'a=1' });
    expect(long.length).toBe(2); // 0 h and 3 h
    let short: HistoryPoint[] = [];
    for (let i = 0; i < 60; i++) short = appendShort(short, { at: iso(NOW + i * H), packed: 'a=1' });
    expect(short.length).toBe(48);
  });

  it('lead/lag counts a meter that rose before an RAI rise, and says when rises are too few', () => {
    const pts: HistoryPoint[] = [];
    for (let h = 0; h <= 96; h += 3) {
      const rai = h >= 72 ? 30 : 10;
      const air = h >= 48 ? 3 : 0;
      pts.push({ at: iso(NOW + h * H), packed: `rai.middle-east=${rai};air-surge.middle-east=${air};cyber=1` });
    }
    const r = leadLag(pts, NOW + 96 * H);
    expect(r.rows.find((x) => x.meterKind === 'air-surge')).toMatchObject({ rises: 1, led: 1 });
    expect(r.rows.find((x) => x.meterKind === 'cyber')).toMatchObject({ rises: 1, flat: 1 });
    expect(r.note).toMatch(/too few/);
  });
});

describe('engine', () => {
  it('every meter is well-formed on empty input (no data, no crash)', () => {
    const all = allMeters(input([], { historyStart: null }));
    expect(all.length).toBe(131);
    expect(new Set(all.map((m) => m.id)).size).toBe(all.length);
    for (const m of all) {
      expect(m.reading.length, m.id).toBeGreaterThan(0);
      expect([0, 1, 2, 3, 4, null]).toContain(m.level);
    }
  });

  it('the collector computes and stores meters and the long history each run', async () => {
    const store = new MemoryStore();
    await runCollection([], store, { now: () => NOW, log: () => {} } as never);
    const m = await store.getMetersSnapshot();
    expect(m?.meters.length).toBe(131);
    expect(m?.history.length).toBe(1);
    expect(m?.leadLag?.note).toMatch(/too few/);
    const long = await store.getCollectorState<{ packed: string }>('meterHistory');
    expect(JSON.parse(long!.packed).length).toBe(1);
  });

  const SNAP = new URL('./fixtures/meters-snapshot.sample.json', import.meta.url);
  const EVENTS = new URL('./fixtures/meters-events.sample.json', import.meta.url);
  it.runIf(existsSync(SNAP) && existsSync(EVENTS))('real data of 2026-11-21 reads as reviewed', () => {
    const snap = JSON.parse(readFileSync(SNAP, 'utf8'));
    const events = JSON.parse(readFileSync(EVENTS, 'utf8')) as IntelligenceEvent[];
    const historyStart = events.reduce((m, e) => Math.min(m, Date.parse(e.collectedAt)), Infinity);
    const m = computeMeters({ now: Date.parse(snap.generatedAt), events, historyStart, sourceStatus: snap.sourceStatus, regionScores: snap.regionScores, scoreHistory: snap.scoreHistory, aircraft: snap.aircraft, fleet: snap.fleet, chokepoints: snap.chokepoints, sanctionedShips: snap.sanctionedShips, displacement: snap.displacement });
    const get = (id: string) => m.meters.find((x) => x.id === id)!;
    expect(get('escalation.middle-east').label).toBe('RUNG 4 · CONSEQUENCES'); // Hormuz severe
    expect(get('escalation.eastern-europe').label).toBe('RUNG 3 · KINETIC'); // Kerch Bridge, missiles on Poland
    expect(get('escalation.united-states').value).toBeLessThan(3);
    expect(get('evacuation.middle-east').level).toBe(1);
    expect(get('naval').label).toBe('3 BIG DECKS');
    expect(get('maritime.hormuz').level).toBeGreaterThanOrEqual(3);
    expect(get('buildup.middle-east').baseline).toBe('building');
    expect(m.counters.find((c) => c.id === 'sanctioned-ship')!.title).toMatch(/KHOLMOGORY/);
  });
});
