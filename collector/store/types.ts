import type { MetersSnapshot } from '../../shared/domain/meters/types.ts';
import type { RadioGuide } from '../../shared/domain/shortwave.ts';
import type { ShipTrafficDoc } from '../../shared/domain/shipTraffic.ts';
import type { CollectionRun, IntelligenceEvent, SourceStatus } from '../../shared/domain/types.ts';
import type { DashboardSnapshot } from '../../shared/domain/snapshot.ts';
import type { IndicatorTransition, ScoreHistoryPoint } from '../../shared/domain/indicators/types.ts';
import type { AlertSeverity, AlertRecord } from '../../shared/domain/alerts/types.ts';

/** An alert resting on one media report, watched for an independent report (v0.72.0). */
export interface WatchedAlert {
  alertId: string;
  ruleId: string;
  ruleName: string;
  ruleVersion: number;
  severity: AlertSeverity;
  eventId: string;
  title: string;
  regionIds: string[];
  url: string;
  createdAt: string;
  notifyDiscord: boolean;
  cooldownMinutes: number;
}

export interface AlertingState {
  lastNotifiedAt: Record<string, string>;
  updatedAt: string;
  watching?: WatchedAlert[];
}

/**
 * Persistence used by the collector. Implementations: Firestore (production
 * and emulator) and in-memory (tests, --dry-run).
 */
export interface CollectorStore {
  getSourceState<S>(sourceId: string): Promise<S | null>;
  putSourceState(sourceId: string, state: unknown): Promise<void>;
  getSourceStatus(sourceId: string): Promise<SourceStatus | null>;
  putSourceStatus(status: SourceStatus): Promise<void>;
  /** Returns the subset of ids NOT already stored. */
  filterNewEventIds(ids: string[]): Promise<Set<string>>;
  putEvents(events: IntelligenceEvent[]): Promise<void>;
  /** Collector-private bookkeeping documents (collectorState/{key}). */
  getCollectorState<T>(key: string): Promise<T | null>;
  putCollectorState(key: string, value: unknown): Promise<void>;
  getMetersSnapshot(): Promise<MetersSnapshot | null>;
  putMetersSnapshot(m: MetersSnapshot): Promise<void>;
  /** Radio guide (Phase 29): snapshots/radio. */
  getRadioGuide(): Promise<RadioGuide | null>;
  /** v0.75.0: tanker and cargo traffic for the map (snapshots/ships). */
  putShipTraffic(d: ShipTrafficDoc): Promise<void>;
  putRadioGuide(g: RadioGuide): Promise<void>;
  /** Stored events by id (missing ids are omitted). Used only for revisable sources. */
  getEvents(ids: string[]): Promise<IntelligenceEvent[]>;
  /** Overwrites existing events (revisions of revisable sources). */
  replaceEvents(events: IntelligenceEvent[]): Promise<void>;
  putRun(run: CollectionRun): Promise<void>;
  /** Events collected at or after `sinceIso`, newest collected first, capped at `limit`. */
  eventsCollectedSince(sinceIso: string, limit: number): Promise<IntelligenceEvent[]>;
  countEvents(): Promise<number | null>;
  getSnapshot(): Promise<DashboardSnapshot | null>;
  putSnapshot(snapshot: DashboardSnapshot): Promise<void>;
  putIndicatorTransitions(transitions: IndicatorTransition[]): Promise<void>;
  putRaiPoint(point: ScoreHistoryPoint): Promise<void>;
  /** Raw stored rules (unvalidated: the caller validates). */
  listAlertRules(): Promise<unknown[]>;
  /** Stored watchlists with their owner's uid (unvalidated). */
  listWatchlists(): Promise<{ uid: string; data: unknown }[]>;
  /** People and roles, `members/{uid}` (unvalidated; v0.60.0). */
  listMembers(): Promise<unknown[]>;
  /** v0.74.0: watch areas (unvalidated). */
  listWatchAreas(): Promise<unknown[]>;
  filterNewAlertIds(ids: string[]): Promise<Set<string>>;
  /** Creates alerts; must fail rather than overwrite an existing id. */
  putAlerts(alerts: AlertRecord[]): Promise<void>;
  updateAlertDelivery(ids: string[], delivery: AlertRecord['delivery']): Promise<void>;
  updateAlertCorroboration(id: string, corroboration: NonNullable<AlertRecord['corroboration']>): Promise<void>;
  getAlertingState(): Promise<AlertingState | null>;
  putAlertingState(state: AlertingState): Promise<void>;
}
