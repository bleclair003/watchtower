/**
 * Internet censorship (Phase 23): OONI (Open Observatory of Network Interference) measurements of
 * whether key messaging apps and sites are reachable in watch-region countries. A test is "failed"
 * when OONI marks it anomalous or confirms a block page. Licensed CC BY-NC-SA 4.0 (attribution to
 * OONI; derived data under the same licence).
 */
import { regionsForCountry } from './regions.ts';

export interface CensorshipTarget {
  id: string;
  label: string;
  /** OONI aggregation query part: an app test or a web_connectivity domain. */
  query: string;
}

export const CENSOR_TARGETS: CensorshipTarget[] = [
  { id: 'whatsapp', label: 'WhatsApp', query: 'test_name=whatsapp' },
  { id: 'telegram', label: 'Telegram', query: 'test_name=telegram' },
  { id: 'signal', label: 'Signal', query: 'test_name=signal' },
  { id: 'youtube', label: 'YouTube', query: 'test_name=web_connectivity&domain=www.youtube.com' },
  { id: 'instagram', label: 'Instagram', query: 'test_name=web_connectivity&domain=www.instagram.com' },
  { id: 'twitter', label: 'X / Twitter', query: 'test_name=web_connectivity&domain=twitter.com' },
  { id: 'facebook', label: 'Facebook', query: 'test_name=web_connectivity&domain=www.facebook.com' },
];

/** Watch-region countries measured (two are read per run, in turn). */
export const CENSOR_COUNTRIES: { cc: string; name: string }[] = [
  { cc: 'RU', name: 'Russia' },
  { cc: 'BY', name: 'Belarus' },
  { cc: 'UA', name: 'Ukraine' },
  { cc: 'IR', name: 'Iran' },
  { cc: 'IQ', name: 'Iraq' },
  { cc: 'SY', name: 'Syria' },
  { cc: 'YE', name: 'Yemen' },
  { cc: 'EG', name: 'Egypt' },
  { cc: 'SA', name: 'Saudi Arabia' },
  { cc: 'TR', name: 'Turkey' },
  { cc: 'CN', name: 'China' },
  { cc: 'VN', name: 'Vietnam' },
];

export type CensorStatus = 'blocked' | 'partial' | 'ok' | 'no-data';

export interface TargetReading {
  id: string;
  status: CensorStatus;
  /** Share of failed tests (0–1) in the last 2 days and the 14 days before. */
  share: number | null;
  priorShare: number | null;
  tests: number;
  /** Newly blocked or partly blocked compared with the 14 days before. */
  isNew: boolean;
}

export interface CountryCensorship {
  cc: string;
  name: string;
  regionIds: string[];
  fetchedAt: string;
  targets: TargetReading[];
}

export interface CensorshipSnapshot {
  countries: CountryCensorship[];
  simulated?: boolean;
}

/** Fewer tests than this in the window: no verdict. */
export const MIN_TESTS = 10;
export const BLOCKED_SHARE = 0.5;
export const PARTIAL_SHARE = 0.2;
/** A "new" block must be at least this much higher than the 14 days before. */
export const NEW_RISE = 0.25;

export interface DayRow {
  measurement_count?: number;
  anomaly_count?: number;
  confirmed_count?: number;
  measurement_start_day?: string;
}

const failShare = (rows: DayRow[]) => {
  const n = rows.reduce((a, r) => a + (r.measurement_count ?? 0), 0);
  const f = rows.reduce((a, r) => a + (r.anomaly_count ?? 0) + (r.confirmed_count ?? 0), 0);
  return { n, share: n ? Math.min(1, f / n) : null };
};
const statusOf = (n: number, share: number | null): CensorStatus => (n < MIN_TESTS || share === null ? 'no-data' : share >= BLOCKED_SHARE ? 'blocked' : share >= PARTIAL_SHARE ? 'partial' : 'ok');

/** Reads 16 days of daily rows: the last 2 days against the 14 before. Pure. */
export function readTarget(id: string, rows: DayRow[]): TargetReading {
  const sorted = [...rows].sort((a, b) => String(a.measurement_start_day).localeCompare(String(b.measurement_start_day)));
  const recent = failShare(sorted.slice(-2));
  const prior = failShare(sorted.slice(0, -2));
  const status = statusOf(recent.n, recent.share);
  const priorStatus = statusOf(prior.n, prior.share);
  // New: blocked or partly blocked now, and at least 25 points higher than before (enough earlier tests to
  // tell) — small drifts across the 20% line are noise.
  const isNew = (status === 'blocked' || status === 'partial') && priorStatus !== 'no-data' && prior.n >= 20 && prior.share !== null && recent.share !== null && recent.share - prior.share >= NEW_RISE;
  const round = (x: number | null) => (x === null ? null : Math.round(x * 100) / 100);
  return { id, status, share: round(recent.share), priorShare: round(prior.share), tests: recent.n, isNew };
}

export const countryRegions = (cc: string) => regionsForCountry(cc);
export const targetLabel = (id: string) => CENSOR_TARGETS.find((t) => t.id === id)?.label ?? id;
