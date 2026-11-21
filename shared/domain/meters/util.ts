import type { IntelligenceEvent } from '../types.ts';
import type { Meter, MeterEvidence, MeterLevel } from './types.ts';
import { LEVEL_LABEL } from './types.ts';

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
  /** Mean count per window over earlier history, or null while building. */
  usual: number | null;
  /** current / max(usual, floor), or null while building. */
  ratio: number | null;
  status: 'ok' | 'building';
}

/**
 * Count in the last `windowHours` against the mean per window over the earlier part of history.
 * Withheld (status 'building') until `minDays` of history exist.
 */
export function usualLevel(events: IntelligenceEvent[], pred: (e: IntelligenceEvent) => boolean, now: number, windowHours: number, historyStart: number | null, minDays = BASELINE_DAYS, floor = 1): Usual {
  const start = now - windowHours * H;
  const matching = events.filter(pred);
  const current = matching.filter((e) => at(e) >= start && at(e) <= now + H).length;
  if (historyStart === null || now - historyStart < minDays * DAY) return { current, usual: null, ratio: null, status: 'building' };
  const earlierSpan = start - historyStart;
  const windows = earlierSpan / (windowHours * H);
  if (windows < 1) return { current, usual: null, ratio: null, status: 'building' };
  const earlier = matching.filter((e) => at(e) >= historyStart && at(e) < start).length;
  const usual = earlier / windows;
  return { current, usual: Math.round(usual * 10) / 10, ratio: Math.round((current / Math.max(usual, floor)) * 10) / 10, status: 'ok' };
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
