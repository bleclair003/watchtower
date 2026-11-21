import type { IntelligenceEvent, SourceStatus } from './types.ts';
import { getSource } from './sources.ts';

/**
 * Phase 15 item 8: missing regulars — a source that normally publishes every day has gone quiet,
 * while WATCHTOWER can still reach it. (Sources that fail to load are already reported by source
 * health as STALE or OFFLINE.)
 *
 *  - Regular: new items on at least 80% of days over its history (7+ days needed), judged by when
 *    WATCHTOWER first collected each item, not the date the feed gives.
 *  - Quiet: no new item for longer than the larger of 24 hours and three times its usual gap
 *    between items.
 */

export const REGULAR_DAY_SHARE = 0.8;
export const REGULAR_MIN_DAYS = 7;
export const QUIET_MIN_HOURS = 24;
export const QUIET_GAP_FACTOR = 3;

export interface SourceCadence {
  sourceId: string;
  name: string;
  /** 'building' until 7 days of history; 'irregular' = posts on fewer than 80% of days. */
  status: 'regular' | 'irregular' | 'building';
  /** Share of days with a new item. */
  dayShare: number;
  usualPerDay: number;
  /** Median gap between new items, hours. */
  usualGapHours: number | null;
  lastNewAt: string | null;
  hoursSinceNew: number | null;
  /** The threshold it is held to (hours). */
  quietAfterHours: number | null;
  quiet: boolean;
  /** The source itself is reachable (last fetch succeeded). */
  reachable: boolean;
}

const H = 3_600_000;
const DAY = 24 * H;

export function sourceCadence(events: IntelligenceEvent[], statuses: SourceStatus[], now: number, historyStart: number | null): SourceCadence[] {
  const by = new Map<string, number[]>();
  for (const e of events) {
    const t = Date.parse(e.collectedAt);
    if (Number.isFinite(t) && t <= now) by.set(e.sourceId, [...(by.get(e.sourceId) ?? []), t]);
  }
  const days = historyStart === null ? 0 : Math.floor((now - historyStart) / DAY);
  return [...by].map(([sourceId, times]): SourceCadence => {
    // Items collected in one run arrive together: count distinct collection moments (to the minute).
    const moments = [...new Set(times.map((t) => Math.floor(t / 60_000) * 60_000))].sort((a, b) => a - b);
    const status = statuses.find((s) => s.sourceId === sourceId);
    const lastNew = Math.max(moments[moments.length - 1], status?.lastNewItemAt ? Date.parse(status.lastNewItemAt) : -Infinity);
    const reachable = !!status?.lastSuccessAt && (!status.lastAttemptAt || status.lastSuccessAt >= status.lastAttemptAt);
    const name = getSource(sourceId)?.name ?? sourceId;
    const fullDays = Math.max(0, days);
    const activeDays = new Set(moments.filter((t) => historyStart !== null && t >= historyStart).map((t) => Math.floor((t - historyStart!) / DAY))).size;
    const dayShare = fullDays ? Math.min(1, activeDays / fullDays) : 0;
    const gaps = moments.slice(1).map((t, i) => (t - moments[i]) / H);
    const sorted = [...gaps].sort((a, b) => a - b);
    const usualGapHours = sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10 : null;
    const hoursSinceNew = Number.isFinite(lastNew) ? Math.round(((now - lastNew) / H) * 10) / 10 : null;
    const st: SourceCadence['status'] = fullDays < REGULAR_MIN_DAYS ? 'building' : dayShare >= REGULAR_DAY_SHARE ? 'regular' : 'irregular';
    const quietAfterHours = st === 'regular' ? Math.max(QUIET_MIN_HOURS, QUIET_GAP_FACTOR * (usualGapHours ?? 8)) : null;
    return {
      sourceId,
      name,
      status: st,
      dayShare: Math.round(dayShare * 100) / 100,
      usualPerDay: fullDays ? Math.round((times.length / fullDays) * 10) / 10 : 0,
      usualGapHours,
      lastNewAt: Number.isFinite(lastNew) ? new Date(lastNew).toISOString() : null,
      hoursSinceNew,
      quietAfterHours,
      quiet: st === 'regular' && reachable && hoursSinceNew !== null && quietAfterHours !== null && hoursSinceNew > quietAfterHours,
      reachable,
    };
  });
}
