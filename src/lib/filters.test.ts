import { describe, expect, it } from 'vitest';
import type { IntelligenceEvent } from '@shared/domain/types';
import { DEFAULT_FILTERS, applyFilters, computeRegionStats, countActiveFilters } from './filters';

const NOW = Date.parse('2026-11-20T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

function ev(p: Partial<IntelligenceEvent> & { id: string }): IntelligenceEvent {
  return {
    dataOrigin: 'demo',
    sourceId: 'src-a',
    sourceName: 'Source A',
    sourceClass: 'official',
    sourceUrl: '',
    title: 'Untitled',
    category: 'military',
    regionIds: [],
    countryCodes: [],
    publishedAt: hoursAgo(1),
    collectedAt: hoursAgo(1),
    credibility: 'official',
    verificationStatus: 'unreviewed',
    locationPrecision: 'none',
    contentHash: p.id,
    ...p,
  };
}

const EVENTS = [
  ev({ id: 'a', regionIds: ['red-sea'], category: 'maritime', publishedAt: hoursAgo(2), title: 'Vessel approached' }),
  ev({ id: 'b', regionIds: ['middle-east'], sourceClass: 'media', sourceId: 'src-b', publishedAt: hoursAgo(30) }),
  ev({ id: 'c', regionIds: ['red-sea', 'middle-east'], category: 'aviation', publishedAt: hoursAgo(100) }),
  ev({ id: 'd', publishedAt: null, collectedAt: hoursAgo(0.5), summary: 'contains KEYWORD here' }),
];

describe('applyFilters', () => {
  it('sorts newest first and applies the default 72h window', () => {
    expect(applyFilters(EVENTS, DEFAULT_FILTERS, NOW).map((e) => e.id)).toEqual(['d', 'a', 'b']);
  });

  it('falls back to collectedAt when publishedAt is unknown', () => {
    const r = applyFilters(EVENTS, { ...DEFAULT_FILTERS, windowHours: 1 }, NOW);
    expect(r.map((e) => e.id)).toEqual(['d']);
  });

  it('filters by region membership (multi-region events match each region)', () => {
    const r = applyFilters(EVENTS, { ...DEFAULT_FILTERS, regionId: 'middle-east', windowHours: null }, NOW);
    expect(r.map((e) => e.id).sort()).toEqual(['b', 'c']);
  });

  it('filters by category set, source, and source class', () => {
    expect(applyFilters(EVENTS, { ...DEFAULT_FILTERS, categories: ['maritime', 'aviation'], windowHours: null }, NOW)).toHaveLength(2);
    expect(applyFilters(EVENTS, { ...DEFAULT_FILTERS, sourceId: 'src-b' }, NOW).map((e) => e.id)).toEqual(['b']);
    expect(applyFilters(EVENTS, { ...DEFAULT_FILTERS, sourceClass: 'non-official' }, NOW).map((e) => e.id)).toEqual(['b']);
    expect(applyFilters(EVENTS, { ...DEFAULT_FILTERS, sourceClass: 'official' }, NOW).map((e) => e.id)).toEqual(['d', 'a']);
  });

  it('keyword search is case-insensitive across title and summary', () => {
    expect(applyFilters(EVENTS, { ...DEFAULT_FILTERS, keyword: 'keyword' }, NOW).map((e) => e.id)).toEqual(['d']);
    expect(applyFilters(EVENTS, { ...DEFAULT_FILTERS, keyword: '  VESSEL ' }, NOW).map((e) => e.id)).toEqual(['a']);
  });
});

describe('countActiveFilters', () => {
  it('is zero for defaults and counts each changed dimension', () => {
    expect(countActiveFilters(DEFAULT_FILTERS)).toBe(0);
    expect(countActiveFilters({ ...DEFAULT_FILTERS, regionId: 'x', keyword: 'y', windowHours: 6 })).toBe(3);
  });
});

describe('computeRegionStats', () => {
  it('counts reports in the last 24h vs the prior 24h', () => {
    const stats = computeRegionStats(EVENTS, NOW);
    const me = stats.find((s) => s.regionId === 'middle-east')!;
    expect(me).toMatchObject({ last24h: 0, prev24h: 1, delta: -1 });
    const rs = stats.find((s) => s.regionId === 'red-sea')!;
    expect(rs).toMatchObject({ last24h: 1, prev24h: 0, delta: 1, latestAt: hoursAgo(2) });
  });

  it('reports null latestAt for regions with no records', () => {
    expect(computeRegionStats(EVENTS, NOW).find((s) => s.regionId === 'korean-peninsula')!.latestAt).toBeNull();
  });
});

describe('routine aircraft sightings', () => {
  const air = (id: string, metadata: Record<string, unknown>) => ev({ id, sourceId: 'adsb-military', title: id, metadata: { subtype: 'military-aircraft-sighting', ...metadata } });
  const list = [air('tanker', { aircraftClass: 'tanker' }), air('bomber', { aircraftClass: 'bomber' }), air('e4b', { aircraftClass: 'isr', aircraftRole: 'command' }), ev({ id: 'news' })];

  it('hides tankers, airlift and surveillance sightings by default, never bombers or command / VIP aircraft', () => {
    expect(applyFilters(list, DEFAULT_FILTERS, NOW).map((e) => e.id).sort()).toEqual(['bomber', 'e4b', 'news']);
    expect(applyFilters(list, { ...DEFAULT_FILTERS, showRoutineAircraft: true }, NOW)).toHaveLength(4);
    expect(countActiveFilters({ ...DEFAULT_FILTERS, showRoutineAircraft: true })).toBe(1);
  });

  it('shows them when the aircraft source itself is selected', () => {
    expect(applyFilters(list, { ...DEFAULT_FILTERS, sourceId: 'adsb-military' }, NOW).map((e) => e.id).sort()).toEqual(['bomber', 'e4b', 'tanker']);
  });
});
