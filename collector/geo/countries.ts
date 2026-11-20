import { readFileSync } from 'node:fs';

/**
 * Point-in-country for the watch-region countries only.
 *
 * Borders: Natural Earth 1:50,000,000 Admin 0 (public domain), coordinates rounded to 0.001°.
 * At this scale a border can be off by a few kilometres, so a point very close to a border
 * may be assigned to the neighbour. Natural Earth shows de facto control in some disputed
 * areas; records keep `metadata.countryBasis` so the basis is visible.
 * Somaliland is a separate Natural Earth feature without an ISO code, so points there are
 * not assigned to SO.
 */
type Ring = [number, number][];
type Polygon = Ring[];

const data = JSON.parse(readFileSync(new URL('./watch-countries.json', import.meta.url), 'utf8')) as {
  countries: Record<string, Polygon[]>;
};

interface Indexed {
  code: string;
  polygons: Polygon[];
  bbox: [number, number, number, number];
}

const INDEX: Indexed[] = Object.entries(data.countries).map(([code, polygons]) => {
  let w = 180, s = 90, e = -180, n = -90;
  for (const poly of polygons) for (const [x, y] of poly[0]) {
    w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y);
  }
  return { code, polygons, bbox: [w, s, e, n] };
});

function inRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const inPolygon = (lon: number, lat: number, poly: Polygon) => inRing(lon, lat, poly[0]) && !poly.slice(1).some((hole) => inRing(lon, lat, hole));

/**
 * Natural Earth shows Crimea under Russia (de facto control). WATCHTOWER follows the
 * internationally recognised border here, as the headline gazetteer does (Crimea → UA).
 */
const CRIMEA: [number, number, number, number] = [32.4, 44.3, 36.7, 46.25];
export const isCrimea = (lat: number, lon: number) => lon >= CRIMEA[0] && lon <= CRIMEA[2] && lat >= CRIMEA[1] && lat <= CRIMEA[3];

/** ISO alpha-2 of the watch-region country containing the point, or null (outside all of them). */
export function watchCountryAt(lat: number, lon: number): string | null {
  const raw = rawCountryAt(lat, lon);
  return raw === 'RU' && isCrimea(lat, lon) ? 'UA' : raw;
}

function rawCountryAt(lat: number, lon: number): string | null {
  for (const c of INDEX) {
    const [w, s, e, n] = c.bbox;
    if (lon < w || lon > e || lat < s || lat > n) continue;
    if (c.polygons.some((p) => inPolygon(lon, lat, p))) return c.code;
  }
  return null;
}

export const WATCH_COUNTRY_CODES = INDEX.map((c) => c.code);
