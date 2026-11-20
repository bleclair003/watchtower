/**
 * WATCHTOWER shared domain model.
 *
 * This module is the single source of truth for entity shapes used by the
 * browser application (src/) and, from Phase 2, the scheduled collectors
 * (collector/). It must stay free of browser- or Node-specific imports.
 *
 * Timestamps are ISO-8601 strings in UTC. `null` means "not known", which is
 * deliberately different from "absent" (`undefined`) in a few places — see
 * docs/DATA_MODEL.md.
 */

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const EVENT_CATEGORIES = [
  'military',
  'diplomatic',
  'aviation',
  'maritime',
  'cyber',
  'unrest',
  'disaster',
  'economic',
  'official',
] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

/**
 * Credibility describes *what kind of evidence* an item is — not whether its
 * contents are true. An official statement proves that the organization made
 * the statement; it does not prove every claim inside it.
 */
export const CREDIBILITY_LEVELS = [
  'official',
  'corroborated',
  'single-source',
  'unverified',
  'experimental',
] as const;
export type Credibility = (typeof CREDIBILITY_LEVELS)[number];

export type VerificationStatus =
  | 'unreviewed'
  | 'confirmed'
  | 'disputed'
  | 'retracted';

/**
 * How precise the attached coordinates are. Events with `country`, `region`
 * or `none` precision MUST NOT carry latitude/longitude — the map represents
 * them as an aggregate on the watch area instead of inventing a point.
 */
export type LocationPrecision = 'exact' | 'city' | 'country' | 'region' | 'none';

/**
 * Where a record came from.
 *  - live:     collected by a WATCHTOWER collector from a real source.
 *  - imported: retrospectively imported archive (not collected in real time).
 *  - demo:     fabricated fixture data for interface development. Never shown
 *              without an explicit DEMO marking.
 */
export type DataOrigin = 'live' | 'imported' | 'demo';

/** Official = published by the organization itself; media = third-party reporting. */
export type SourceClass = 'official' | 'media' | 'aggregator' | 'scientific';

// ---------------------------------------------------------------------------
// Intelligence events
// ---------------------------------------------------------------------------

export interface IntelligenceEvent {
  id: string;
  dataOrigin: DataOrigin;

  sourceId: string;
  sourceName: string;
  sourceClass: SourceClass;
  /** Link to the original item. Empty string only for `demo` records. */
  sourceUrl: string;

  title: string;
  summary?: string;

  category: EventCategory;
  regionIds: string[];
  /** ISO 3166-1 alpha-2 codes. */
  countryCodes: string[];

  /** When the source published the item (null if the source gives no date). */
  publishedAt: string | null;
  /** When the underlying event reportedly occurred, if stated by the source. */
  occurredAt?: string | null;
  /** When WATCHTOWER first collected the item. */
  collectedAt: string;

  credibility: Credibility;
  verificationStatus: VerificationStatus;

  latitude?: number;
  longitude?: number;
  locationPrecision: LocationPrecision;

  relatedIncidentId?: string;
  /** Hash of normalized source + title + link; used for duplicate suppression. */
  contentHash: string;

  /** Indicator ids this event has been associated with (Phase 3+). */
  indicatorIds?: string[];

  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Regions
// ---------------------------------------------------------------------------

/** [west, south, east, north] in degrees. */
export type BBox = [number, number, number, number];

export interface WatchRegion {
  id: string;
  name: string;
  shortCode: string;
  description: string;
  /** Approximate watch area. `null` for non-geographic regions (e.g. global cyber). */
  bbox: BBox | null;
  /** Countries whose country-level reports are attributed to this region. */
  countryCodes: string[];
}

// ---------------------------------------------------------------------------
// Sources & collection health
// ---------------------------------------------------------------------------

export type SourceHealth = 'ONLINE' | 'DEGRADED' | 'STALE' | 'OFFLINE' | 'NOT_CONFIGURED';

export type RetrievalMethod =
  | 'api'
  | 'rss'
  | 'atom'
  | 'structured-download'
  | 'page-parse'
  | 'none';

export type IntegrationPriority = 'P1' | 'P2' | 'P3' | 'research' | 'rejected';

export interface SourceDefinition {
  id: string;
  name: string;
  organization: string;
  website: string;
  /** Endpoint WATCHTOWER would poll, if one has been identified. */
  endpoint: string | null;
  method: RetrievalMethod;
  sourceClass: SourceClass;
  defaultCategory: EventCategory;
  coverage: string;
  authentication: string;
  freeAccess: string;
  expectedUpdateFrequency: string;
  /** Planned polling interval in minutes, or null if not scheduled. */
  pollIntervalMinutes: number | null;
  reliabilityNotes: string;
  termsNotes: string;
  priority: IntegrationPriority;
  /** Result of the most recent manual feasibility probe. */
  feasibility: {
    checkedAt: string;
    result: 'reachable' | 'reachable-empty' | 'rate-limited' | 'blocked' | 'unavailable' | 'no-feed';
    note: string;
  };
}

export interface SourceStatus {
  sourceId: string;
  health: SourceHealth;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastNewItemAt: string | null;
  consecutiveFailures: number;
  parseErrors: number;
  /** Most recent error message, sanitized. */
  lastError: string | null;
}

// ---------------------------------------------------------------------------
// Indicators (schema defined now; engine arrives in Phase 3)
// ---------------------------------------------------------------------------

export type IndicatorState =
  | 'NORMAL'
  | 'ELEVATED'
  | 'TRIGGERED'
  | 'UNKNOWN'
  | 'DATA_UNAVAILABLE'
  | 'DISABLED';

export interface IndicatorDefinition {
  id: string;
  name: string;
  description: string;
  category: EventCategory | 'information-environment' | 'experimental';
  regionIds: string[];
  requiredSourceIds: string[];
  evaluationWindowHours: number;
  baselineMethod: string;
  weight: number;
  severity: 'low' | 'medium' | 'high';
  experimental: boolean;
  configVersion: number;
}

export interface IndicatorStateRecord {
  indicatorId: string;
  state: IndicatorState;
  lastEvaluatedAt: string | null;
  lastTriggeredAt: string | null;
  evidenceEventIds: string[];
  configVersion: number;
}

// ---------------------------------------------------------------------------
// Collection runs
// ---------------------------------------------------------------------------

export interface CollectionRun {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  trigger: 'schedule' | 'manual' | 'local';
  recordsFetched: number;
  recordsImported: number;
  recordsRejected: number;
  duplicatesSuppressed: number;
  errors: { sourceId: string; message: string }[];
}
