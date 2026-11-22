import { doc, getDoc, FirestoreError } from 'firebase/firestore';
import type { MetersSnapshot } from '@shared/domain/meters/types';
import { COLLECTIONS, LAYERS_DOC_ID, SNAPSHOT_DOC_ID, METERS_DOC_ID, joinSnapshot, type DashboardSnapshot, type LayersSnapshot } from '@shared/domain/snapshot';
import { getFirebase } from './firebaseClient';
import { PermissionDeniedError, type DashboardData, type DataMode, type IntelRepository } from './repository';

/**
 * Reads the collector-built dashboard snapshot: ONE document read per load,
 * regardless of how many events it contains (protects the Spark read quota).
 */
export class FirestoreRepository implements IntelRepository {
  readonly mode: DataMode;
  private reads = 0;

  constructor(mode: DataMode) {
    this.mode = mode;
  }

  /** Meters live in their own document (one extra read); a missing or unreadable one is shown as "not computed yet". */
  private async loadMeters(): Promise<MetersSnapshot | null> {
    try {
      const { db } = getFirebase();
      const m = await getDoc(doc(db, COLLECTIONS.snapshots, METERS_DOC_ID));
      this.reads++;
      return m.exists() ? (m.data() as MetersSnapshot) : null;
    } catch {
      return null;
    }
  }

  /** Map and page layers live in their own document (v0.54.0); a missing one falls back to layers held inline. */
  private async loadLayers(): Promise<LayersSnapshot | null> {
    try {
      const { db } = getFirebase();
      const l = await getDoc(doc(db, COLLECTIONS.snapshots, LAYERS_DOC_ID));
      this.reads++;
      return l.exists() ? (l.data() as LayersSnapshot) : null;
    } catch {
      return null;
    }
  }

  async loadDashboard(): Promise<DashboardData> {
    const { db } = getFirebase();
    let snap;
    const layersP = this.loadLayers();
    try {
      snap = await getDoc(doc(db, COLLECTIONS.snapshots, SNAPSHOT_DOC_ID));
      this.reads++;
    } catch (err) {
      if (err instanceof FirestoreError && err.code === 'permission-denied') throw new PermissionDeniedError();
      throw err;
    }
    if (!snap.exists()) {
      // Database reachable but the collector has never completed a run.
      return { events: [], sourceStatus: [], lastRun: null, generatedAt: null, totalEventsStored: 0, indicatorEvaluations: [], regionScores: [], scoreHistory: [], alertRuleProblems: [], activeAlertRules: null, discordConfigured: null, aircraft: null, fleet: null, chokepoints: null, sanctionedShips: null, displacement: null, baseActivity: null, meters: null, predictionMarkets: null, infrastructure: null, actors: null, powerOutages: null, tfrs: null, airportStatus: null, airspaceNotices: null, radiation: null, spaceWeather: null, cyber: null, ukraineFront: null, censorship: null };
    }
    const s = joinSnapshot(snap.data() as DashboardSnapshot, await layersP);
    return {
      events: s.events ?? [],
      sourceStatus: s.sourceStatus ?? [],
      lastRun: s.lastRun ?? null,
      generatedAt: s.generatedAt ?? null,
      totalEventsStored: s.totalEventsStored ?? null,
      // Absent in schema-v1 snapshots written before Phase 3.
      indicatorEvaluations: s.indicatorEvaluations ?? [],
      regionScores: s.regionScores ?? [],
      scoreHistory: s.scoreHistory ?? [],
      // Absent before Phase 4.
      alertRuleProblems: s.alertRuleProblems ?? [],
      activeAlertRules: s.activeAlertRules ?? null,
      discordConfigured: s.discordConfigured ?? null,
      // Absent before Phase 13.
      aircraft: s.aircraft ?? null,
      fleet: s.fleet ?? null,
      chokepoints: s.chokepoints ?? null,
      sanctionedShips: s.sanctionedShips ?? null,
      displacement: s.displacement ?? null,
      baseActivity: s.baseActivity ?? null,
      predictionMarkets: s.predictionMarkets ?? null,
      infrastructure: s.infrastructure ?? null,
      powerOutages: s.powerOutages ?? null,
      tfrs: s.tfrs ?? null,
      airportStatus: s.airportStatus ?? null,
      airspaceNotices: s.airspaceNotices ?? null,
      radiation: s.radiation ?? null,
      spaceWeather: s.spaceWeather ?? null,
      cyber: s.cyber ?? null,
      ukraineFront: s.ukraineFront ?? null,
      censorship: s.censorship ?? null,
      actors: s.actors ?? null,
      meters: await this.loadMeters(),
    };
  }

  readsThisSession() {
    return this.reads;
  }
}
