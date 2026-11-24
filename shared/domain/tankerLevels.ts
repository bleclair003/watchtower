import { compare, VERY_UNUSUAL } from './anomaly.ts';

/**
 * Tanker traffic levels in the Gulf of Finland (v0.78.0), from Fintraffic's feed, which reports every
 * ship its Finnish receivers hear. Each collection run counts the tankers present in each zone, moving and
 * at anchor; counts are kept per hour for 60 days. A day's level is the mean of its hourly counts, compared
 * with the zone's own earlier days (median and typical spread). After MIN_DAYS of history, a day at
 * VERY_UNUSUAL spreads above or below is a surge or a drop.
 *
 * A drop can follow strikes on oil terminals or loading halts; a surge can be a loading rush or a queue
 * waiting at anchor. Weather (ice, storms) and coverage gaps move the counts too.
 */
export interface TankerZone {
  id: string;
  name: string;
  /** [south, west, north, east] */
  box: [number, number, number, number];
}

export const TANKER_ZONES: TankerZone[] = [
  { id: 'primorsk', name: 'Primorsk and Vyborg approaches', box: [60.15, 27.6, 60.8, 29.1] },
  { id: 'ust-luga', name: 'Ust-Luga approaches', box: [59.55, 27.75, 60.0, 28.6] },
  { id: 'gulf-of-finland', name: 'Gulf of Finland (whole)', box: [59.0, 22.0, 60.8, 30.5] },
];
export const LEVEL_KEEP_DAYS = 60;
export const MIN_DAYS = 7;

export const zoneAt = (lat: number, lon: number) => TANKER_ZONES.filter(({ box: [s, w, n, e] }) => lat >= s && lat <= n && lon >= w && lon <= e);

/** Hourly counts per zone: "hour:total,moving,anchored;…" (epoch hours). */
export type PackedHours = Record<string, string>;
type Bucket = { h: number; t: number; m: number; a: number };
export const unpack = (s: string | undefined): Bucket[] =>
  s
    ? s.split(';').map((p) => {
        const [h, rest] = p.split(':');
        const [t, m, a] = rest.split(',').map(Number);
        return { h: Number(h), t, m, a };
      })
    : [];
const pack = (b: Bucket[]) => b.map((x) => `${x.h}:${x.t},${x.m},${x.a}`).join(';');

/** Adds this run's counts (a second run in the same hour replaces the first) and drops old hours. */
export function addCounts(prev: PackedHours, counts: Record<string, { t: number; m: number; a: number }>, nowMs: number): PackedHours {
  const h = Math.floor(nowMs / 3_600_000);
  const out: PackedHours = {};
  for (const z of TANKER_ZONES) {
    const kept = unpack(prev[z.id]).filter((b) => b.h > h - LEVEL_KEEP_DAYS * 24 && b.h !== h);
    const c = counts[z.id] ?? { t: 0, m: 0, a: 0 };
    out[z.id] = pack([...kept, { h, ...c }]);
  }
  return out;
}

export interface ZoneLevel {
  id: string;
  name: string;
  /** Daily mean tankers present, oldest first: [YYYY-MM-DD, mean, mean at anchor]. */
  days: [string, number, number][];
  /** Last 24 hours: mean present and at anchor, from `hours` hourly counts. */
  last24: { mean: number; anchored: number; hours: number };
  /** Last 24 h against the earlier days (null while building). */
  centre: number | null;
  score: number | null;
  direction: 'surge' | 'drop' | null;
}

const r1 = (x: number) => Math.round(x * 10) / 10;

export function zoneLevels(packed: PackedHours, nowMs: number): ZoneLevel[] {
  const hNow = Math.floor(nowMs / 3_600_000);
  return TANKER_ZONES.map((z) => {
    const buckets = unpack(packed[z.id]);
    const byDay = new Map<string, Bucket[]>();
    for (const b of buckets) {
      if (b.h > hNow - 24) continue; // the last 24 h are scored apart
      const day = new Date(b.h * 3_600_000).toISOString().slice(0, 10);
      byDay.set(day, [...(byDay.get(day) ?? []), b]);
    }
    // A day needs a fair spread of hours to count.
    const days: [string, number, number][] = [...byDay.entries()]
      .filter(([, bs]) => bs.length >= 8)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([d, bs]) => [d, r1(bs.reduce((s, x) => s + x.t, 0) / bs.length), r1(bs.reduce((s, x) => s + x.a, 0) / bs.length)]);
    const recent = buckets.filter((b) => b.h > hNow - 24);
    const last24 = {
      mean: recent.length ? r1(recent.reduce((s, x) => s + x.t, 0) / recent.length) : 0,
      anchored: recent.length ? r1(recent.reduce((s, x) => s + x.a, 0) / recent.length) : 0,
      hours: recent.length,
    };
    // Daily means of hourly counts are measurements, not event counts: the spread comes from the days themselves.
    const a = recent.length >= 8 ? compare(last24.mean, days.map((d) => d[1]), { kind: 'measure', minSamples: MIN_DAYS }) : null;
    const score = a?.score ?? null;
    return {
      id: z.id,
      name: z.name,
      days,
      last24,
      centre: a?.centre ?? null,
      score,
      direction: score === null ? null : score >= VERY_UNUSUAL ? 'surge' : score <= -VERY_UNUSUAL && (a?.centre ?? 0) >= 4 ? 'drop' : null,
    };
  });
}
