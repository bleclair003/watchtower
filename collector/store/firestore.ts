import { initializeApp, applicationDefault, getApps, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { CollectionRun, IntelligenceEvent, SourceStatus } from '../../shared/domain/types.ts';
import { COLLECTIONS, SNAPSHOT_DOC_ID, type DashboardSnapshot } from '../../shared/domain/snapshot.ts';
import type { CollectorStore } from './types.ts';

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
    return snap.exists ? ((snap.data()?.state ?? null) as S | null) : null;
  }
  async putSourceState(id: string, state: unknown) {
    await this.db.collection(COLLECTIONS.sourceState).doc(id).set({ state, updatedAt: new Date().toISOString() });
  }
  async getSourceStatus(id: string) {
    const snap = await this.db.collection(COLLECTIONS.sourceStatus).doc(id).get();
    return snap.exists ? (snap.data() as SourceStatus) : null;
  }
  async putSourceStatus(s: SourceStatus) {
    await this.db.collection(COLLECTIONS.sourceStatus).doc(s.sourceId).set(s);
  }
  async filterNewEventIds(ids: string[]) {
    const fresh = new Set<string>();
    // getAll reads are billed per document; ids are capped by the adapters' lookback windows.
    for (let i = 0; i < ids.length; i += 100) {
      const refs = ids.slice(i, i + 100).map((id) => this.db.collection(COLLECTIONS.events).doc(id));
      if (!refs.length) continue;
      const snaps = await this.db.getAll(...refs);
      snaps.forEach((s) => !s.exists && fresh.add(s.id));
    }
    return fresh;
  }
  async putEvents(events: IntelligenceEvent[]) {
    for (let i = 0; i < events.length; i += 400) {
      const batch = this.db.batch();
      for (const e of events.slice(i, i + 400)) {
        // create() fails if the doc exists: a second guard against duplicate ingestion.
        batch.create(this.db.collection(COLLECTIONS.events).doc(e.id), e);
      }
      await batch.commit();
    }
  }
  async putRun(run: CollectionRun) {
    await this.db.collection(COLLECTIONS.collectionRuns).doc(run.id).set(run);
  }
  async recentEvents(limit: number) {
    const snap = await this.db.collection(COLLECTIONS.events).orderBy('publishedAt', 'desc').limit(limit).get();
    return snap.docs.map((d) => d.data() as IntelligenceEvent);
  }
  async countEvents() {
    const agg = await this.db.collection(COLLECTIONS.events).count().get();
    return agg.data().count;
  }
  async putSnapshot(s: DashboardSnapshot) {
    await this.db.collection(COLLECTIONS.snapshots).doc(SNAPSHOT_DOC_ID).set(s);
  }
}
