import type { IntelligenceEvent, SourceStatus } from '../types.ts';
import type { RegionScore, ScoreHistoryPoint } from '../indicators/types.ts';
import type { AircraftSnapshot } from '../aircraft.ts';
import type { FleetSnapshot } from '../fleet.ts';
import type { ChokepointSnapshot } from '../chokepoints.ts';
import type { SanctionedShipsSnapshot } from '../sanctionedShips.ts';
import type { DisplacementSnapshot } from '../displacement.ts';
import type { MetersSnapshot } from './types.ts';

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
  upcomingLaunches?: UpcomingLaunch[];
  /** The previous meters snapshot (counters and history carry over). */
  previous?: MetersSnapshot | null;
}
