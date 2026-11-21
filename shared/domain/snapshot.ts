import type { CollectionRun, IntelligenceEvent, SourceStatus } from './types.ts';
import type { IndicatorEvaluation, RegionScore, ScoreHistoryPoint } from './indicators/types.ts';
import type { AlertRuleProblem } from './alerts/types.ts';
import type { AircraftSnapshot } from './aircraft.ts';
import type { FleetSnapshot } from './fleet.ts';
import type { ChokepointSnapshot } from './chokepoints.ts';
import type { SanctionedShipsSnapshot } from './sanctionedShips.ts';
import type { DisplacementSnapshot } from './displacement.ts';
import type { BaseActivitySnapshot } from './baseActivity.ts';
import type { PredictionMarketsSnapshot } from './predictionMarkets.ts';

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
/** Meters and monitors (Phase 14), kept apart from the dashboard snapshot so they never crowd out the feed. */
export const METERS_DOC_ID = 'meters';
export const SNAPSHOT_MAX_EVENTS = 700;
/** Summaries are shortened in the snapshot only; the full text stays in the `events` collection. */
export const SNAPSHOT_SUMMARY_CHARS = 280;
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
  // --- Phase 13 ---
  /** Latest military aircraft positions (ADS-B), from the last successful fetch. */
  aircraft?: AircraftSnapshot;
  /** Latest USNI News Fleet and Marine Tracker (weekly), parsed into areas and ships. */
  fleet?: FleetSnapshot;
  /** Daily chokepoint transits (IMF PortWatch), with status. */
  chokepoints?: ChokepointSnapshot;
  /** Sanctioned vessels seen on AIS in the Baltic and North Sea (last 48 h). */
  sanctionedShips?: SanctionedShipsSnapshot;
  /** UNHCR displacement figures per watch-region country (latest and previous year). */
  displacement?: DisplacementSnapshot;
  /** Records naming or near each installation this week, against its usual weekly level. */
  baseActivity?: BaseActivitySnapshot;
  /** Prediction-market odds on watch-region questions (Polymarket). */
  predictionMarkets?: PredictionMarketsSnapshot;
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
  /** One watchlist per user (`watchlists/{uid}`), owner-managed (Phase 13). */
  watchlists: 'watchlists',
  alerts: 'alerts',
  /** Collector-internal bookkeeping (e.g. notification cooldowns). Not client-readable. */
  collectorState: 'collectorState',
  /** Operator-curated incident dossiers (Phase 5). */
  incidents: 'incidents',
  /** One RAI point per collection run, kept long-term for trends and SITREP comparisons (Phase 6). */
  raiHistory: 'raiHistory',
  /** Collector-only cache: one document per collection day holding that day's events (v0.9.4). Not client-readable. */
  eventDays: 'eventDays',
} as const;
