import type { CollectionRun, IntelligenceEvent, SourceStatus } from '../../shared/domain/types.ts';
import type { DashboardSnapshot } from '../../shared/domain/snapshot.ts';

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
  putRun(run: CollectionRun): Promise<void>;
  /** Newest-first events for the snapshot (by publishedAt, nulls last). */
  recentEvents(limit: number): Promise<IntelligenceEvent[]>;
  countEvents(): Promise<number | null>;
  putSnapshot(snapshot: DashboardSnapshot): Promise<void>;
}
