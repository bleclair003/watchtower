import type { AircraftSnapshot } from '@shared/domain/aircraft';
import type { FleetSnapshot } from '@shared/domain/fleet';
import type { ChokepointSnapshot } from '@shared/domain/chokepoints';
import type { SanctionedShipsSnapshot } from '@shared/domain/sanctionedShips';
import type { DisplacementSnapshot } from '@shared/domain/displacement';
import type { BaseActivitySnapshot } from '@shared/domain/baseActivity';
import type { MetersSnapshot } from '@shared/domain/meters/types';
import type { PredictionMarketsSnapshot } from '@shared/domain/predictionMarkets';
import type { InfrastructureSnapshot } from '@shared/domain/infrastructure';
import type { PowerOutageSnapshot } from '@shared/domain/powerOutages';
import type { AirportStatusSnapshot, AirspaceNoticesSnapshot, TfrSnapshot } from '@shared/domain/faa';
import type { RadiationSnapshot } from '@shared/domain/radiation';
import type { SpaceWeatherSnapshot } from '@shared/domain/spaceWeather';
import type { ActorsSnapshot } from '@shared/domain/actors';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CollectionRun, IntelligenceEvent, SourceStatus } from '@shared/domain/types';
import { backendMode } from '../config/firebase';
import { createRepository, PermissionDeniedError, type DataMode, type IntelRepository } from '../data/repository';
import { readStorage, writeStorage } from '../lib/storage';
import type { IndicatorEvaluation, RegionScore, ScoreHistoryPoint } from '@shared/domain/indicators/types';
import type { AlertRuleProblem } from '@shared/domain/alerts/types';

/** Max events kept in the dashboard working set (the snapshot is already bounded). */
export const DASHBOARD_EVENT_LIMIT = 500;
/** How often a live dashboard re-reads the snapshot (1 Firestore read each). */
export const LIVE_REFRESH_MINUTES = 10;
const LAST_SESSION_KEY = 'wt.lastSessionAt';

interface DataState {
  mode: DataMode;
  events: IntelligenceEvent[];
  sourceStatus: SourceStatus[];
  lastRun: CollectionRun | null;
  /** When the collector generated the data being shown (null in demo mode). */
  generatedAt: string | null;
  totalEventsStored: number | null;
  indicatorEvaluations: IndicatorEvaluation[];
  regionScores: RegionScore[];
  scoreHistory: ScoreHistoryPoint[];
  alertRuleProblems: AlertRuleProblem[];
  activeAlertRules: number | null;
  discordConfigured: boolean | null;
  aircraft: AircraftSnapshot | null;
  fleet: FleetSnapshot | null;
  chokepoints: ChokepointSnapshot | null;
  sanctionedShips: SanctionedShipsSnapshot | null;
  displacement: DisplacementSnapshot | null;
  baseActivity: BaseActivitySnapshot | null;
  meters: MetersSnapshot | null;
  predictionMarkets: PredictionMarketsSnapshot | null;
  infrastructure: InfrastructureSnapshot | null;
  powerOutages: PowerOutageSnapshot | null;
  tfrs: TfrSnapshot | null;
  airportStatus: AirportStatusSnapshot | null;
  airspaceNotices: AirspaceNoticesSnapshot | null;
  radiation: RadiationSnapshot | null;
  spaceWeather: SpaceWeatherSnapshot | null;
  actors: ActorsSnapshot | null;
  loading: boolean;
  error: string | null;
  accessDenied: boolean;
  /** When this browser last successfully loaded from the repository. */
  loadedAt: string | null;
  previousSessionAt: string | null;
  readsThisSession: number | null;
  refresh: () => Promise<void>;
}

const DataContext = createContext<DataState | null>(null);

