import type { CollectionRun, IntelligenceEvent, SourceStatus } from '../../shared/domain/types.ts';
import type { DashboardSnapshot } from '../../shared/domain/snapshot.ts';
import type { IndicatorTransition } from '../../shared/domain/indicators/types.ts';
import type { CollectorStore } from './types.ts';


/** In-memory store for tests and --dry-run. Deep-copies on write like a real database. */
export class MemoryStore implements CollectorStore {
  readonly events = new Map<string, IntelligenceEvent>();
  readonly sourceState = new Map<string, unknown>();
  readonly sourceStatus = new Map<string, SourceStatus>();
  readonly runs: CollectionRun[] = [];
  snapshot: DashboardSnapshot | null = null;
  readonly transitions: IndicatorTransition[] = [];

  async getSourceState<S>(id: string) {
    return (this.sourceState.has(id) ? structuredClone(this.sourceState.get(id)) : null) as S | null;
  }
  async putSourceState(id: string, state: unknown) {
    this.sourceState.set(id, structuredClone(state));
  }
  async getSourceStatus(id: string) {
    return this.sourceStatus.get(id) ?? null;
  }
  async putSourceStatus(s: SourceStatus) {
    this.sourceStatus.set(s.sourceId, structuredClone(s));
  }
  async filterNewEventIds(ids: string[]) {
    return new Set(ids.filter((id) => !this.events.has(id)));
  }
  async putEvents(events: IntelligenceEvent[]) {
    for (const e of events) this.events.set(e.id, structuredClone(e));
  }
  async putRun(run: CollectionRun) {
    this.runs.push(structuredClone(run));
  }
  async eventsCollectedSince(sinceIso: string, limit: number) {
    return [...this.events.values()]
      .filter((e) => e.collectedAt >= sinceIso)
      .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt))
      .slice(0, limit)
      .map((e) => structuredClone(e));
  }
  async countEvents() {
    return this.events.size;
  }
  async getSnapshot() {
    return this.snapshot ? structuredClone(this.snapshot) : null;
  }
  async putSnapshot(s: DashboardSnapshot) {
    this.snapshot = structuredClone(s);
  }
  async putIndicatorTransitions(t: IndicatorTransition[]) {
    this.transitions.push(...structuredClone(t));
  }
}
