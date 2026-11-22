/**
 * Anomaly detection (Phase 24): how unusual is a reading compared with its own history?
 *
 * The earlier rule was "2–3× the average". It treats a steady series and a jumpy one the same, and a
 * small count (2 instead of 1) looks as alarming as a big one. This module measures distance from
 * normal in units of the series' own typical spread:
 *
 *   score = (current − centre) / spread
 *
 * - centre: the median of earlier comparable windows (or a supplied expected level, e.g. like-for-like).
 * - spread: 1.4826 × the median absolute deviation (a robust standard deviation that one past burst
 *   cannot inflate), never less than the natural randomness of counts (√ of the mean without the busiest
 *   10% of windows, at least 0.5) or, for
 *   measurements, 10% of the centre.
 *
 * A score of 2 or more is unusual, 3 or more very unusual; −2 or less is an unusual drop (only reported
 * when the series is normally busy enough for a fall to mean something). Trends use the Mann–Kendall test:
 * a run of rises or falls that is unlikely to be chance, even when no single point is extreme.
 *
 * Pure functions; no data is invented: with too little history the result says 'building'.
 */

export const UNUSUAL = 2;
export const VERY_UNUSUAL = 3;
/** Earlier comparable windows needed before a score is given. */
export const MIN_SAMPLES = 7;
/** A drop is only reported when the centre is at least this (a fall from 1 to 0 means nothing). */
export const MIN_CENTRE_FOR_DROP = 4;
const MAD_SCALE = 1.4826;

export type AnomalyDirection = 'spike' | 'drop' | 'normal';

export interface Anomaly {
  status: 'ok' | 'building';
  current: number;
  /** Normal level (median of history, or the supplied expected level). */
  centre: number | null;
  /** Typical spread around normal. */
  spread: number | null;
  /** Distance from normal in spreads (one decimal), or null while building. */
  score: number | null;
  direction: AnomalyDirection | null;
  /** Earlier windows the comparison rests on. */
  samples: number;
}

export interface CompareOptions {
  /** 'count' (events per window, Poisson-like) or 'measure' (a quantity such as drones per night). */
  kind?: 'count' | 'measure';
  minSamples?: number;
  /** Use this as the normal level instead of the history's median (e.g. a like-for-like expectation). */
  expected?: number | null;
}

export const median = (xs: number[]): number => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Compares `current` with earlier values of the same series. */
export function compare(current: number, history: number[], opts: CompareOptions = {}): Anomaly {
  const kind = opts.kind ?? 'count';
  const xs = history.filter((x) => Number.isFinite(x));
  if (xs.length < (opts.minSamples ?? MIN_SAMPLES)) return { status: 'building', current, centre: null, spread: null, score: null, direction: null, samples: xs.length };
  const med = median(xs);
  const centre = opts.expected ?? med;
  const mad = median(xs.map((x) => Math.abs(x - med)));
  // Mean without the busiest 10% of windows, so a past burst does not widen the noise floor.
  const kept = [...xs].sort((p, q) => p - q).slice(0, xs.length - Math.ceil(xs.length * 0.1));
  const mean = kept.reduce((p, q) => p + q, 0) / kept.length;
  const floor = kind === 'count' ? Math.sqrt(Math.max(mean, centre, 0.25)) : Math.max(0.1 * Math.abs(centre), 0.5);
  const spread = Math.max(MAD_SCALE * mad, floor);
  const score = (current - centre) / spread;
  const direction: AnomalyDirection = score >= UNUSUAL ? 'spike' : score <= -UNUSUAL && centre >= MIN_CENTRE_FOR_DROP ? 'drop' : 'normal';
  return { status: 'ok', current, centre: r2(centre), spread: r2(spread), score: r1(score), direction, samples: xs.length };
}

/** Smallest whole count that would score at least `z` (for showing thresholds). */
export const countAtScore = (a: Pick<Anomaly, 'centre' | 'spread'>, z: number): number | null => (a.centre === null || a.spread === null ? null : Math.ceil(a.centre + z * a.spread - 1e-9));

