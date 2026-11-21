// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { BASE_ACTIVITY, buildBaseMatcher, computeBaseActivity, type BaseRef } from '../../shared/domain/baseActivity.ts';
import { installationAliases, isDistinctiveName } from '../../shared/domain/installations.ts';
import { loadBases } from '../lib/bases.ts';

const NOW = Date.parse('2026-12-20T12:00:00Z');
const DAY = 86_400_000;
const REFS: BaseRef[] = [
  { key: 'dod:Naval Station Norfolk', name: 'Naval Station Norfolk', lat: 36.95, lon: -76.31, country: 'US' },
  { key: 'wd:Q1', name: 'Kadena Air Base', lat: 26.35, lon: 127.77, country: 'JP' },
  { key: 'wd:Q2', name: 'Kuwait Naval Base', lat: 28.86, lon: 48.27, country: 'KW' },
  { key: 'dod:Pentagon', name: 'Pentagon', lat: 38.87, lon: -77.06, country: 'US' },
];
let n = 0;
function ev(title: string, daysAgo: number, p: Partial<IntelligenceEvent> = {}): IntelligenceEvent {
  const id = `e${++n}`;
  const t = new Date(NOW - daysAgo * DAY).toISOString();
  return {
    id, contentHash: id, dataOrigin: 'live', sourceId: 'bbc-world', sourceName: 'BBC', sourceClass: 'media', sourceUrl: `https://example.test/${id}`,
    title, category: 'military', regionIds: [], countryCodes: [], publishedAt: t, occurredAt: null, collectedAt: t,
    credibility: 'single-source', verificationStatus: 'unreviewed', locationPrecision: 'none', ...p,
  };
}

describe('base matcher', () => {
  const match = buildBaseMatcher(REFS);
  const keys = (e: IntelligenceEvent) => match(e).map((m) => m.key);

  it('full names anywhere; short names only in same-country records and as written', () => {
    expect(keys(ev('Fighter jets leave Kadena Air Base', 1))).toEqual(['wd:Q1']);
    expect(keys(ev('New squadron arrives at Kadena', 1, { countryCodes: ['JP'] }))).toEqual(['wd:Q1']);
    expect(keys(ev('New squadron arrives at Kadena', 1))).toEqual([]); // not about Japan
    expect(keys(ev('NAVAL STATION NORFOLK lockdown lifted', 1))).toEqual(['dod:Naval Station Norfolk']);
  });

  it('never matches a short name that is only a country or city, or a site named after a place', () => {
    expect(installationAliases('Kuwait Naval Base')).toEqual(['Kuwait Naval Base']);
    expect(keys(ev('Kuwait says it repelled an Iranian attack', 1, { countryCodes: ['KW'] }))).toEqual([]);
    expect(isDistinctiveName('Pentagon')).toBe(false);
    expect(keys(ev('Pentagon lacks plan for munitions production', 1, { regionIds: ['united-states'] }))).toEqual([]);
  });

  it('location matches within 50 km, for activity categories only', () => {
    const near = { locationPrecision: 'exact' as const, latitude: 37.0, longitude: -76.4 };
    expect(match(ev('Military airlift aircraft seen', 1, { ...near, sourceId: 'adsb-military', category: 'aviation' }))).toEqual([{ key: 'dod:Naval Station Norfolk', how: 'nearby' }]);
    expect(keys(ev('Severe thunderstorm warning', 1, { ...near, sourceId: 'nws-alerts', category: 'disaster' }))).toEqual([]);
    expect(keys(ev('Far away', 1, { locationPrecision: 'exact', latitude: 38.5, longitude: -76.4, category: 'military' }))).toEqual([]);
  });
});

describe('weekly activity against the usual level', () => {
  const background = Array.from({ length: 4 }, (_, w) => ev('Naval Station Norfolk change of command', 8 + w * 7, { sourceId: 'war-gov-news' }));
  const oldest = ev('Unrelated', 30);

  it('flags 3+ records from 2+ sources at 3× the usual week', () => {
    const week = [
      ev('Naval Station Norfolk on alert', 1),
      ev('Naval Station Norfolk security raised', 2, { sourceId: 'aljazeera' }),
      ev('Naval Station Norfolk gate closed', 3, { sourceId: 'military-times' }),
    ];
    const s = computeBaseActivity(REFS, [...background, oldest, ...week], NOW);
    expect(s.flagsActive).toBe(true);
    expect(s.baselineWeeks).toBe(3);
    const item = s.items.find((i) => i.key === 'dod:Naval Station Norfolk')!;
    expect(item).toMatchObject({ week: 3, named: 3, sources: 3, unusual: true });
    expect(item.usualPerWeek).toBe(1); // 3 earlier records in the 3 baseline weeks (the 4th is older)
  });

  it('does not flag one source repeating itself, or a normal week', () => {
    const one = [1, 2, 3].map((d) => ev('Naval Station Norfolk drill', d, { sourceId: 'war-gov-news' }));
    expect(computeBaseActivity(REFS, [...background, oldest, ...one], NOW).items[0].unusual).toBe(false);
    const normal = [ev('Naval Station Norfolk drill', 1)];
    expect(computeBaseActivity(REFS, [...background, oldest, ...normal], NOW).items[0].unusual).toBe(false);
  });

  it('never flags before 21 days of history', () => {
    const week = [1, 2, 3].map((d, i) => ev('Naval Station Norfolk alert', d, { sourceId: ['bbc-world', 'aljazeera', 'npr'][i] }));
    const s = computeBaseActivity(REFS, [...week, ev('Unrelated', 10)], NOW);
    expect(s.flagsActive).toBe(false);
    expect(s.items[0]).toMatchObject({ week: 3, unusual: false });
    expect(BASE_ACTIVITY.minHistoryDays).toBe(21);
  });
});

describe('real installation files', () => {
  it('loads every installation the map shows and matches quickly', () => {
    const { refs, matcher } = loadBases();
    expect(refs.length).toBeGreaterThan(3500);
    const e = ev('Ramstein Air Base hosts NATO meeting', 1);
    const t = performance.now();
    for (let i = 0; i < 1000; i++) matcher(e);
    expect(performance.now() - t).toBeLessThan(1000);
    expect(matcher(e).length).toBeGreaterThan(0);
  });
});
