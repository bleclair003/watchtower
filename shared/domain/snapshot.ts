import type { CollectionRun, IntelligenceEvent, SourceStatus } from './types.ts';
import type { IndicatorEvaluation, RegionScore, ScoreHistoryPoint } from './indicators/types.ts';
import type { AlertRuleProblem } from './alerts/types.ts';

/**
 * Precomputed dashboard payload, written by the collector to
 * `snapshots/dashboard` after every run. The dashboard loads with ONE
 * Firestore read instead of one read per event (see ARCHITECTURE.md §4.3).
 *
 * Firestore documents are capped at 1 MiB; the collector trims `events`
 * until the serialized snapshot fits under SNAPSHOT_MAX_BYTES.
 */
export const SNAPSHOT_COLLECTION = 'snapshots';
export const SNAPSHOT_DOC_ID = 'dashboard';
export const SNAPSHOT_MAX_EVENTS = 400;
export const SNAPSHOT_MAX_BYTES = 900_000;
export const SNAPSHOT_SCHEMA_VERSION = 2;

export interface DashboardSnapshot {
  schemaVersion: number;
  generatedAt: string;
  /** Newest first, by publishedAt ?? collectedAt. */
  events: IntelligenceEvent[];
  sourceStatus: SourceStatus[];
  lastRun: CollectionRun | null;
  /** Totals so the UI can say "showing 400 of 1,234". */
  totalEventsStored: number | null;
  // --- Phase 3 (optional: absent in schema v1 snapshots) ---
  indicatorCatalogVersion?: number;
  indicatorEvaluations?: IndicatorEvaluation[];
  regionScores?: RegionScore[];
  /** Recent RAI values, for 24 h change and sparklines. */
  scoreHistory?: ScoreHistoryPoint[];
  // --- Phase 4 ---
  /** Stored alert rules that failed validation and were NOT evaluated. */
  alertRuleProblems?: AlertRuleProblem[];
  /** Enabled, valid alert rules evaluated in the last run. */
  activeAlertRules?: number;
  /** Whether a Discord webhook was configured for the last run. */
  discordConfigured?: boolean;
}

/** Firestore collection names — single source of truth for app and collector. */
export const COLLECTIONS = {
  events: 'events',
  sourceStatus: 'sourceStatus',
  sourceState: 'sourceState',
  collectionRuns: 'collectionRuns',
  snapshots: SNAPSHOT_COLLECTION,
  /** Append-only log of indicator state changes (for Phase 6 backtesting). */
  indicatorHistory: 'indicatorHistory',
  alertRules: 'alertRules',
  alerts: 'alerts',
  /** Collector-internal bookkeeping (e.g. notification cooldowns). Not client-readable. */
  collectorState: 'collectorState',
} as const;
