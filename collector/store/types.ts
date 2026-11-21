import type { CollectionRun, IntelligenceEvent, SourceStatus } from '../../shared/domain/types.ts';
import type { DashboardSnapshot } from '../../shared/domain/snapshot.ts';
import type { IndicatorTransition, ScoreHistoryPoint } from '../../shared/domain/indicators/types.ts';
import type { AlertRecord } from '../../shared/domain/alerts/types.ts';

export interface AlertingState {
  lastNotifiedAt: Record<string, string>;
  updatedAt: string;
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
  filterNewAlertIds(ids: string[]): Promise<Set<string>>;
  /** Creates alerts; must fail rather than overwrite an existing id. */
  putAlerts(alerts: AlertRecord[]): Promise<void>;
  updateAlertDelivery(ids: string[], delivery: AlertRecord['delivery']): Promise<void>;
  getAlertingState(): Promise<AlertingState | null>;
  putAlertingState(state: AlertingState): Promise<void>;
}
