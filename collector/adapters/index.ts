import type { SourceAdapter } from './types.ts';
import { stateTravelAdvisories } from './stateTravelAdvisories.ts';
import { cisaAdvisories } from './cisaAdvisories.ts';
import { cisaKev } from './cisaKev.ts';
import { fcdoTravelAdvice } from './fcdoTravelAdvice.ts';
import { usgsEarthquakes } from './usgsEarthquakes.ts';
import { gdacs } from './gdacs.ts';
import { iodaOutages } from './ioda.ts';
import { firms } from './firms.ts';
import { cloudflareRadarOutages } from './cloudflareRadar.ts';
import { airForceNews, aljazeera, bbcWorld, defenseNews, iaeaNews, marinesNews, militaryTimes, nprNational, ukMod, unNews, warGovNews } from './news.ts';
import { dhsNtas, faaTfr, femaDeclarations, nwsAlerts } from './usDomestic.ts';
import { militaryAircraft } from './militaryAircraft.ts';
import { usniFleetTracker } from './usniFleet.ts';
import { portwatchChokepoints } from './portwatch.ts';
import { euSanctions, ofacSdn, ukSanctions } from './sanctions.ts';
import { aisSanctionedShips } from './aisSanctioned.ts';
import { unSecurityCouncil } from './unsc.ts';

/** Active adapters. Adding a source = write an adapter + register it here. */
export const ADAPTERS: SourceAdapter<never>[] = [
  stateTravelAdvisories as SourceAdapter<never>,
  cisaAdvisories as SourceAdapter<never>,
  cisaKev as SourceAdapter<never>,
  fcdoTravelAdvice as SourceAdapter<never>,
  usgsEarthquakes as SourceAdapter<never>,
  gdacs as SourceAdapter<never>,
  iodaOutages as SourceAdapter<never>,
  warGovNews as SourceAdapter<never>,
  ukMod as SourceAdapter<never>,
  iaeaNews as SourceAdapter<never>,
  unNews as SourceAdapter<never>,
  bbcWorld as SourceAdapter<never>,
  aljazeera as SourceAdapter<never>,
  // US domestic (v0.13)
  faaTfr as SourceAdapter<never>,
  dhsNtas as SourceAdapter<never>,
  femaDeclarations as SourceAdapter<never>,
  nwsAlerts as SourceAdapter<never>,
  airForceNews as SourceAdapter<never>,
  marinesNews as SourceAdapter<never>,
  militaryTimes as SourceAdapter<never>,
  defenseNews as SourceAdapter<never>,
  nprNational as SourceAdapter<never>,
  // Phase 13
  militaryAircraft as SourceAdapter<never>,
  usniFleetTracker as SourceAdapter<never>,
  portwatchChokepoints as SourceAdapter<never>,
  ofacSdn as SourceAdapter<never>,
  euSanctions as SourceAdapter<never>,
  ukSanctions as SourceAdapter<never>,
  unSecurityCouncil as SourceAdapter<never>,
  // Free-key sources: active only when their key is set.
  firms as SourceAdapter<never>,
  cloudflareRadarOutages as SourceAdapter<never>,
  // Last: it awaits the AIS window that listened while the sources above were collected.
  aisSanctionedShips as SourceAdapter<never>,
];