export function DataProvider({ children, repository }: { children: ReactNode; repository?: IntelRepository }) {
  const repoRef = useRef<Promise<IntelRepository> | null>(null);
  const [state, setState] = useState({
    events: [] as IntelligenceEvent[],
    sourceStatus: [] as SourceStatus[],
    lastRun: null as CollectionRun | null,
    generatedAt: null as string | null,
    totalEventsStored: null as number | null,
    indicatorEvaluations: [] as IndicatorEvaluation[],
    regionScores: [] as RegionScore[],
    scoreHistory: [] as ScoreHistoryPoint[],
    alertRuleProblems: [] as AlertRuleProblem[],
    activeAlertRules: null as number | null,
    discordConfigured: null as boolean | null,
    aircraft: null as AircraftSnapshot | null,
    fleet: null as FleetSnapshot | null,
    chokepoints: null as ChokepointSnapshot | null,
    sanctionedShips: null as SanctionedShipsSnapshot | null,
    displacement: null as DisplacementSnapshot | null,
    baseActivity: null as BaseActivitySnapshot | null,
    meters: null as MetersSnapshot | null,
    predictionMarkets: null as PredictionMarketsSnapshot | null,
    infrastructure: null as InfrastructureSnapshot | null,
    powerOutages: null as PowerOutageSnapshot | null,
    tfrs: null as TfrSnapshot | null,
    airportStatus: null as AirportStatusSnapshot | null,
    airspaceNotices: null as AirspaceNoticesSnapshot | null,
    radiation: null as RadiationSnapshot | null,
    spaceWeather: null as SpaceWeatherSnapshot | null,
    actors: null as ActorsSnapshot | null,
    loadedAt: null as string | null,
    readsThisSession: null as number | null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [previousSessionAt] = useState<string | null>(() => {
    const prev = readStorage<string | null>(LAST_SESSION_KEY, null);
    writeStorage(LAST_SESSION_KEY, new Date().toISOString());
    return prev;
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      repoRef.current ??= repository ? Promise.resolve(repository) : createRepository();
      const repo = await repoRef.current;
      const d = await repo.loadDashboard();
      setState({
        events: d.events.slice(0, DASHBOARD_EVENT_LIMIT),
        sourceStatus: d.sourceStatus,
        lastRun: d.lastRun,
        generatedAt: d.generatedAt,
        totalEventsStored: d.totalEventsStored,
        indicatorEvaluations: d.indicatorEvaluations,
        regionScores: d.regionScores,
        scoreHistory: d.scoreHistory,
        alertRuleProblems: d.alertRuleProblems,
        activeAlertRules: d.activeAlertRules,
        discordConfigured: d.discordConfigured,
        aircraft: d.aircraft,
        fleet: d.fleet,
        chokepoints: d.chokepoints,
        sanctionedShips: d.sanctionedShips,
        displacement: d.displacement,
        baseActivity: d.baseActivity,
        meters: d.meters,
        predictionMarkets: d.predictionMarkets,
        infrastructure: d.infrastructure,
        powerOutages: d.powerOutages,
        tfrs: d.tfrs,
        airportStatus: d.airportStatus,
        airspaceNotices: d.airspaceNotices,
        radiation: d.radiation,
        spaceWeather: d.spaceWeather,
        actors: d.actors,
        loadedAt: new Date().toISOString(),
        readsThisSession: repo.readsThisSession(),
      });
      setError(null);
      setAccessDenied(false);
    } catch (err) {
      // Never fail silently: surface the error in the status bar and diagnostics.
      setAccessDenied(err instanceof PermissionDeniedError);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [repository]);

  useEffect(() => {
    void refresh();
    const mode = repository?.mode ?? backendMode;
    if (mode === 'demo') return;
    const id = window.setInterval(() => void refresh(), LIVE_REFRESH_MINUTES * 60_000);
    return () => window.clearInterval(id);
  }, [refresh, repository]);

  const value = useMemo<DataState>(
    () => ({
      mode: repository?.mode ?? backendMode,
      ...state,
      loading,
      error,
      accessDenied,
      previousSessionAt,
      refresh,
    }),
    [repository, state, loading, error, accessDenied, previousSessionAt, refresh],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataState {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used inside <DataProvider>');
  return ctx;
}
