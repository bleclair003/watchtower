import type { BBox, IntelligenceEvent } from '@shared/domain/types';
import { WATCH_REGIONS } from '@shared/domain/regions';

/**
 * Converts events into map layers WITHOUT inventing coordinates.
 *
 *  - Events with `exact` or `city` precision and valid coordinates become points.
 *  - Everything else is aggregated onto its watch area(s) as a count, rendered
 *    as a labelled area, never as a pin.
 *  - Events with no geographic watch area are counted as `unlocated`.
 */

export interface PointFeatureProps {
  id: string;
  category: string;
  title: string;
  demo: boolean;
}

export interface MapProjection {
  points: GeoJSON.FeatureCollection<GeoJSON.Point, PointFeatureProps>;
  regionalCounts: Record<string, number>;
  unlocated: number;
}

export function isPlottable(e: IntelligenceEvent): boolean {
  return (
    (e.locationPrecision === 'exact' || e.locationPrecision === 'city') &&
    typeof e.latitude === 'number' &&
    typeof e.longitude === 'number' &&
    Math.abs(e.latitude) <= 90 &&
    Math.abs(e.longitude) <= 180
  );
}

export function projectEvents(events: IntelligenceEvent[]): MapProjection {
  const features: GeoJSON.Feature<GeoJSON.Point, PointFeatureProps>[] = [];
  const regionalCounts: Record<string, number> = {};
  let unlocated = 0;

  for (const e of events) {
    if (isPlottable(e)) {
      features.push({
        type: 'Feature',
        id: e.id,
        geometry: { type: 'Point', coordinates: [e.longitude!, e.latitude!] },
        properties: { id: e.id, category: e.category, title: e.title, demo: e.dataOrigin === 'demo' },
      });
      continue;
    }
    const geoRegions = e.regionIds.filter((id) => WATCH_REGIONS.find((r) => r.id === id)?.bbox);
    if (geoRegions.length === 0) {
      unlocated++;
      continue;
    }
    for (const id of geoRegions) regionalCounts[id] = (regionalCounts[id] ?? 0) + 1;
  }

  return { points: { type: 'FeatureCollection', features }, regionalCounts, unlocated };
}

export function bboxToPolygon([w, s, e, n]: BBox): GeoJSON.Polygon {
  return {
    type: 'Polygon',
    coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
  };
}

/** Watch areas as polygons (outline) + label anchor points (top-left corner). */
export function regionAreas(regionalCounts: Record<string, number>, selectedId: string | null) {
  const polys: GeoJSON.Feature<GeoJSON.Polygon>[] = [];
  const labels: GeoJSON.Feature<GeoJSON.Point>[] = [];
  for (const r of WATCH_REGIONS) {
    if (!r.bbox) continue;
    const count = regionalCounts[r.id] ?? 0;
    const props = { id: r.id, code: r.shortCode, count, selected: r.id === selectedId };
    polys.push({ type: 'Feature', geometry: bboxToPolygon(r.bbox), properties: props });
    labels.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [r.bbox[0], r.bbox[3]] },
      properties: {
        ...props,
        label: count > 0 ? `${r.shortCode} · ${count} AREA-LEVEL` : r.shortCode,
      },
    });
  }
  return {
    polygons: { type: 'FeatureCollection', features: polys } as GeoJSON.FeatureCollection<GeoJSON.Polygon>,
    labels: { type: 'FeatureCollection', features: labels } as GeoJSON.FeatureCollection<GeoJSON.Point>,
  };
}

/** 30° graticule lines for the optional grid overlay. */
export function graticule(step = 30): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  for (let lon = -180; lon <= 180; lon += step) {
    const coords: [number, number][] = [];
    for (let lat = -85; lat <= 85; lat += 5) coords.push([lon, lat]);
    features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} });
  }
  for (let lat = -60; lat <= 80; lat += step) {
    const coords: [number, number][] = [];
    for (let lon = -180; lon <= 180; lon += 5) coords.push([lon, lat]);
    features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} });
  }
  return { type: 'FeatureCollection', features };
}
