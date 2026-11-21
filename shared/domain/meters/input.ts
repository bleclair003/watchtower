import type { IntelligenceEvent, SourceStatus } from '../types.ts';
import type { RegionScore, ScoreHistoryPoint } from '../indicators/types.ts';
import type { AircraftSnapshot } from '../aircraft.ts';
import type { FleetSnapshot } from '../fleet.ts';
import type { ChokepointSnapshot } from '../chokepoints.ts';
import type { SanctionedShipsSnapshot } from '../sanctionedShips.ts';
import type { DisplacementSnapshot } from '../displacement.ts';
import type { PredictionMarketsSnapshot } from '../predictionMarkets.ts';
import type { InfrastructureSnapshot } from '../infrastructure.ts';
import type { ActorsSnapshot } from '../actors.ts';
import type { MetersSnapshot } from './types.ts';
import type { HolidayCounts } from './util.ts';

export interface UpcomingLaunch {
  name: string;
  net: string;
  provider: string | null;
  country: string | null;
  status: string;
  url: string | null;
}

/** Everything the meters read. All optional layers may be null (source not configured yet). */
export interface MeterInput {
  now: number;
  /** All records the collector loaded (about 36 days, or since records began). */
  events: IntelligenceEvent[];
  /** Oldest stored record (ms), or null. */
  historyStart: number | null;
  sourceStatus: SourceStatus[];
  regionScores: RegionScore[];
  scoreHistory: ScoreHistoryPoint[];
  aircraft?: AircraftSnapshot | null;
  fleet?: FleetSnapshot | null;
  chokepoints?: ChokepointSnapshot | null;
  sanctionedShips?: SanctionedShipsSnapshot | null;
  displacement?: DisplacementSnapshot | null;
  predictionMarkets?: PredictionMarketsSnapshot | null;
  infrastructure?: InfrastructureSnapshot | null;
  actors?: ActorsSnapshot | null;
  upcomingLaunches?: UpcomingLaunch[];
  /** Stored daily counts on earlier holidays, per series (collector state; like-for-like baselines). */
  holidayCounts?: HolidayCounts | null;
  /** Filled while computing: holiday-day counts seen in the loaded records, for the collector to store. */
  holidaySink?: HolidayCounts | null;
  /** The previous meters snapshot (counters and history carry over). */
  previous?: MetersSnapshot | null;
}
