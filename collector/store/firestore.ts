import { initializeApp, applicationDefault, getApps, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { CollectionRun, IntelligenceEvent, SourceStatus } from '../../shared/domain/types.ts';
import { COLLECTIONS, SNAPSHOT_DOC_ID, type DashboardSnapshot } from '../../shared/domain/snapshot.ts';
import type { IndicatorTransition, ScoreHistoryPoint } from '../../shared/domain/indicators/types.ts';
import type { AlertRecord } from '../../shared/domain/alerts/types.ts';
import type { AlertingState, CollectorStore } from './types.ts';
import { BUCKET_SCHEMA_VERSION, BUCKET_WINDOW_DAYS, BucketCache, windowStartDate, type DayBucketDoc } from './dayBuckets.ts';

const BUCKET_MARKER = 'eventDays';

/**
 * Firestore-backed store using the Admin SDK.
 *
 * Credentials: Application Default Credentials. In GitHub Actions these come
 * from google-github-actions/auth (service-account JSON or Workload Identity
 * Federation). Locally against the emulator, set FIRESTORE_EMULATOR_HOST and
 * no credentials are needed. Credentials are never read from this repository.
 */
export class FirestoreStore implements CollectorStore {
  private readonly db: Firestore;
  private cache: BucketCache | null = null;
  private cacheLoading: Promise<BucketCache> | null = null;
  /** Documents read by this store instance (Firestore bills per document read). */
  readCount = 0;
  /** How the bucket cache was obtained this run, for the run log. */
  cacheInfo = '';

  constructor(projectId: string) {
    const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
    // Tell Google client libraries the project explicitly so they don't probe the GCE metadata server.
    process.env.GOOGLE_CLOUD_PROJECT ??= projectId;
    const app: App =
      getApps()[0] ?? initializeApp(emulator ? { projectId } : { projectId, credential: applicationDefault() });
    this.db = getFirestore(app);
    this.db.settings({ ignoreUndefinedProperties: true });
  }

  async getSourceState<S>(id: string) {
    const snap = await this.db.collection(COLLECTIONS.sourceState).doc(id).get();
    this.readCount++;
    return snap.exists ? ((snap.data()?.state ?? null) as S | null) : null;
  }
  async putSourceState(id: string, state: unknown) {
    await this.db.collection(COLLECTIONS.sourceState).doc(id).set({ state, updatedAt: new Date().toISOString() });
  }
  async getSourceStatus(id: string) {
    const snap = await this.db.collection(COLLECTIONS.sourceStatus).doc(id).get();
    this.readCount++;
    return snap.exists ? (snap.data() as SourceStatus) : null;
  }
  async putSourceStatus(s: SourceStatus) {
    await this.db.collection(COLLECTIONS.sourceStatus).doc(s.sourceId).set(s);
  }
  /**
   * Loads the day-bucket cache once per run. First use ever (no marker): builds the buckets
   * from the `events` collection, a one-time cost of one read per recent event.
   */
  private async buckets(): Promise<BucketCache> {
    if (this.cache) return this.cache;
    this.cacheLoading ??= (async () => {
      const cache = new BucketCache(windowStartDate(Date.now()));
      const marker = await this.db.collection(COLLECTIONS.collectorState).doc(BUCKET_MARKER).get();
      this.readCount++;
      if (marker.exists && marker.data()?.version === BUCKET_SCHEMA_VERSION) {
        const snap = await this.db.collection(COLLECTIONS.eventDays).where('date', '>=', cache.windowStart).get();
        this.readCount += Math.max(1, snap.size);
        for (const d of snap.docs) {
          const b = d.data() as DayBucketDoc;
          cache.upsert(b.events ?? []);
          cache.storedParts.set(b.date, Math.max(cache.storedParts.get(b.date) ?? 0, (b.part ?? 0) + 1));
        }
        this.cacheInfo = `day buckets: ${snap.size} docs, ${cache.size} events`;
      } else {
        const snap = await this.db.collection(COLLECTIONS.events).where('collectedAt', '>=', `${cache.windowStart}T00:00:00.000Z`).get();
        this.readCount += Math.max(1, snap.size);
        const days = cache.upsert(snap.docs.map((d) => d.data() as IntelligenceEvent));
        const { set } = cache.docsFor(days, new Date().toISOString());
        for (let i = 0; i < set.length; i += 400) {
          const batch = this.db.batch();
          for (const s of set.slice(i, i + 400)) batch.set(this.db.collection(COLLECTIONS.eventDays).doc(s.id), s.doc);
          await batch.commit();
        }
        await this.db.collection(COLLECTIONS.collectorState).doc(BUCKET_MARKER).set({
          version: BUCKET_SCHEMA_VERSION,
          windowDays: BUCKET_WINDOW_DAYS,
          builtAt: new Date().toISOString(),
          builtFromEvents: snap.size,
        });
        this.cacheInfo = `day buckets built from ${snap.size} events (one-time)`;
      }
      this.cache = cache;
      return cache;
    })();
    return this.cacheLoading;
  }

  async filterNewEventIds(ids: string[]) {
    const cache = await this.buckets();
    const fresh = new Set<string>();
    // Ids in the cache are known; only ids outside it (older than the window) cost a read each.
    const unknown = ids.filter((id) => !cache.has(id));
    for (let i = 0; i < unknown.length; i += 100) {
      const refs = unknown.slice(i, i + 100).map((id) => this.db.collection(COLLECTIONS.events).doc(id));
      const snaps = await this.db.getAll(...refs);
      this.readCount += refs.length;
      snaps.forEach((s) => !s.exists && fresh.add(s.id));
    }
    return fresh;
  }
  async getEvents(ids: string[]) {
    const cache = await this.buckets();
    const cached = cache.collectedSince('').filter((e) => ids.includes(e.id));
    const missing = ids.filter((id) => !cache.has(id));
    const out: IntelligenceEvent[] = [...cached];
    for (let i = 0; i < missing.length; i += 100) {
      const refs = missing.slice(i, i + 100).map((id) => this.db.collection(COLLECTIONS.events).doc(id));
      const snaps = await this.db.getAll(...refs);
      this.readCount += refs.length;
      for (const s of snaps) if (s.exists) out.push(s.data() as IntelligenceEvent);
    }
    return out;
  }
  /** Writes events and their day buckets in the same batch, so the cache cannot drift from the archive. */
  private async writeWithBuckets(events: IntelligenceEvent[], mode: 'create' | 'set') {
    const cache = await this.buckets();
    for (let i = 0; i < events.length; i += 300) {
      const chunk = events.slice(i, i + 300);
      const batch = this.db.batch();
      for (const e of chunk) {
        const ref = this.db.collection(COLLECTIONS.events).doc(e.id);
        // create() fails if the doc exists: a second guard against duplicate ingestion.
        if (mode === 'create') batch.create(ref, e);
        else batch.set(ref, e);
      }
      const inWindow = chunk.filter((e) => cache.covers(e.collectedAt));
      const { set, remove } = cache.docsFor(cache.upsert(inWindow), new Date().toISOString());
      for (const s of set) batch.set(this.db.collection(COLLECTIONS.eventDays).doc(s.id), s.doc);
      for (const id of remove) batch.delete(this.db.collection(COLLECTIONS.eventDays).doc(id));
      await batch.commit();
    }
  }
  async replaceEvents(events: IntelligenceEvent[]) {
    await this.writeWithBuckets(events, 'set');
  }
  async putEvents(events: IntelligenceEvent[]) {
    await this.writeWithBuckets(events, 'create');
  }
  async putRun(run: CollectionRun) {
    await this.db.collection(COLLECTIONS.collectionRuns).doc(run.id).set(run);
  }
  async eventsCollectedSince(sinceIso: string, limit: number) {
    const cache = await this.buckets();
    if (cache.covers(sinceIso)) return cache.collectedSince(sinceIso);
    // Older than the bucket window: fall back to a (capped) query.
    // Single-field range + order on collectedAt: served by Firestore's automatic index.
    const snap = await this.db
      .collection(COLLECTIONS.events)
      .where('collectedAt', '>=', sinceIso)
      .orderBy('collectedAt', 'desc')
      .limit(limit)
      .get();
    this.readCount += Math.max(1, snap.size);
    return snap.docs.map((d) => d.data() as IntelligenceEvent);
  }
  async countEvents() {
    const agg = await this.db.collection(COLLECTIONS.events).count().get();
    this.readCount += Math.max(1, Math.ceil(agg.data().count / 1000));
    return agg.data().count;
  }
  async getSnapshot() {
    const snap = await this.db.collection(COLLECTIONS.snapshots).doc(SNAPSHOT_DOC_ID).get();
    this.readCount++;
    return snap.exists ? (snap.data() as DashboardSnapshot) : null;
  }
  async putRaiPoint(p: ScoreHistoryPoint) {
    await this.db.collection(COLLECTIONS.raiHistory).doc(p.at.replace(/[:.]/g, '-')).set(p);
  }
  async putIndicatorTransitions(transitions: IndicatorTransition[]) {
    for (let i = 0; i < transitions.length; i += 400) {
      const batch = this.db.batch();
      for (const t of transitions.slice(i, i + 400)) {
        batch.set(this.db.collection(COLLECTIONS.indicatorHistory).doc(`${t.at.replace(/[:.]/g, '-')}_${t.indicatorId}`), t);
      }
      await batch.commit();
    }
  }
  async listAlertRules() {
    const snap = await this.db.collection(COLLECTIONS.alertRules).limit(200).get();
    this.readCount += Math.max(1, snap.size);
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
  }
  async filterNewAlertIds(ids: string[]) {
    const fresh = new Set<string>();
    for (let i = 0; i < ids.length; i += 100) {
      const refs = ids.slice(i, i + 100).map((id) => this.db.collection(COLLECTIONS.alerts).doc(id));
      if (!refs.length) continue;
      (await this.db.getAll(...refs)).forEach((s) => !s.exists && fresh.add(s.id));
      this.readCount += refs.length;
    }
    return fresh;
  }
  async putAlerts(alerts: AlertRecord[]) {
    for (let i = 0; i < alerts.length; i += 400) {
      const batch = this.db.batch();
      for (const a of alerts.slice(i, i + 400)) batch.create(this.db.collection(COLLECTIONS.alerts).doc(a.id), a);
      await batch.commit();
    }
  }
  async updateAlertDelivery(ids: string[], delivery: AlertRecord['delivery']) {
    for (let i = 0; i < ids.length; i += 400) {
      const batch = this.db.batch();
      for (const id of ids.slice(i, i + 400)) batch.update(this.db.collection(COLLECTIONS.alerts).doc(id), { delivery });
      await batch.commit();
    }
  }
  async getAlertingState() {
    const snap = await this.db.collection(COLLECTIONS.collectorState).doc('alerting').get();
    this.readCount++;
    return snap.exists ? (snap.data() as AlertingState) : null;
  }
  async putAlertingState(s: AlertingState) {
    await this.db.collection(COLLECTIONS.collectorState).doc('alerting').set(s);
  }
  async putSnapshot(s: DashboardSnapshot) {
    await this.db.collection(COLLECTIONS.snapshots).doc(SNAPSHOT_DOC_ID).set(s);
  }
}
