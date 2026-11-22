import type { IntelligenceEvent } from '../types.ts';
import type { Meter, MeterEvidence, MeterLevel } from './types.ts';
import { LEVEL_LABEL } from './types.ts';
import type { MeterInput } from './input.ts';
import { holidayName } from '../holidays.ts';
import { compare, describe, levelFromAnomaly, type Anomaly } from '../anomaly.ts';

export const H = 3_600_000;
export const DAY = 24 * H;
/** Usual-level comparisons need this much stored history. */
export const BASELINE_DAYS = 14;

export const at = (e: IntelligenceEvent) => Date.parse(e.publishedAt ?? e.collectedAt);
export const within = (e: IntelligenceEvent, now: number, hours: number) => {
  const t = at(e);
  return t >= now - hours * H && t <= now + H;
};
export const inRegion = (e: IntelligenceEvent, regionId: string) => e.regionIds.includes(regionId);
export const meta = <T = unknown>(e: IntelligenceEvent, k: string) => (e.metadata ?? {})[k] as T | undefined;
export const newest = (events: IntelligenceEvent[]) => events.reduce<string | null>((m, e) => {
  const t = e.publishedAt ?? e.collectedAt;
  return !m || t > m ? t : m;
}, null);

export function evidenceOf(events: IntelligenceEvent[], why?: (e: IntelligenceEvent) => string | undefined, max = 5): MeterEvidence[] {
  return [...events]
    .sort((a, b) => at(b) - at(a))
    .slice(0, max)
    .map((e) => ({ title: e.title, url: e.sourceUrl, at: e.publishedAt ?? e.collectedAt, why: why?.(e) }));
}

export interface Usual {
  current: number;
  /** Expected count for this window from earlier history, or null while building. */
  usual: number | null;
  /** current / max(usual, floor), or null while building. */
  ratio: number | null;
  status: 'ok' | 'building';
  /** How the usual level was worked out (null while building). */
  basis: UsualBasis | null;
  /**
   * Phase 24: how unusual the window is — distance from the usual level in typical spreads of earlier
   * windows of the same length (shared/domain/anomaly.ts). Null while building.
   */
  anomaly: Anomaly | null;
}

export interface UsualBasis {
  /** 'like-for-like': each day in the window against earlier days of the same kind; 'all-days': plain average. */
  method: 'like-for-like' | 'all-days';
  /** Holidays falling in the window. */
  holidays: string[];
  /** Plain-language explanation shown with the meter. */
  text: string;
}

/** Daily counts on holidays, per series key: { key: { 'YYYY-MM-DD': count } }. Kept by the collector beyond the loaded window. */
export type HolidayCounts = Record<string, Record<string, number>>;

/** Like-for-like options: a series key lets holidays be compared with stored earlier holidays and records new ones. */
export interface LikeForLike {
  key?: string;
  holidays?: HolidayCounts | null;
  /** Receives complete holiday-day counts seen in loaded records (the collector stores them). */
  sink?: HolidayCounts | null;
}

/** Earlier days of the same weekday needed before a weekday is compared like-for-like. */
export const LIKE_MIN_WEEKDAYS = 3;
/** Earlier holidays needed before holidays are compared with holidays. */
export const LIKE_MIN_HOLIDAYS = 2;
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);
const floorDay = (t: number) => Math.floor(t / DAY) * DAY;

/**
 * Count in the last `windowHours` against the usual level for the same stretch of time.
 * Withheld (status 'building') until `minDays` of history exist.
 *
 * Like-for-like (Phase 15 item 12): every UTC day the window covers is given a kind — its weekday, or
 * "holiday" (shared/domain/holidays.ts). The usual count for each kind is the mean over earlier whole
 * days of that kind (holidays excluded from weekdays), and the expected count for the window is the
 * sum of those means, weighted by how much of each day the window covers. Used once every kind in
 * the window has enough earlier days (3 of each weekday; 2 holidays, which can come from the stored
 * holiday counts); until then the plain average over all earlier windows is used and the basis says so.
 */
