import type { CollectionRun, IntelligenceEvent, SourceStatus } from '@shared/domain/types';
import { SOURCE_REGISTRY } from '@shared/domain/sources';
import { backendMode, type BackendMode } from '../config/firebase';
import { buildDemoEvents } from './demo/demoEvents';
import type { IndicatorEvaluation, RegionScore, ScoreHistoryPoint } from '@shared/domain/indicators/types';
import { INDICATOR_CATALOG } from '@shared/domain/indicators/catalog';
import { evaluateAll } from '@shared/domain/indicators/evaluate';
import { computeAllRegionScores } from '@shared/domain/indicators/rai';
import type { AlertRuleProblem } from '@shared/domain/alerts/types';

/**
 * Data access boundary for the UI.
 *
 * Components never talk to Firestore (or fixtures) directly — they go through
 * an IntelRepository. Demo fixtures and Firestore are interchangeable.
 */
export type DataMode = BackendMode;

export interface DashboardData {
  events: IntelligenceEvent[];
  sourceStatus: SourceStatus[];
  /** Most recent collector run, if any has happened. */
  lastRun: CollectionRun | null;
  /** When the collector built the data the dashboard is showing. */
  generatedAt: string | null;
  totalEventsStored: number | null;
  indicatorEvaluations: IndicatorEvaluation[];
  regionScores: RegionScore[];
  scoreHistory: ScoreHistoryPoint[];
  alertRuleProblems: AlertRuleProblem[];
  activeAlertRules: number | null;
  discordConfigured: boolean | null;
}

export interface IntelRepository {
  readonly mode: DataMode;
  loadDashboard(): Promise<DashboardData>;
  /** Firestore document reads this session (null if not applicable). */
  readsThisSession(): number | null;
}

export class PermissionDeniedError extends Error {
  constructor() {
    super('ACCESS DENIED — signed-in account is not authorized as WATCHTOWER owner');
    this.name = 'PermissionDeniedError';
  }
}

/** Fixture-backed repository. All records it returns have dataOrigin = 'demo'. */
export class DemoRepository implements IntelRepository {
  readonly mode = 'demo' as const;
  private readonly events: IntelligenceEvent[];

  constructor(now: number = Date.now()) {
    this.events = buildDemoEvents(now);
  }

  async loadDashboard(): Promise<DashboardData> {
    // The real engine runs on demo data too. Demo sources are not real collected
    // sources, so every indicator honestly reports DATA_UNAVAILABLE and RAI is N/E.
    const now = Date.now();
    const { evaluations } = evaluateAll(INDICATOR_CATALOG, this.events, [], now);
    return {
      indicatorEvaluations: evaluations,
      regionScores: computeAllRegionScores(INDICATOR_CATALOG, evaluations, now),
      scoreHistory: [],
      alertRuleProblems: [],
      activeAlertRules: null,
      discordConfigured: null,
      events: this.events,
      // No collector has ever run in demo mode, so every source is honestly NOT_CONFIGURED.
      sourceStatus: SOURCE_REGISTRY.map((s) => ({
        sourceId: s.id,
        health: 'NOT_CONFIGURED',
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastNewItemAt: null,
        consecutiveFailures: 0,
        parseErrors: 0,
        lastError: null,
      })),
      lastRun: null,
      generatedAt: null,
      totalEventsStored: null,
    };
  }

  readsThisSession() {
    return null;
  }
}

export async function createRepository(): Promise<IntelRepository> {
  if (backendMode === 'demo') return new DemoRepository();
  const { FirestoreRepository } = await import('./firestoreRepository');
  return new FirestoreRepository(backendMode);
}