/**
 * Meter level from a score: below 1 LOW (or QUIET when nothing happened), 1+ GUARDED, 2+ ELEVATED,
 * 3+ HIGH. Drops never raise a level (quiet is not a threat; drops are shown separately).
 */
export function levelFromAnomaly(a: Anomaly, current = a.current): 0 | 1 | 2 | 3 | 4 {
  if (current <= 0) return 0;
  const s = a.score ?? 0;
  return s >= VERY_UNUSUAL ? 4 : s >= UNUSUAL ? 3 : s >= 1 ? 2 : 1;
}

/** Plain-language description, e.g. "2.4 spreads above normal: unusual". */
export function describe(a: Anomaly): string {
  if (a.status === 'building' || a.score === null) return `normal level not known yet (${a.samples} of ${MIN_SAMPLES} earlier periods)`;
  const s = Math.abs(a.score);
  const side = a.score >= 0 ? 'above' : 'below';
  const tag = a.direction === 'spike' ? (a.score >= VERY_UNUSUAL ? 'very unusual' : 'unusual') : a.direction === 'drop' ? 'unusual drop' : 'within normal range';
  return `${s} spread${s === 1 ? '' : 's'} ${side} normal: ${tag}`;
}

// --------------------------------------------------------------- trends ---

export type TrendDirection = 'rising' | 'falling' | 'flat';

export interface Trend {
  status: 'ok' | 'building';
  direction: TrendDirection | null;
  /** Points used (oldest → newest). */
  points: number;
  /** Mann–Kendall statistic S and its normal score. */
  s: number | null;
  score: number | null;
  /** Theil–Sen slope: typical change per step. */
  slope: number | null;
}

export const TREND_MIN_POINTS = 5;
/** |score| at or above this (about 95% confidence) counts as a real trend. */
export const TREND_SCORE = 1.96;

/** Mann–Kendall trend over the last `maxPoints` values (oldest first). */
export function trendOf(series: number[], maxPoints = 10): Trend {
  const xs = series.filter((x) => Number.isFinite(x)).slice(-maxPoints);
  const n = xs.length;
  if (n < TREND_MIN_POINTS) return { status: 'building', direction: null, points: n, s: null, score: null, slope: null };
  let s = 0;
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++)
    for (let j = i + 1; j < n; j++) {
      s += Math.sign(xs[j] - xs[i]);
      slopes.push((xs[j] - xs[i]) / (j - i));
    }
  // Variance with a correction for tied values.
  const ties = new Map<number, number>();
  for (const x of xs) ties.set(x, (ties.get(x) ?? 0) + 1);
  let tieTerm = 0;
  for (const t of ties.values()) tieTerm += t * (t - 1) * (2 * t + 5);
  const v = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18;
  const z = v > 0 ? (s > 0 ? (s - 1) / Math.sqrt(v) : s < 0 ? (s + 1) / Math.sqrt(v) : 0) : 0;
  const direction: TrendDirection = z >= TREND_SCORE ? 'rising' : z <= -TREND_SCORE ? 'falling' : 'flat';
  return { status: 'ok', direction, points: n, s, score: r2(z), slope: r2(median(slopes)) };
}

// ------------------------------------------------------- shared signals ---

/** One unusual reading, collected from meters and indicators for the convergence board. */
export interface AnomalySignal {
  /** What moved, in plain words. */
  label: string;
  /** Group used to count independent signals (e.g. meter kind or indicator family). */
  group: string;
  kind: 'spike' | 'drop' | 'rising' | 'falling';
  /** Score (spreads from normal, or the trend score). */
  score: number;
}

/** Signals for one comparison and one trend (none when normal or building). */
export function signalsOf(label: string, group: string, a: Anomaly | null, t: Trend | null = null): AnomalySignal[] {
  const out: AnomalySignal[] = [];
  if (a?.direction === 'spike' || a?.direction === 'drop') out.push({ label, group, kind: a.direction, score: a.score! });
  if (t?.direction === 'rising' || t?.direction === 'falling') out.push({ label: `${label} (trend)`, group, kind: t.direction, score: t.score! });
  return out;
}
