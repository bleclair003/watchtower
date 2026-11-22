import type { ConflictEvent } from '@shared/domain/conflictEvents';
import type { NavWarning } from '@shared/domain/navWarnings';

/**
 * Time filters for dated map layers (v0.61.0).
 *
 * Conflict events (UCDP) arrive about a month late, so "recent" is counted back from the newest day in
 * the release, not from today: a window measured from today would always be empty.
 * Navigational warnings carry their issue time, so they are counted back from now.
 */

const DAY = 86_400_000;

export const CONFLICT_SPANS: { days: number | null; label: string }[] = [
  { days: null, label: 'WHOLE MONTH' },
  { days: 14, label: 'LAST 14 DAYS' },
  { days: 7, label: 'LAST 7 DAYS' },
  { days: 3, label: 'LAST 3 DAYS' },
];

export const NAV_AGES: { days: number | null; label: string }[] = [
  { days: null, label: 'ANY AGE' },
  { days: 30, label: 'ISSUED ≤30D' },
  { days: 7, label: 'ISSUED ≤7D' },
  { days: 2, label: 'ISSUED ≤48H' },
];

export interface ConflictWindow {
  events: ConflictEvent[];
  /** First and last day shown (YYYY-MM-DD), or null when there are no events. */
  from: string | null;
  to: string | null;
}

/** Conflict events from the last `days` days of the release (counting the newest day as day 1). */
export function recentConflicts(events: ConflictEvent[], days: number | null): ConflictWindow {
  if (!events.length) return { events, from: null, to: null };
  const newest = events.reduce((m, e) => (e.d > m ? e.d : m), events[0].d);
  const oldest = events.reduce((m, e) => (e.d < m ? e.d : m), events[0].d);
  if (days == null) return { events, from: oldest, to: newest };
  const fromDay = new Date(Date.parse(`${newest}T00:00:00Z`) - (days - 1) * DAY).toISOString().slice(0, 10);
  const from = fromDay > oldest ? fromDay : oldest;
  return { events: events.filter((e) => e.d >= fromDay), from, to: newest };
}

/** Warnings issued in the last `days` days. Warnings without an issue time are left out when a limit is set. */
export function recentNavWarnings(warnings: NavWarning[], days: number | null, now: number): NavWarning[] {
  if (days == null) return warnings;
  const cutoff = now - days * DAY;
  return warnings.filter((w) => {
    const t = w.issuedAt ? Date.parse(w.issuedAt) : NaN;
    return Number.isFinite(t) && t >= cutoff;
  });
}
