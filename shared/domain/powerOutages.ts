/**
 * Power outages.
 *
 * United States: live customer outages from ODIN (Outage Data Initiative Nationwide, US Department
 * of Energy / Oak Ridge National Laboratory), by county, from the utilities that report to it
 * (about 160 of the ~3,000 US utilities in Nov 2026, including several large ones). The public feed
 * runs about 15 minutes behind. Counts are customers (meters) without power, as each utility reports
 * them; ODIN does not give a reliable per-state customer base (some utilities report company-wide
 * totals), so no percentages are computed.
 *
 * Elsewhere there is no free live feed: the power-outage meter uses internet outages that Cloudflare
 * attributes to power cuts, and news headlines about power cuts and blackouts.
 */
import type { IntelligenceEvent } from './types.ts';

export interface PowerOutageCounty {
  /** 5-digit county FIPS code. */
  fips: string;
  name: string;
  state: string;
  out: number;
  /** Utilities reporting outages in the county (largest first). */
  utilities: string[];
  /** County outline from ODIN, simplified and packed (see packRings). */
  path: string;
}

export interface PowerOutageState {
  /** 2-digit state FIPS code. */
  fips: string;
  name: string;
  out: number;
  counties: number;
  /** Largest utilities by customers out in the state. */
  top: { name: string; out: number }[];
}

export interface PowerOutageSnapshot {
  fetchedAt: string;
  /** Utilities currently sending data to ODIN, and how many report outages. */
  utilitiesReporting: number;
  utilitiesWithOutages: number;
  totalOut: number;
  /** Largest first. */
  states: PowerOutageState[];
  /** Counties drawn on the map: largest first, at least MAP_MIN_COUNTY_OUT out, at most MAP_MAX_COUNTIES. */
  counties: PowerOutageCounty[];
  simulated?: boolean;
}

/** Counties drawn on the map. */
export const MAP_MIN_COUNTY_OUT = 50;
export const MAP_MAX_COUNTIES = 60;
/** Total size of the packed county outlines kept in the snapshot (largest outages first). */
export const MAP_MAX_PATH_CHARS = 40_000;
/** A state record (feed, alerts, archive) when a state reaches one of these customer-out counts. */
export const STATE_RECORD_STEPS = [25_000, 100_000, 250_000, 500_000, 1_000_000];
/** US meter: largest state outage for LOW, GUARDED, ELEVATED, HIGH. */
export const US_LEVEL_STEPS: [number, number, number, number] = [5_000, 25_000, 100_000, 500_000];

export const ODIN_PAGE = 'https://odin.ornl.gov';

// ---------------------------------------------------------------- geometry

type Ring = [number, number][];

/** Douglas–Peucker simplification of an open or closed ring (tolerance in degrees). */
export function simplifyRing(ring: Ring, tolerance: number): Ring {
  if (ring.length <= 4) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const stack: [number, number][] = [[0, ring.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [x1, y1] = ring[a];
    const [x2, y2] = ring[b];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    let best = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = ring[i];
      const d = len === 0 ? Math.hypot(x - x1, y - y1) : Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1) / len;
      if (d > best) {
        best = d;
        at = i;
      }
    }
    if (best > tolerance && at > 0) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  const out = ring.filter((_, i) => keep[i]);
  if (out.length >= 4) return out;
  // Too small to survive the tolerance: keep four evenly spaced points so it still draws.
  const n = ring.length - 1;
  return [0, Math.round(n / 3), Math.round((2 * n) / 3), n].map((i) => ring[i]);
}

/**
 * Packs polygon rings as "lon,lat lon,lat|lon,lat …" (3 decimals, about 100 m). Firestore cannot
 * store nested arrays, and a packed string keeps the snapshot small.
 */
export function packRings(rings: Ring[]): string {
  return rings.map((r) => r.map(([x, y]) => `${Math.round(x * 1000) / 1000},${Math.round(y * 1000) / 1000}`).join(' ')).join('|');
}
export function unpackRings(path: string): Ring[] {
  if (!path) return [];
  return path.split('|').map((r) => r.split(' ').map((p) => p.split(',').map(Number) as [number, number]));
}

/** Outer rings of a GeoJSON Polygon or MultiPolygon, simplified (holes dropped: counties rarely have them). */
export function outerRings(geometry: { type?: unknown; coordinates?: unknown } | null | undefined, tolerance = 0.01): Ring[] {
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  const polys = geometry.type === 'MultiPolygon' ? (geometry.coordinates as Ring[][]) : geometry.type === 'Polygon' ? [geometry.coordinates as Ring[]] : [];
  return polys
    .map((p) => p[0])
    .filter((r): r is Ring => Array.isArray(r) && r.length >= 4 && r.every((pt) => Array.isArray(pt) && Number.isFinite(pt[0]) && Number.isFinite(pt[1])))
    .map((r) => simplifyRing(r, tolerance));
}

// ---------------------------------------------------------------- signals for the meter

/** Internet outages Cloudflare attributes to a power cut. */
export const isPowerCutInternetOutage = (e: IntelligenceEvent) => e.sourceId === 'cloudflare-radar-outages' && (e.metadata ?? {}).outageCause === 'POWER_OUTAGE';

const POWER_TERMS = /\b(blackouts?|power (cuts?|outages?|failures?|shortages?)|electricity (cuts?|outages?|shortages?)|without (power|electricity)|no (power|electricity)|load[- ]shedding|grid (collapse|failure|failed|down)|(energy|power|electricity) (infrastructure|grid|facilit(y|ies)|plants?|stations?|substations?) (hit|struck|attacked|damaged|destroyed|targeted)|(strikes?|attacks?) on (energy|power|the power grid|electricity))\b/i;
const NOT_POWER = /\b(media|news|information|internet|communications?|blackout (period|dates?)|blackout rule)\b.{0,12}\bblackout|\bblackout\b.{0,12}\b(period|dates?|rule)\b/i;

/** A headline about power cuts, blackouts or attacks on the power system (not media or internet blackouts). */
export function isPowerHeadline(title: string): boolean {
  return POWER_TERMS.test(title) && !NOT_POWER.test(title);
}
