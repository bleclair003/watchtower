import { describe, expect, it } from 'vitest';
import type { IntelligenceEvent } from './types.ts';
import { classify, computeConvergence, findHotspots, signalsFromGnss, type Signal } from './convergence.ts';

const NOW = Date.parse('2026-11-24T12:00:00Z');
const H = 3_600_000;
let n = 0;
function ev(sourceId: string, lat: number, lon: number, extra: Partial<IntelligenceEvent> = {}, meta: Record<string, unknown> = {}): IntelligenceEvent {
  n++;
  return {
    id: `e${n}`,
    contentHash: `e${n}`,
    dataOrigin: 'live',
    sourceId,
    sourceName: sourceId,
    sourceClass: 'official',
    sourceUrl: `https://example.test/${n}`,
    title: `Invented record ${n}`,
    category: 'maritime',
    regionIds: ['eastern-europe'],
    countryCodes: [],
    publishedAt: new Date(NOW - 2 * H).toISOString(),
    collectedAt: new Date(NOW - 2 * H).toISOString(),
    credibility: 'official',
    verificationStatus: 'unreviewed',
    latitude: lat,
    longitude: lon,
    locationPrecision: 'exact',
    metadata: meta,
    ...extra,
  };
}

describe('signal convergence', () => {
  it('classifies records into signal types and skips the rest', () => {
    expect(classify(ev('ais-shipping', 59, 24, {}, { subtype: 'ship-dark' }))?.type).toBe('ship-dark');
    expect(classify(ev('ais-sanctioned-ships', 59, 24, {}, { subtype: 'sanctioned-vessel-sighting' }))?.type).toBe('sanctioned-ship');
    expect(classify(ev('adsb-military', 59, 24, {}, { subtype: 'aircraft-pattern' }))?.type).toBe('air-pattern');
    expect(classify(ev('adsb-military', 59, 24, {}, { subtype: 'military-aircraft-sighting' }))?.type).toBe('mil-air');
    expect(classify(ev('nga-msi', 59, 24, {}, { subtype: 'nav-warning', navKind: 'exercise' }))).toEqual({ type: 'nav-warning', detail: 'military exercise' });
    expect(classify(ev('nga-msi', 59, 24, {}, { subtype: 'nav-warning', navKind: 'other' }))).toBeNull();
    expect(classify(ev('usgs-earthquakes', 59, 24, {}, { magnitude: 3.2 }))).toBeNull();
    expect(classify(ev('usgs-earthquakes', 59, 24, {}, { magnitude: 5.04 }))).toEqual({ type: 'quake', detail: 'M5.0' });
    expect(classify(ev('bbc-world', 59, 24, { category: 'military', locationPrecision: 'city' }))?.type).toBe('report');
    expect(classify(ev('bbc-world', 59, 24, { category: 'general' }))).toBeNull();
    // Country-level records have no point to line up.
    expect(classify(ev('bbc-world', 59, 24, { category: 'military', locationPrecision: 'country', latitude: undefined, longitude: undefined }))).toBeNull();
  });

  it('needs two anomaly types from two independent feeds; three feeds is strong', () => {
    const dark = ev('ais-shipping', 59.5, 24, {}, { subtype: 'ship-dark' });
    const cable = ev('ais-sanctioned-ships', 59.6, 24.2, {}, { subtype: 'cable-proximity' });
    const patrol = ev('adsb-military', 59.4, 24.1, {}, { subtype: 'aircraft-pattern' });
    // Two AIS anomalies: same feed, not independent.
    expect(computeConvergence([dark, cable], null, NOW).hotspots).toEqual([]);
    const c = computeConvergence([dark, cable, patrol], null, NOW);
    expect(c.hotspots).toHaveLength(1);
    expect(c.hotspots[0]).toMatchObject({ level: 'watch', feeds: ['adsb', 'ais'], regionIds: ['eastern-europe'] });
    expect(c.hotspots[0].types.map((t) => t.type).sort()).toEqual(['air-pattern', 'cable-loiter', 'ship-dark']);
    const warn = ev('nga-msi', 59.7, 23.9, { locationPrecision: 'city' }, { subtype: 'nav-warning', navKind: 'firing' });
    expect(computeConvergence([dark, cable, patrol, warn], null, NOW).hotspots[0].level).toBe('strong');
  });

  it('ignores context-only company, far-apart signals and records outside the window', () => {
    const dark = ev('ais-shipping', 59.5, 24, {}, { subtype: 'ship-dark' });
    const flights = [1, 2, 3].map((i) => ev('adsb-military', 59.5 + i / 100, 24, {}, { subtype: 'military-aircraft-sighting' }));
    expect(computeConvergence([dark, ...flights], null, NOW).hotspots).toEqual([]);
    const farPatrol = ev('adsb-military', 55, 15, {}, { subtype: 'aircraft-pattern' });
    expect(computeConvergence([dark, farPatrol], null, NOW).hotspots).toEqual([]);
    const oldPatrol = ev('adsb-military', 59.5, 24.1, { publishedAt: new Date(NOW - 80 * H).toISOString() }, { subtype: 'aircraft-pattern' });
    expect(computeConvergence([dark, oldPatrol], null, NOW).hotspots).toEqual([]);
  });

  it('counts only high GPS interference as an anomaly; medium is context', () => {
    const cells = [
      { k: '59|23', n: 40, bad: 8, lost: 0, level: 'high' as const, regionIds: ['eastern-europe'] },
      { k: '59|24', n: 40, bad: 2, lost: 0, level: 'medium' as const, regionIds: ['eastern-europe'] },
      { k: '50|10', n: 40, bad: 0, lost: 0, level: 'low' as const, regionIds: [] },
    ];
    const s = signalsFromGnss(cells, new Date(NOW).toISOString());
    expect(s.map((x) => x.type)).toEqual(['gnss', 'gnss-medium']);
    expect(s[0]).toMatchObject({ lat: 59.5, lon: 23.5 });
    const dark = ev('ais-shipping', 59.5, 24, {}, { subtype: 'ship-dark' });
    const h = computeConvergence([dark], { cells, fetchedAt: new Date(NOW).toISOString() }, NOW).hotspots;
    expect(h).toHaveLength(1);
    expect(h[0].types.find((t) => t.type === 'gnss-medium')?.role).toBe('context');
    expect(computeConvergence([dark], { cells: cells.slice(1), fetchedAt: new Date(NOW).toISOString() }, NOW).hotspots).toEqual([]);
  });

  it('collapses overlapping candidates into one hotspot and keeps separate places apart', () => {
    const sig = (type: Signal['type'], lat: number, lon: number, h: number): Signal => ({ type, title: type, sourceId: 'x', at: new Date(NOW - h * H).toISOString(), lat, lon, url: '', regionIds: [] });
    const baltic = [sig('ship-dark', 59.5, 24, 1), sig('air-pattern', 59.6, 24.3, 2), sig('cable-loiter', 59.4, 23.8, 3), sig('nav-warning', 59.5, 24.1, 4)];
    const blackSea = [sig('ship-dark', 44, 33, 1), sig('quake', 44.2, 33.1, 5)];
    const hs = findHotspots([...baltic, ...blackSea]);
    expect(hs).toHaveLength(2);
    expect(hs[0]).toMatchObject({ level: 'strong', signalCount: 4 });
    expect(hs[1].feeds).toEqual(['ais', 'usgs']);
    expect(hs[0].radiusKm).toBeGreaterThanOrEqual(25);
  });
});
