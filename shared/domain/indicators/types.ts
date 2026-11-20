import type { Condition } from './conditions.ts';

/**
 * Indicator & Warning Engine (IWE) domain types.
 *
 * An indicator is a DECLARATIVE, deterministic test over collected events:
 * "how many events matching <condition> were published in the last <window>
 * hours, from how many independent sources, compared with <baseline>?"
 * There is no executable code in a definition — see conditions.ts.
 */

export type IndicatorState =
  | 'NORMAL'
  | 'ELEVATED'
  | 'TRIGGERED'
  /** A required source was unhealthy during the window — absence of evidence is not evidence of calm. */
  | 'UNKNOWN'
  /** A required source has never been collected (no adapter, or never succeeded). */
  | 'DATA_UNAVAILABLE'
  | 'DISABLED';

export type IndicatorSeverity = 'low' | 'medium' | 'high';

export type IndicatorFamily =
  | 'official-activity'
  | 'aviation'
  | 'maritime'
  | 'cyber'
  | 'diplomatic'
  | 'information-environment'
  | 'experimental';

export interface Threshold {
  /** Minimum number of distinct matching events in the window. */
  countAtLeast: number;
  /** Minimum number of distinct sources among matching events (default 1). */
  distinctSourcesAtLeast?: number;
}

export interface BaselineSpec {
  /** Days of history before the current window used to compute the mean per window. */
  days: number;
  /** TRIGGERED additionally requires count ≥ ratio × baseline mean (when the baseline is sufficient). */
  triggerRatio: number;
  /** ELEVATED additionally requires count ≥ ratio × baseline mean (when the baseline is sufficient). */
  elevatedRatio: number;
}

export interface IndicatorDefinition {
  id: string;
  name: string;
  description: string;
  family: IndicatorFamily;
  /** Watch region this indicator contributes to (one region per indicator). */
  regionId: string;
  /** Sources whose health gates evaluation (UNKNOWN / DATA_UNAVAILABLE). */
  requiredSourceIds: string[];
  /** Which events count as evidence. */
  match: Condition;
  windowHours: number;
  elevated: Threshold;
  triggered: Threshold;
  baseline: BaselineSpec | null;
  weight: number;
  severity: IndicatorSeverity;
  /** Experimental signals never contribute to the RAI. */
  experimental: boolean;
  enabled: boolean;
  /** Bump when the definition changes; recorded with every evaluation. */
  configVersion: number;
  /** Why this indicator exists and what it does NOT mean. */
  rationale: string;
  /** Research record for experimental signals (PDD §7.3). */
  research?: ExperimentalResearch;
}

export interface ExperimentalResearch {
  hypothesis: string;
  dataAvailability: string;
  baselinePeriod: string;
  expectedRelationship: string;
  historicalExamples: string;
  confounders: string;
  falsePositives: string;
  retrospectiveResults: string;
  evidenceQuality: 'none' | 'anecdotal' | 'weak' | 'moderate' | 'strong';
}

export interface BaselineResult {
  status: 'not-configured' | 'sufficient' | 'insufficient-history';
  /** Mean matching events per window over the baseline period. */
  meanPerWindow: number | null;
  /** History actually available, in days. */
  historyDays: number;
}

export interface IndicatorEvaluation {
  indicatorId: string;
  regionId: string;
  state: IndicatorState;
  /** Human-readable explanation of why the state was reached. */
  reason: string;
  evaluatedAt: string;
  configVersion: number;
  matchedCount: number;
  distinctSources: number;
  /** Effective thresholds after baseline adjustment. */
  elevatedAt: number;
  triggeredAt: number;
  baseline: BaselineResult;
  /** Matching event ids, newest first, capped. */
  evidenceEventIds: string[];
  /** When the indicator most recently entered TRIGGERED (carried across runs). */
  lastTriggeredAt: string | null;
  /** When the current state began (carried across runs). */
  stateSince: string;
}

export interface IndicatorTransition {
  indicatorId: string;
  regionId: string;
  from: IndicatorState | null;
  to: IndicatorState;
  at: string;
  reason: string;
  evidenceEventIds: string[];
  configVersion: number;
}

export interface RegionScoreContribution {
  indicatorId: string;
  name: string;
  state: IndicatorState;
  weight: number;
  severity: IndicatorSeverity;
  /** Points before the per-source cap. */
  raw: number;
  /** Points after the per-source cap. */
  applied: number;
  capped: boolean;
}

export interface RegionScore {
  regionId: string;
  /** 0–100, or null when no indicator for the region could be evaluated. */
  score: number | null;
  band: RaiBand | null;
  /** Share of the region's enabled, non-experimental indicators that could be evaluated (0–1). */
  coverage: number;
  activeIndicators: number;
  contributions: RegionScoreContribution[];
  evaluatedAt: string;
}

export type RaiBand = 'BASELINE' | 'INCREASED' | 'ELEVATED' | 'SIGNIFICANT' | 'EXCEPTIONAL';

export interface ScoreHistoryPoint {
  at: string;
  scores: Record<string, number | null>;
}
