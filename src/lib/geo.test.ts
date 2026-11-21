import { WATCH_REGIONS } from '@shared/domain/regions';
import { describe, expect, it } from 'vitest';
import type { IntelligenceEvent } from '@shared/domain/types';
import { isPlottable, projectEvents, regionAreas } from './geo';

function ev(p: Partial<IntelligenceEvent> & { id: string }): IntelligenceEvent {
  return {
    dataOrigin: 'live',
    sourceId: 's',
    sourceName: 'S',
    sourceClass: 'official',
    sourceUrl: 'https://example.org',
    title: 't',
    category: 'maritime',
    regionIds: [],
    countryCodes: [],
    publishedAt: null,
    collectedAt: '2026-11-20T00:00:00Z',
    credibility: 'official',
    verificationStatus: 'unreviewed',
    locationPrecision: 'none',
    contentHash: p.id,
    ...p,
  };
}

describe('isPlottable', () => {
  it('plots only exact/city precision with valid coordinates', () => {
    expect(isPlottable(ev({ id: '1', locationPrecision: 'exact', latitude: 12, longitude: 43 }))).toBe(true);
    expect(isPlottable(ev({ id: '2', locationPrecision: 'city', latitude: 12, longitude: 43 }))).toBe(true);
    // Country precision must never become a pin, even if coordinates were attached.
    expect(isPlottable(ev({ id: '3', locationPrecision: 'country', latitude: 12, longitude: 43 }))).toBe(false);
    expect(isPlottable(ev({ id: '4', locationPrecision: 'exact' }))).toBe(false);
    expect(isPlottable(ev({ id: '5', locationPrecision: 'exact', latitude: 95, longitude: 0 }))).toBe(false);
  });
});

describe('projectEvents', () => {
  it('splits events into points, area-level counts, and unlocated', () => {
    const p = projectEvents([
      ev({ id: 'pt', locationPrecision: 'exact', latitude: 14, longitude: 42, regionIds: ['red-sea'] }),
      ev({ id: 'area1', locationPrecision: 'country', regionIds: ['red-sea'] }),
      ev({ id: 'area2', locationPrecision: 'region', regionIds: ['red-sea', 'middle-east'] }),
      ev({ id: 'cyber', regionIds: ['global-cyber'] }), // non-geographic region
      ev({ id: 'none' }),
    ]);
    expect(p.points.features.map((f) => f.properties.id)).toEqual(['pt']);
    expect(p.points.features[0].geometry.coordinates).toEqual([42, 14]); // GeoJSON is [lon, lat]
    expect(p.regionalCounts).toEqual({ 'red-sea': 2, 'middle-east': 1 });
    expect(p.unlocated).toBe(2);
  });
});

describe('regionAreas', () => {
  it('builds a closed polygon and label per geographic region, marking selection', () => {
    const { polygons, labels } = regionAreas({ 'red-sea': 3 }, 'red-sea');
    expect(polygons.features).toHaveLength(WATCH_REGIONS.filter((r) => r.bbox).length); // global-cyber has no bbox
    const ring = polygons.features[0].geometry.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    const rs = labels.features.find((f) => f.properties?.id === 'red-sea')!;
    expect(rs.properties).toMatchObject({ selected: true, count: 3, label: 'REDSEA · 3 AREA-LEVEL' });
  });
});
