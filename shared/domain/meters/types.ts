import type { SpeedReport } from '../speed.ts';
import type { TrackRecordReport } from '../trackRecord.ts';
/**
 * Phase 14: meters and monitors. Each meter is a deterministic reading over data WATCHTOWER already
 * collects. It shows its evidence, the date its data is from, and whether its usual level (baseline)
 * is known yet. A meter describes activity in the monitored sources; it is never a probability of
 * conflict, attack or any other event.
 */

/** 0 quiet · 1 low · 2 guarded · 3 elevated · 4 high; null = not evaluable (no data). */
export type MeterLevel = 0 | 1 | 2 | 3 | 4 | null;

export const LEVEL_LABEL: Record<Exclude<MeterLevel, null>, string> = { 0: 'QUIET', 1: 'LOW', 2: 'GUARDED', 3: 'ELEVATED', 4: 'HIGH' };

export type MeterKind =
  | 'escalation'
  | 'evacuation'
  | 'buildup'
  | 'air-surge'
  | 'naval'
  | 'maritime'
  | 'sanctions'
  | 'arms'
  | 'washington'
  | 'diplomatic'
  | 'strategic'
  | 'blackout'
  | 'power'
  | 'airspace'
  | 'radiation'
  | 'space-weather'
  | 'economic'
  | 'humanitarian'
  | 'homeland'
  | 'cyber'
  | 'after-hours'
  | 'markets'
  | 'infrastructure'
  | 'language'
  | 'actors'
  | 'coverage'
  | 'quiet'
  | 'corroboration'
  | 'visibility';

export type MeterFamily = 'region' | 'topic' | 'quality';

export interface MeterComponent {
  label: string;
  value: string;
  /** Whether this component is currently contributing (drawn highlighted). */
  active?: boolean;
  note?: string;
}

export interface MeterEvidence {
  title: string;
  url?: string;
  at?: string;
  /** Why this item counts. */
  why?: string;
}

export interface Meter {
  /** `${kind}.${regionId}` or `${kind}.${scope}` or `${kind}` (global). */
  id: string;
  kind: MeterKind;
  family: MeterFamily;
  name: string;
  regionId: string | null;
  level: MeterLevel;
  /** Shown instead of the level name when the meter has its own scale (e.g. "RUNG 3 · KINETIC", "78%"). */
  label: string;
  /** Numeric reading kept in the history (level, rung, ratio or percentage). */
  value: number | null;
  /** One-line reading. */
  reading: string;
  components: MeterComponent[];
  evidence: MeterEvidence[];
  /** Newest data the reading rests on (ISO), or null. */
  asOf: string | null;
  /** 'building' = the usual level is not known yet, so comparisons are withheld. */
  baseline: 'ok' | 'building' | 'none';
  /** Plain-language limits shown with the meter. */
  notes: string[];
  /** How the usual level was worked out (like-for-like or plain average), when the meter uses one. */
  baselineBasis?: string | null;
}

export interface DaysSinceCounter {
  id: string;
  label: string;
  /** Most recent occurrence seen (carried across runs), or null if none since records began. */
  lastAt: string | null;
  title: string | null;
  url: string | null;
  /** Explains what counts. */
  rule: string;
}

export interface CalendarItem {
  at: string;
  title: string;
  kind: 'launch' | 'hearing' | 'known-date' | 'other';
  url: string | null;
  source: string;
  regionIds: string[];
}

export interface LeadLagRow {
  meterKind: MeterKind;
  /** RAI rises examined (a rise = +10 or more within 24 h in a region). */
  rises: number;
  /** The meter rose in the 72 h before the RAI rise. */
  led: number;
  /** The meter rose in the 24 h after. */
  followed: number;
  /** No change around the rise. */
  flat: number;
}

export interface LeadLagResult {
  computedAt: string;
  historyDays: number;
  /** Fewer rises than this and no conclusions are drawn. */
  minRises: number;
  rows: LeadLagRow[];
  note: string;
}

export interface MetersSnapshot {
  computedAt: string;
  /** Days of stored records the meters could use. */
  historyDays: number;
  /** Days needed before usual-level comparisons are made. */
  baselineDays: number;
  meters: Meter[];
  counters: DaysSinceCounter[];
  calendar: CalendarItem[];
  /** Recent runs, oldest first: `at` and packed values (`id=value;…`) for sparklines. */
  history: { at: string; packed: string }[];
  leadLag: LeadLagResult | null;
  /** Who's first: outlets within shared stories; sensors and official sources against the news (30 days). */
  speed?: SpeedReport | null;
  /** How often each source's leading reports were carried by another publisher (30 days). */
  trackRecord?: TrackRecordReport | null;
  simulated?: boolean;
}
