import type { Hotspot, HotspotLevel } from './convergence.ts';
import type { CountryHotspot } from './countryConvergence.ts';
import { distanceKm } from './installations.ts';

/**
 * Which hotspots are new (v0.80.0). Hotspots are rebuilt every run, so the collector remembers where they
 * were: a map hotspot is the same as a remembered one within MATCH_KM that was seen in the last
 * MEMORY_HOURS, a country hotspot the same as the remembered one for that country. A hotspot is reported
 * when it first appears, and again when it goes from WATCH to STRONG; a place that stays lit is not
 * reported again until it has been gone for MEMORY_HOURS.
 */
export const MEMORY_HOURS = 24;
export const MATCH_KM = 150;

export interface RememberedPoint {
  lat: number;
  lon: number;
  /** Highest level reported so far. */
  reported: HotspotLevel;
  firstAt: string;
  lastAt: string;
}
export interface RememberedCountry {
  reported: HotspotLevel;
  firstAt: string;
  lastAt: string;
}
export interface ConvergenceMemory {
  points: RememberedPoint[];
  countries: Record<string, RememberedCountry>;
}

export type HotspotChange =
  | { kind: 'point'; change: 'new' | 'upgraded'; hotspot: Hotspot; firstAt: string }
  | { kind: 'country'; change: 'new' | 'upgraded'; hotspot: CountryHotspot; firstAt: string };

export function trackHotspots(prev: ConvergenceMemory | null, points: Hotspot[], countries: CountryHotspot[], now: number): { memory: ConvergenceMemory; changes: HotspotChange[] } {
  const nowIso = new Date(now).toISOString();
  const cutoff = now - MEMORY_HOURS * 3_600_000;
  const live = (r: { lastAt: string }) => Date.parse(r.lastAt) >= cutoff;
  const changes: HotspotChange[] = [];

  const kept = (prev?.points ?? []).filter(live).map((p) => ({ ...p }));
  const matched = new Set<RememberedPoint>();
  for (const h of points) {
    const near = kept
      .filter((p) => !matched.has(p))
      .map((p) => ({ p, km: distanceKm(p.lat, p.lon, h.lat, h.lon) }))
      .filter((x) => x.km <= MATCH_KM)
      .sort((a, b) => a.km - b.km)[0]?.p;
    if (!near) {
      const r: RememberedPoint = { lat: h.lat, lon: h.lon, reported: h.level, firstAt: nowIso, lastAt: nowIso };
      kept.push(r);
      matched.add(r);
      changes.push({ kind: 'point', change: 'new', hotspot: h, firstAt: nowIso });
      continue;
    }
    matched.add(near);
    near.lat = h.lat;
    near.lon = h.lon;
    near.lastAt = nowIso;
    if (h.level === 'strong' && near.reported === 'watch') {
      near.reported = 'strong';
      changes.push({ kind: 'point', change: 'upgraded', hotspot: h, firstAt: near.firstAt });
    }
  }

  const countriesOut: Record<string, RememberedCountry> = {};
  for (const [c, r] of Object.entries(prev?.countries ?? {})) if (live(r)) countriesOut[c] = { ...r };
  for (const h of countries) {
    const r = countriesOut[h.country];
    if (!r) {
      countriesOut[h.country] = { reported: h.level, firstAt: nowIso, lastAt: nowIso };
      changes.push({ kind: 'country', change: 'new', hotspot: h, firstAt: nowIso });
      continue;
    }
    r.lastAt = nowIso;
    if (h.level === 'strong' && r.reported === 'watch') {
      r.reported = 'strong';
      changes.push({ kind: 'country', change: 'upgraded', hotspot: h, firstAt: r.firstAt });
    }
  }
  return { memory: { points: kept, countries: countriesOut }, changes };
}
