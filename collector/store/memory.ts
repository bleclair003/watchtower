import type { MetersSnapshot } from '../../shared/domain/meters/types.ts';
import type { RadioGuide } from '../../shared/domain/shortwave.ts';
import type { CollectionRun, IntelligenceEvent, SourceStatus } from '../../shared/domain/types.ts';
import type { DashboardSnapshot } from '../../shared/domain/snapshot.ts';
import type { IndicatorTransition, ScoreHistoryPoint } from '../../shared/domain/indicators/types.ts';
import type { AlertRecord } from '../../shared/domain/alerts/types.ts';
import type { AlertingState, CollectorStore } from './types.ts';


/** In-memory store for tests and --dry-run. Deep-copies on write like a real database. */
export class MemoryStore implements CollectorStore {
  readonly events = new Map<string, IntelligenceEvent>();
  readonly sourceState = new Map<string, unknown>();
  readonly sourceStatus = new Map<string, SourceStatus>();
  readonly runs: CollectionRun[] = [];
  snapshot: DashboardSnapshot | null = null;
  readonly transitions: IndicatorTransition[] = [];
  readonly raiPoints: ScoreHistoryPoint[] = [];
  readonly alertRules = new Map<string, unknown>();
  readonly watchlists = new Map<string, unknown>();
  readonly members = new Map<string, unknown>();
  readonly watchAreas = new Map<string, unknown>();
  readonly alerts = new Map<string, AlertRecord>();
  alertingState: AlertingState | null = null;

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
  readonly collectorState = new Map<string, unknown>();
  async getCollectorState<T>(key: string) {
    return (this.collectorState.has(key) ? structuredClone(this.collectorState.get(key)) : null) as T | null;
  }
  async putCollectorState(key: string, value: unknown) {
    this.collectorState.set(key, structuredClone(value));
  }
  async putEvents(events: IntelligenceEvent[]) {
    for (const e of events) this.events.set(e.id, structuredClone(e));
  }
  async getEvents(ids: string[]) {
    return ids.flatMap((id) => (this.events.has(id) ? [structuredClone(this.events.get(id)!)] : []));
  }
  async replaceEvents(events: IntelligenceEvent[]) {
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
  meters: MetersSnapshot | null = null;
  async getMetersSnapshot() {
    return this.meters ? structuredClone(this.meters) : null;
  }
  async putMetersSnapshot(m: MetersSnapshot) {
    this.meters = structuredClone(m);
  }
  radioGuide: RadioGuide | null = null;
  async getRadioGuide() {
    return this.radioGuide ? structuredClone(this.radioGuide) : null;
  }
  async putRadioGuide(g: RadioGuide) {
    this.radioGuide = structuredClone(g);
  }
  async putSnapshot(s: DashboardSnapshot) {
    this.snapshot = structuredClone(s);
  }
  async putRaiPoint(p: ScoreHistoryPoint) {
    this.raiPoints.push(structuredClone(p));
  }
  async putIndicatorTransitions(t: IndicatorTransition[]) {
    this.transitions.push(...structuredClone(t));
  }
  async listAlertRules() {
    return [...this.alertRules.values()].map((r) => structuredClone(r));
  }
  async listWatchlists() {
    return [...this.watchlists].map(([uid, w]) => ({ uid, data: structuredClone(w) }));
  }
  async listMembers() {
    return [...this.members.values()].map((m) => structuredClone(m));
  }
  async listWatchAreas() {
    return [...this.watchAreas.values()].map((a) => structuredClone(a));
  }
  async filterNewAlertIds(ids: string[]) {
    return new Set(ids.filter((id) => !this.alerts.has(id)));
  }
  async putAlerts(alerts: AlertRecord[]) {
    for (const a of alerts) {
      if (this.alerts.has(a.id)) throw new Error(`alert ${a.id} already exists`);
      this.alerts.set(a.id, structuredClone(a));
    }
  }
  async updateAlertCorroboration(id: string, corroboration: NonNullable<AlertRecord['corroboration']>) {
    const a = this.alerts.get(id);
    if (a) a.corroboration = structuredClone(corroboration);
  }
  async updateAlertDelivery(ids: string[], delivery: AlertRecord['delivery']) {
    for (const id of ids) {
      const a = this.alerts.get(id);
      if (a) a.delivery = structuredClone(delivery);
    }
  }
  async getAlertingState() {
    return this.alertingState ? structuredClone(this.alertingState) : null;
  }
  async putAlertingState(s: AlertingState) {
    this.alertingState = structuredClone(s);
  }
}