export function usualLevel(events: IntelligenceEvent[], pred: (e: IntelligenceEvent) => boolean, now: number, windowHours: number, historyStart: number | null, minDays = BASELINE_DAYS, floor = 1, like: LikeForLike = {}): Usual {
  const start = now - windowHours * H;
  const matching = events.filter(pred);
  const current = matching.filter((e) => at(e) >= start && at(e) <= now + H).length;

  // Whole UTC days of loaded history, and their counts (also feeds the holiday store).
  const firstFull = historyStart === null ? null : Math.ceil(historyStart / DAY) * DAY;
  const daily = new Map<string, number>();
  if (firstFull !== null) {
    const end = floorDay(now);
    for (const e of matching) {
      const t = at(e);
      if (t >= firstFull && t < end) daily.set(dayOf(t), (daily.get(dayOf(t)) ?? 0) + 1);
    }
    if (like.key && like.sink) {
      for (let d = firstFull; d < end; d += DAY) {
        const day = dayOf(d);
        if (holidayName(day)) (like.sink[like.key] ??= {})[day] = daily.get(day) ?? 0;
      }
    }
  }

  // The window's days and their kinds.
  const parts: { kind: string; fraction: number }[] = [];
  const holidaysInWindow: string[] = [];
  for (let d = floorDay(start); d < now; d += DAY) {
    const fraction = (Math.min(d + DAY, now) - Math.max(d, start)) / DAY;
    if (fraction <= 0) continue;
    const name = holidayName(dayOf(d));
    if (name && !holidaysInWindow.includes(name)) holidaysInWindow.push(name);
    parts.push({ kind: name ? 'holiday' : WEEKDAY[new Date(d).getUTCDay()], fraction });
  }

  if (historyStart === null || firstFull === null || now - historyStart < minDays * DAY) return { current, usual: null, ratio: null, status: 'building', basis: null, anomaly: null };
  const windows = (start - historyStart) / (windowHours * H);
  if (windows < 1) return { current, usual: null, ratio: null, status: 'building', basis: null, anomaly: null };

  // Earlier windows of the same length (whole days, one ending each day) for the typical spread.
  const span = Math.max(1, Math.round(windowHours / 24));
  const totals: number[] = [];
  for (let end = floorDay(start); end - span * DAY >= firstFull; end -= DAY) {
    let t = 0;
    for (let d = end - span * DAY; d < end; d += DAY) t += daily.get(dayOf(d)) ?? 0;
    totals.push(windowHours < 24 ? (t * windowHours) / 24 : t);
  }
  const score = (expected: number) => compare(current, totals, { expected });

  // Samples per kind from whole days before the window.
  const samples = new Map<string, number[]>();
  const before = floorDay(start);
  for (let d = firstFull; d < before; d += DAY) {
    const day = dayOf(d);
    const kind = holidayName(day) ? 'holiday' : WEEKDAY[new Date(d).getUTCDay()];
    (samples.get(kind) ?? samples.set(kind, []).get(kind)!).push(daily.get(day) ?? 0);
  }
  const stored = like.key ? (like.holidays?.[like.key] ?? {}) : {};
  for (const [day, n] of Object.entries(stored)) {
    if (Date.parse(`${day}T00:00:00Z`) < before && (Date.parse(`${day}T00:00:00Z`) < firstFull)) (samples.get('holiday') ?? samples.set('holiday', []).get('holiday')!).push(n);
  }
  const kinds = [...new Set(parts.map((p) => p.kind))];
  const enough = (k: string) => (samples.get(k)?.length ?? 0) >= (k === 'holiday' ? LIKE_MIN_HOLIDAYS : LIKE_MIN_WEEKDAYS);
  const round = (n: number) => Math.round(n * 10) / 10;
  const holidayText = holidaysInWindow.length ? holidaysInWindow.join(', ') : '';

  if (kinds.every(enough)) {
    const mean = (k: string) => samples.get(k)!.reduce((s, n) => s + n, 0) / samples.get(k)!.length;
    const expected = parts.reduce((s, p) => s + p.fraction * mean(p.kind), 0);
    const weekdays = kinds.filter((k) => k !== 'holiday');
    const weeks = Math.min(...weekdays.map((k) => samples.get(k)!.length));
    const text = [
      weekdays.length ? `Usual level from the same weekdays (${weekdays.map((k) => k.slice(0, 3)).join(', ')}) over the last ${weeks}+ weeks` : null,
      holidaysInWindow.length ? `${weekdays.length ? 'and' : 'Usual level from'} ${samples.get('holiday')!.length} earlier holidays (${holidayText} falls in this window)` : null,
    ]
      .filter(Boolean)
      .join(' ');
    return { current, usual: round(expected), ratio: round(current / Math.max(expected, floor)), status: 'ok', basis: { method: 'like-for-like', holidays: holidaysInWindow, text: `${text}.` }, anomaly: score(expected) };
  }

  const earlier = matching.filter((e) => at(e) >= historyStart && at(e) < start).length;
  const usual = earlier / windows;
  const missingHoliday = holidaysInWindow.length > 0 && !enough('holiday');
  const text = `Usual level is the plain average of all earlier days (same-weekday comparison needs ${LIKE_MIN_WEEKDAYS} earlier weeks)${missingHoliday ? `; ${holidayText} falls in this window and too few earlier holidays are recorded to compare with, so expect lower counts` : ''}.`;
  return { current, usual: round(usual), ratio: round(current / Math.max(usual, floor)), status: 'ok', basis: { method: 'all-days', holidays: holidaysInWindow, text }, anomaly: score(usual) };
}

