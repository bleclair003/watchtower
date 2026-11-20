import type { IntelligenceEvent, SourceStatus } from '@shared/domain/types';
import { SOURCE_REGISTRY } from '@shared/domain/sources';
import { buildDemoEvents } from './demo/demoEvents';

/**
 * Data access boundary for the UI.
 *
 * Components never talk to Firestore (or fixtures) directly — they go through
 * an IntelRepository. Phase 2 adds a FirestoreRepository implementing the same
 * interface; nothing above this layer needs to change.
 */
export type DataMode = 'demo' | 'live';

export interface EventQuery {
  /** Only events published/collected after this ISO time. */
  since?: string;
  /** Hard cap on returned records (Firestore reads are metered). */
  limit: number;
}

export interface IntelRepository {
  readonly mode: DataMode;
  listEvents(query: EventQuery): Promise<IntelligenceEvent[]>;
  listSourceStatus(): Promise<SourceStatus[]>;
}

/** Fixture-backed repository. All records it returns have dataOrigin = 'demo'. */
export class DemoRepository implements IntelRepository {
  readonly mode = 'demo' as const;
  private readonly events: IntelligenceEvent[];

  constructor(now: number = Date.now()) {
    this.events = buildDemoEvents(now);
  }

  async listEvents({ since, limit }: EventQuery): Promise<IntelligenceEvent[]> {
    const cutoff = since ? Date.parse(since) : -Infinity;
    return this.events
      .filter((e) => Date.parse(e.publishedAt ?? e.collectedAt) >= cutoff)
      .slice(0, limit);
  }

  /**
   * In demo mode no collector has ever run, so every real source is honestly
   * reported as NOT_CONFIGURED rather than given a fabricated health status.
   */
  async listSourceStatus(): Promise<SourceStatus[]> {
    return SOURCE_REGISTRY.map((s) => ({
      sourceId: s.id,
      health: 'NOT_CONFIGURED',
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastNewItemAt: null,
      consecutiveFailures: 0,
      parseErrors: 0,
      lastError: null,
    }));
  }
}

export function createRepository(): IntelRepository {
  // Phase 2: return new FirestoreRepository(...) when isFirebaseConfigured.
  return new DemoRepository();
}
