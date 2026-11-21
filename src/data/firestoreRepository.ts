import { doc, getDoc, FirestoreError } from 'firebase/firestore';
import type { MetersSnapshot } from '@shared/domain/meters/types';
import { COLLECTIONS, SNAPSHOT_DOC_ID, METERS_DOC_ID, type DashboardSnapshot } from '@shared/domain/snapshot';
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

  async loadDashboard(): Promise<DashboardData> {
    const { db } = getFirebase();
    let snap;
    try {
      snap = await getDoc(doc(db, COLLECTIONS.snapshots, SNAPSHOT_DOC_ID));
      this.reads++;
    } catch (err) {
      if (err instanceof FirestoreError && err.code === 'permission-denied') throw new PermissionDeniedError();
      throw err;
    }
    if (!snap.exists()) {
      // Database reachable but the collector has never completed a run.
      return { events: [], sourceStatus: [], lastRun: null, generatedAt: null, totalEventsStored: 0, indicatorEvaluations: [], regionScores: [], scoreHistory: [], alertRuleProblems: [], activeAlertRules: null, discordConfigured: null, aircraft: null, fleet: null, chokepoints: null, sanctionedShips: null, displacement: null, baseActivity: null, meters: null, predictionMarkets: null, infrastructure: null, actors: null, powerOutages: null, tfrs: null, airportStatus: null, airspaceNotices: null };
    }
    const s = snap.data() as DashboardSnapshot;
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
      actors: s.actors ?? null,
      meters: await this.loadMeters(),
    };
  }

  readsThisSession() {
    return this.reads;
  }
}
