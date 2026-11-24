import type { CollectionRun, IntelligenceEvent, SourceStatus } from '@shared/domain/types';
import { SOURCE_REGISTRY } from '@shared/domain/sources';
import { backendMode, type BackendMode } from '../config/firebase';
import { buildDemoEvents } from './demo/demoEvents';
import type { IndicatorEvaluation, RegionScore, ScoreHistoryPoint } from '@shared/domain/indicators/types';
import { INDICATOR_CATALOG } from '@shared/domain/indicators/catalog';
import { evaluateAll } from '@shared/domain/indicators/evaluate';
import { computeAllRegionScores } from '@shared/domain/indicators/rai';
import type { AlertRuleProblem } from '@shared/domain/alerts/types';
import type { AircraftSnapshot } from '@shared/domain/aircraft';
import { buildDemoAircraft } from './demo/demoAircraft';
import type { FleetSnapshot } from '@shared/domain/fleet';
import { buildDemoFleet } from './demo/demoFleet';
import type { ChokepointSnapshot } from '@shared/domain/chokepoints';
import { buildDemoChokepoints } from './demo/demoChokepoints';
import type { SanctionedShipsSnapshot } from '@shared/domain/sanctionedShips';
import { buildDemoSanctionedShips } from './demo/demoSanctionedShips';
import type { DisplacementSnapshot } from '@shared/domain/displacement';
import { buildDemoDisplacement } from './demo/demoDisplacement';
import type { BaseActivitySnapshot } from '@shared/domain/baseActivity';
import { buildDemoBaseActivity } from './demo/demoBaseActivity';
import type { MetersSnapshot } from '@shared/domain/meters/types';
import { buildDemoMeters } from './demo/demoMeters';
import type { PredictionMarketsSnapshot } from '@shared/domain/predictionMarkets';
import { buildDemoMarkets } from './demo/demoMarkets';
import type { InfrastructureSnapshot } from '@shared/domain/infrastructure';
import { buildDemoInfrastructure } from './demo/demoInfrastructure';
import type { PowerOutageSnapshot } from '@shared/domain/powerOutages';
import { buildDemoPowerOutages } from './demo/demoPowerOutages';
import type { AirportStatusSnapshot, AirspaceNoticesSnapshot, TfrSnapshot } from '@shared/domain/faa';
import { buildDemoAirportStatus, buildDemoAirspaceNotices, buildDemoTfrs } from './demo/demoFaa';
import type { RadiationSnapshot } from '@shared/domain/radiation';
import { buildDemoRadiation } from './demo/demoRadiation';
import type { SpaceWeatherSnapshot } from '@shared/domain/spaceWeather';
import { buildDemoSpaceWeather } from './demo/demoSpaceWeather';
import type { CyberSnapshot } from '@shared/domain/cyber';
import { buildDemoCyber } from './demo/demoCyber';
import type { UkraineFrontSnapshot } from '@shared/domain/ukraineFront';
import { buildDemoUkraineFront } from './demo/demoUkraineFront';
import type { CensorshipSnapshot } from '@shared/domain/censorship';
import { buildDemoCensorship } from './demo/demoCensorship';
import type { NavWarningSnapshot } from '@shared/domain/navWarnings';
import type { EmergencySnapshot } from '@shared/domain/aircraftEmergencies';
import type { GnssSnapshot } from '@shared/domain/gnss';
import type { NetAttackSnapshot } from '@shared/domain/netAttacks';
import type { ConvergenceSnapshot } from '@shared/domain/convergence';
import type { TaiwanPlaSnapshot } from '@shared/domain/taiwanPla';
import type { RadioReceiversSnapshot } from '@shared/domain/radio';
import type { ConflictSnapshot } from '@shared/domain/conflictEvents';
import { buildDemoConflicts, buildDemoEmergencies, buildDemoNavWarnings, buildDemoReceivers } from './demo/demoPhase25';
import { buildDemoGnss } from './demo/demoGnss';
import { buildDemoConvergence } from './demo/demoConvergence';
import { buildDemoTaiwanPla } from './demo/demoTaiwanPla';
import { buildDemoNetAttacks } from './demo/demoNetAttacks';
import type { ActorsSnapshot } from '@shared/domain/actors';
import { computeActors } from '@shared/domain/actorsTrack';

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
  /** Latest military aircraft positions (ADS-B), or null. */
  aircraft: AircraftSnapshot | null;
  /** Latest USNI News fleet tracker, or null. */
  fleet: FleetSnapshot | null;
  /** Chokepoint transits (IMF PortWatch), or null. */
  chokepoints: ChokepointSnapshot | null;
  /** Sanctioned vessels seen on AIS, or null. */
  sanctionedShips: SanctionedShipsSnapshot | null;
  /** UNHCR displacement figures, or null. */
  displacement: DisplacementSnapshot | null;
  /** Activity near bases, or null. */
  baseActivity: BaseActivitySnapshot | null;
  /** Meters and monitors (Phase 14), or null before the first run that computed them. */
  meters: MetersSnapshot | null;
  /** Prediction-market odds (Polymarket), or null. */
  predictionMarkets: PredictionMarketsSnapshot | null;
  /** Infrastructure with records near or naming it (72 h), or null. */
  infrastructure: InfrastructureSnapshot | null;
  /** US customers without power by state and county (ODIN), or null. */
  powerOutages: PowerOutageSnapshot | null;
  /** FAA flight restrictions, airport status and notices for US flights abroad, or null. */
  tfrs: TfrSnapshot | null;
  airportStatus: AirportStatusSnapshot | null;
  airspaceNotices: AirspaceNoticesSnapshot | null;
  /** Radiation networks (Germany, Finland, US), or null. */
  radiation: RadiationSnapshot | null;
  /** Space weather (NASA DONKI, NOAA SWPC), or null. */
  spaceWeather: SpaceWeatherSnapshot | null;
  /** CYBER page data, or null. */
  cyber: CyberSnapshot | null;
  /** Ukraine front panel data, or null. */
  ukraineFront: UkraineFrontSnapshot | null;
  /** OONI censorship grid, or null. */
  censorship: CensorshipSnapshot | null;
  /** Phase 25: navigational warnings, aircraft emergencies, UCDP conflict events (or null). */
  navWarnings: NavWarningSnapshot | null;
  aircraftEmergencies: EmergencySnapshot | null;
  gnss: GnssSnapshot | null;
  netAttacks: NetAttackSnapshot | null;
  convergence: ConvergenceSnapshot | null;
  taiwanPla: TaiwanPlaSnapshot | null;
  /** Phase 28: public shortwave receivers (or null). */
  radioReceivers: RadioReceiversSnapshot | null;
  conflictEvents: ConflictSnapshot | null;
  /** Tracked people and groups and new names, or null. */
  actors: ActorsSnapshot | null;
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
    const data: Omit<DashboardData, 'meters'> = {
      indicatorEvaluations: evaluations,
      regionScores: computeAllRegionScores(INDICATOR_CATALOG, evaluations, now),
      scoreHistory: [],
      alertRuleProblems: [],
      activeAlertRules: null,
      discordConfigured: null,
      aircraft: buildDemoAircraft(now),
      fleet: buildDemoFleet(now),
      chokepoints: buildDemoChokepoints(now),
      sanctionedShips: buildDemoSanctionedShips(now),
      displacement: buildDemoDisplacement(now),
      baseActivity: buildDemoBaseActivity(now),
      predictionMarkets: buildDemoMarkets(now),
      infrastructure: buildDemoInfrastructure(now),
      powerOutages: buildDemoPowerOutages(now),
      tfrs: buildDemoTfrs(now),
      airportStatus: buildDemoAirportStatus(now),
      airspaceNotices: buildDemoAirspaceNotices(now),
      radiation: buildDemoRadiation(now),
      spaceWeather: buildDemoSpaceWeather(now),
      cyber: buildDemoCyber(now),
      ukraineFront: buildDemoUkraineFront(now),
      censorship: buildDemoCensorship(now),
      navWarnings: buildDemoNavWarnings(now),
      aircraftEmergencies: buildDemoEmergencies(now),
      gnss: buildDemoGnss(now),
      netAttacks: buildDemoNetAttacks(now),
      convergence: buildDemoConvergence(now),
      taiwanPla: buildDemoTaiwanPla(now),
      radioReceivers: buildDemoReceivers(now),
      conflictEvents: buildDemoConflicts(now),
      // The real tracker over the demo records (no registry: nothing counts as new in demo mode).
      actors: { ...computeActors(this.events, now, null, null).snapshot, simulated: true },
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
    return { ...data, meters: buildDemoMeters(now, this.events, data) };
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
