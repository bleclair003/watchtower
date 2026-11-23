import { EVENT_CATEGORIES, type CollectionRun, type EventCategory } from '../types.ts';
import { WATCH_REGIONS } from '../regions.ts';
import { FEEDBACK_NOTE_MAX, FEEDBACK_VERDICTS, type AlertFeedback, type AlertRecord, type AlertSeverity, type FeedbackVerdict } from './types.ts';

/**
 * Alert feedback and the scorecard (v0.67.0).
 *
 * The owner and editors mark alerts useful / irrelevant / false positive / wrong category and log
 * incidents WATCHTOWER missed or caught late. The scorecard is computed in the browser from those
 * records and the collection runs: nothing here is estimated, and every share says how many it is out of.
 */

export const MISSED_KINDS = ['missed', 'late'] as const;
export type MissedKind = (typeof MISSED_KINDS)[number];

export interface MissedIncident {
  id: string;
  /** What happened, in your words. */
  title: string;
  /** When it happened (UTC ISO). */
  occurredAt: string;
  kind: MissedKind;
  /** For "late": hours between the event and WATCHTOWER's first record of it. */
  lateHours: number | null;
  regionIds: string[];
  category: EventCategory;
  /** Where you learned of it (https link), or empty. */
  url: string;
  note: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export const MISSED_TITLE_MAX = 160;
export const MISSED_NOTE_MAX = 1000;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/;

export function validateFeedback(f: AlertFeedback): string[] {
  const p: string[] = [];
  if (!FEEDBACK_VERDICTS.includes(f.verdict)) p.push('unknown verdict');
  if (typeof f.note !== 'string' || f.note.length > FEEDBACK_NOTE_MAX) p.push(`note must be at most ${FEEDBACK_NOTE_MAX} characters`);
  if (!ISO.test(f.at)) p.push('time must be UTC ISO');
  return p;
}

export function validateMissed(m: MissedIncident, now: number): string[] {
  const p: string[] = [];
  if (!m.title.trim()) p.push('Say what happened.');
  if (m.title.length > MISSED_TITLE_MAX) p.push(`Title: at most ${MISSED_TITLE_MAX} characters.`);
  if (!ISO.test(m.occurredAt) || Number.isNaN(Date.parse(m.occurredAt))) p.push('When it happened: a UTC date and time.');
  else if (Date.parse(m.occurredAt) > now + 60 * 60_000) p.push('When it happened is in the future.');
  if (!MISSED_KINDS.includes(m.kind)) p.push('Missed or late?');
  if (m.kind === 'late' && (m.lateHours == null || !(m.lateHours > 0) || m.lateHours > 24 * 90)) p.push('Late by how many hours (more than 0, at most 2,160)?');
  if (m.kind === 'missed' && m.lateHours != null) p.push('A missed incident has no lateness.');
  if (m.regionIds.length > 8 || m.regionIds.some((r) => !WATCH_REGIONS.some((w) => w.id === r))) p.push('Unknown region.');
  if (!EVENT_CATEGORIES.includes(m.category)) p.push('Unknown category.');
  if (m.url && !/^https:\/\/[^\s]+$/.test(m.url)) p.push('Link must start with https://');
  if (m.url.length > 500) p.push('Link: at most 500 characters.');
  if (m.note.length > MISSED_NOTE_MAX) p.push(`Note: at most ${MISSED_NOTE_MAX} characters.`);
  return p;
}

/** Below this many reviewed alerts, shares are shown but marked too few to judge. */
export const MIN_REVIEWED = 20;
/** A rule with this many reviews and fewer than NOISY_PRECISION useful is flagged for a look. */
export const NOISY_MIN = 5;
export const NOISY_PRECISION = 0.3;
const HIGH: AlertSeverity[] = ['WARNING', 'CRITICAL'];

export type VerdictCounts = Record<FeedbackVerdict, number>;
const zero = (): VerdictCounts => ({ useful: 0, irrelevant: 0, 'false-positive': 0, miscategorised: 0 });

export interface Share {
  n: number;
  of: number;
  /** null when `of` is 0. */
  share: number | null;
}
const share = (n: number, of: number): Share => ({ n, of, share: of ? n / of : null });

export interface RuleScore {
  ruleId: string;
  ruleName: string;
  /** Rule versions that produced the alerts in the window, oldest first. */
  versions: number[];
  alerts: number;
  reviewed: number;
  verdicts: VerdictCounts;
  useful: Share;
  noisy: boolean;
}

export interface Scorecard {
  windowDays: number;
  since: string;
  /** Alerts created in the window (the query may be capped; see `capped`). */
  alerts: number;
  capped: boolean;
  reviewed: Share;
  verdicts: VerdictCounts;
  /** Useful share of reviewed alerts. */
  useful: Share;
  falsePositive: Share;
  /** Useful share of reviewed WARNING and CRITICAL alerts. */
  highUseful: Share;
  bySeverity: { severity: AlertSeverity; reviewed: number; useful: Share }[];
  rules: RuleScore[];
  enoughReviews: boolean;
  missed: {
    total: number;
    missed: number;
    late: number;
    /** Median hours late over "late" entries. */
    medianLateHours: number | null;
    byRegion: { regionId: string; count: number }[];
    byCategory: { category: EventCategory; count: number }[];
  };
  runs: {
    days: number;
    count: number;
    /** Hourly schedule: runs expected in the window. */
    expected: number;
    clean: Share;
    /** Sources with the most failed runs. */
    failingSources: { sourceId: string; runs: number }[];
  } | null;
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export interface ScorecardInput {
  now: number;
  windowDays: number;
  /** Alerts created in the window. */
  alerts: AlertRecord[];
  capped?: boolean;
  missed: MissedIncident[];
  /** Collection runs from the last `runDays` days, or null when not loaded. */
  runs: CollectionRun[] | null;
  runDays?: number;
}

export function buildScorecard(input: ScorecardInput): Scorecard {
  const sinceMs = input.now - input.windowDays * 86_400_000;
  const since = new Date(sinceMs).toISOString();
  const alerts = input.alerts.filter((a) => a.createdAt >= since);
  const reviewed = alerts.filter((a) => a.feedback);
  const verdicts = zero();
  for (const a of reviewed) verdicts[a.feedback!.verdict]++;

  const bySeverity = (['CRITICAL', 'WARNING', 'ADVISORY', 'INFORMATION'] as AlertSeverity[])
    .map((severity) => {
      const r = reviewed.filter((a) => a.severity === severity);
      return { severity, reviewed: r.length, useful: share(r.filter((a) => a.feedback!.verdict === 'useful').length, r.length) };
    })
    .filter((s) => s.reviewed > 0 || alerts.some((a) => a.severity === s.severity));
  const high = reviewed.filter((a) => HIGH.includes(a.severity));

  const ruleMap = new Map<string, AlertRecord[]>();
  for (const a of alerts) ruleMap.set(a.ruleId, [...(ruleMap.get(a.ruleId) ?? []), a]);
  const rules: RuleScore[] = [...ruleMap.entries()].map(([ruleId, list]) => {
    const rv = list.filter((a) => a.feedback);
    const v = zero();
    for (const a of rv) v[a.feedback!.verdict]++;
    const latest = list.reduce((x, y) => (y.createdAt > x.createdAt ? y : x));
    const useful = share(v.useful, rv.length);
    return {
      ruleId,
      ruleName: latest.ruleName,
      versions: [...new Set(list.map((a) => a.ruleVersion))].sort((a, b) => a - b),
      alerts: list.length,
      reviewed: rv.length,
      verdicts: v,
      useful,
      noisy: rv.length >= NOISY_MIN && (useful.share ?? 1) < NOISY_PRECISION,
    };
  });
  rules.sort((a, b) => Number(b.noisy) - Number(a.noisy) || b.alerts - a.alerts || a.ruleName.localeCompare(b.ruleName));

  const missed = input.missed.filter((m) => m.occurredAt >= since);
  const count = <K extends string>(keys: K[]) => {
    const m = new Map<K, number>();
    for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };

  let runs: Scorecard['runs'] = null;
  if (input.runs) {
    const days = input.runDays ?? 7;
    const runSince = new Date(input.now - days * 86_400_000).toISOString();
    const rs = input.runs.filter((r) => r.startedAt >= runSince && r.mode !== 'evaluate-only' && r.trigger !== 'local');
    const failing = count(rs.flatMap((r) => [...new Set(r.errors.map((e) => e.sourceId))]));
    runs = {
      days,
      count: rs.length,
      expected: days * 24,
      clean: share(rs.filter((r) => r.errors.length === 0).length, rs.length),
      failingSources: failing.slice(0, 5).map(([sourceId, n]) => ({ sourceId, runs: n })),
    };
  }

  return {
    windowDays: input.windowDays,
    since,
    alerts: alerts.length,
    capped: !!input.capped,
    reviewed: share(reviewed.length, alerts.length),
    verdicts,
    useful: share(verdicts.useful, reviewed.length),
    falsePositive: share(verdicts['false-positive'], reviewed.length),
    highUseful: share(high.filter((a) => a.feedback!.verdict === 'useful').length, high.length),
    bySeverity,
    rules,
    enoughReviews: reviewed.length >= MIN_REVIEWED,
    missed: {
      total: missed.length,
      missed: missed.filter((m) => m.kind === 'missed').length,
      late: missed.filter((m) => m.kind === 'late').length,
      medianLateHours: median(missed.filter((m) => m.kind === 'late' && m.lateHours != null).map((m) => m.lateHours!)),
      byRegion: count(missed.flatMap((m) => (m.regionIds.length ? m.regionIds : ['none']))).map(([regionId, n]) => ({ regionId, count: n })),
      byCategory: count(missed.map((m) => m.category)).map(([category, n]) => ({ category, count: n })),
    },
    runs,
  };
}

/** Plain-text percentage for a share, or a dash. */
export function pct(s: Share): string {
  return s.share == null ? '—' : `${Math.round(s.share * 100)}%`;
}
