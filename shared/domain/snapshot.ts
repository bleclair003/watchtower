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
import type { InfrastructureSnapshot } from './infrastructure.ts';
import type { PowerOutageSnapshot } from './powerOutages.ts';
import type { AirportStatusSnapshot, AirspaceNoticesSnapshot, TfrSnapshot } from './faa.ts';
import type { RadiationSnapshot } from './radiation.ts';
import type { SpaceWeatherSnapshot } from './spaceWeather.ts';
import type { CyberSnapshot } from './cyber.ts';
import type { UkraineFrontSnapshot } from './ukraineFront.ts';
import type { CensorshipSnapshot } from './censorship.ts';
import type { NavWarningSnapshot } from './navWarnings.ts';
import type { EmergencySnapshot } from './aircraftEmergencies.ts';
import type { GnssSnapshot } from './gnss.ts';
import type { NetAttackSnapshot } from './netAttacks.ts';
import type { RadioReceiversSnapshot } from './radio.ts';
import type { ConflictSnapshot } from './conflictEvents.ts';
import type { ActorsSnapshot } from './actors.ts';

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
/** Radio guide (Phase 29): shortwave schedules and local stations, read only by the radio panels. */
export const RADIO_GUIDE_DOC_ID = 'radio';
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
  /** Critical infrastructure with records near or naming it in the last 72 hours. */
  infrastructure?: InfrastructureSnapshot;
  /** US customers without power by state and county (ODIN), from the last successful fetch. */
  powerOutages?: PowerOutageSnapshot;
  /** FAA security, VIP and special flight restrictions with times and outlines. */
  tfrs?: TfrSnapshot;
  /** FAA airport status: ground stops, ground delay programs, delays, closures. */
  airportStatus?: AirportStatusSnapshot;
  /** FAA prohibitions and advisories for US civil aviation abroad. */
  airspaceNotices?: AirspaceNoticesSnapshot;
  /** Radiation networks (Germany, Finland, US): summaries and stations above their usual level. */
  radiation?: RadiationSnapshot;
  /** Space weather: NOAA scales, Kp, CMEs predicted to reach Earth (NASA DONKI), NOAA messages. */
  spaceWeather?: SpaceWeatherSnapshot;
  /** CYBER page: KEV (30 d) with EPSS, CISA advisories, national cyber agencies, internet disruptions. */
  cyber?: CyberSnapshot;
  /** Ukraine front: General Staff daily activity per sector and territorial claims in headlines. */
  ukraineFront?: UkraineFrontSnapshot;
  /** OONI censorship readings per watch-region country (apps and sites). */
  censorship?: CensorshipSnapshot;
  /** Active NGA navigational warnings of notable kinds (Phase 25). */
  navWarnings?: NavWarningSnapshot;
  /** Aircraft squawking an emergency code (Phase 25). */
  aircraftEmergencies?: EmergencySnapshot;
  /** GPS interference from aircraft position accuracy, last 24 hours (v0.69.0). */
  gnss?: GnssSnapshot;
  /** Route hijacks and leaks involving watch-region countries, and DDoS levels per country (v0.70.0). */
  netAttacks?: NetAttackSnapshot;
  /** Public shortwave receivers for radio links (Phase 28). */
  radioReceivers?: RadioReceiversSnapshot;
  /** UCDP conflict events, latest monthly release (Phase 25). */
  conflictEvents?: ConflictSnapshot;
  /** Tracked people and groups, and new names in headlines. */
  actors?: ActorsSnapshot;
  /** Daily sources that have gone quiet while reachable (for the brief and Diagnostics). */
  quietSources?: { sourceId: string; name: string; hoursSinceNew: number; usualPerDay: number }[];
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
  /** People and their roles (v0.60.0): `members/{uid}`. Owner and that person only. */
  members: 'members',
  /** v0.67.0: incidents WATCHTOWER missed or caught late, logged by the owner or editors for the scorecard. */
  missedIncidents: 'missedIncidents',
  /** v0.74.0: watch areas drawn by the owner and editors (shared). */
  watchAreas: 'watchAreas',
} as const;

/**
 * Map and page layers live in their own document (v0.54.0) so they never push records out of the feed:
 * the dashboard document keeps the events, scores and health within its size budget, and the layers
 * document (one extra read) holds everything below.
 */
export const LAYERS_DOC_ID = 'layers';
export const LAYER_KEYS = [
  'aircraft',
  'fleet',
  'chokepoints',
  'sanctionedShips',
  'displacement',
  'baseActivity',
  'predictionMarkets',
  'infrastructure',
  'actors',
  'powerOutages',
  'tfrs',
  'airportStatus',
  'airspaceNotices',
  'radiation',
  'spaceWeather',
  'cyber',
  'ukraineFront',
  'censorship',
  'navWarnings',
  'aircraftEmergencies',
  'gnss',
  'netAttacks',
  'conflictEvents',
  'radioReceivers',
] as const satisfies readonly (keyof DashboardSnapshot)[];
export type LayerKey = (typeof LAYER_KEYS)[number];
export type LayersSnapshot = Partial<Pick<DashboardSnapshot, LayerKey>> & { generatedAt: string };

/** Splits a snapshot into the dashboard document (no layers) and the layers document. Pure. */
export function splitSnapshot(s: DashboardSnapshot): { main: DashboardSnapshot; layers: LayersSnapshot } {
  const main = { ...s } as Record<string, unknown>;
  const layers: Record<string, unknown> = { generatedAt: s.generatedAt };
  for (const k of LAYER_KEYS) {
    if (k in main) {
      if (main[k] !== undefined) layers[k] = main[k];
      delete main[k];
    }
  }
  return { main: main as unknown as DashboardSnapshot, layers: layers as LayersSnapshot };
}

/** Joins them back; layers held inline by older dashboard documents are used when the layers document lacks them. */
export function joinSnapshot(main: DashboardSnapshot, layers: LayersSnapshot | null): DashboardSnapshot {
  if (!layers) return main;
  const { generatedAt: _g, ...rest } = layers;
  return { ...main, ...rest };
}