/**
 * Meter level for a usual-level comparison (Phase 24): from how unusual the count is when the typical
 * spread is known (score 1 GUARDED, 2 ELEVATED, 3 HIGH), else from the ratio with the given cuts.
 */
export function levelFromUsual(u: Usual, ratioCuts: [number, number, number, number]): Exclude<MeterLevel, null> {
  if (u.anomaly?.status === 'ok') return levelFromAnomaly(u.anomaly, u.current);
  return levelFromScore(u.ratio ?? 0, ratioCuts);
}

/** Short reading of a usual-level comparison, e.g. "12 (usual 5, 2.4×; 2.1 spreads above normal)". */
export function fmtUsual(u: Usual): string {
  if (u.usual === null) return `${u.current} (usual: building)`;
  const how = u.anomaly?.status === 'ok' ? `; ${describe(u.anomaly)}` : '';
  return `${u.current} (usual ${u.usual}, ${u.ratio}×${how})`;
}

/** usualLevel over the meter input, with like-for-like holiday storage under `key`. */
export function usualFor(input: MeterInput, key: string, pred: (e: IntelligenceEvent) => boolean, windowHours: number, minDays = BASELINE_DAYS, floor = 1, historyStart: number | null = input.historyStart): Usual {
  return usualLevel(input.events, pred, input.now, windowHours, historyStart, minDays, floor, { key, holidays: input.holidayCounts, sink: input.holidaySink });
}

/** Score → level with thresholds for LOW, GUARDED, ELEVATED and HIGH (below the first = QUIET). */
export function levelFromScore(score: number, cuts: [low: number, guarded: number, elevated: number, high: number]): Exclude<MeterLevel, null> {
  if (score >= cuts[3]) return 4;
  if (score >= cuts[2]) return 3;
  if (score >= cuts[1]) return 2;
  if (score >= cuts[0]) return 1;
  return 0;
}

export const levelName = (l: MeterLevel) => (l === null ? 'N/A' : LEVEL_LABEL[l]);

/** Fills the boilerplate fields of a meter. */
export function meter(m: Omit<Meter, 'label' | 'value'> & { label?: string; value?: number | null }): Meter {
  return { ...m, label: m.label ?? levelName(m.level), value: m.value === undefined ? m.level : m.value };
}

export const fmtUsd = (n: number) => (n <= 0 ? '$0' : n >= 1e9 ? `$${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B` : n >= 1e6 ? `$${Math.round(n / 1e6)}M` : `$${Math.round(n / 1e3)}k`);
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
