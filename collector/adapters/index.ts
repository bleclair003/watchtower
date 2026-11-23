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
import { yonhapDprkLaunches } from './yonhapDprk.ts';
import { dodContracts } from './dodContracts.ts';
import { federalRegister } from './federalRegister.ts';
import { militaryLaunches } from './launches.ts';
import { whoDiseaseOutbreakNews } from './whoDon.ts';
import { fxRates, oilPrices } from './economy.ts';
import { unhcrDisplacement } from './unhcr.ts';
import { polymarketOdds } from './polymarket.ts';
import { odinPowerOutages } from './odin.ts';
import { faaAirportStatus, faaAirspaceNotices } from './faa.ts';
import { bfsOdl, epaRadnet, stukRadiation } from './radiation.ts';
import { nasaDonki, noaaSwpc } from './spaceWeather.ts';
import { cccsCanada, certUa, firstEpss, jpcert, ncscUk } from './cyberAgencies.ts';
import { uaGeneralStaff, ukrinformWar } from './ukraineFront.ts';
import { uaAirForce } from './uaAirForce.ts';
import { ooni } from './ooni.ts';
import { ngaMsi } from './ngaMsi.ts';
import { adsbEmergencies } from './adsbEmergencies.ts';
import { radioReceivers } from './radioReceivers.ts';
import { shortwaveSchedule } from './shortwaveSchedule.ts';
import { localRadio } from './localRadio.ts';
import { ucdp } from './ucdp.ts';
import { congress } from './congress.ts';

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
  yonhapDprkLaunches as SourceAdapter<never>,
  dodContracts as SourceAdapter<never>,
  federalRegister as SourceAdapter<never>,
  militaryLaunches as SourceAdapter<never>,
  whoDiseaseOutbreakNews as SourceAdapter<never>,
  fxRates as SourceAdapter<never>,
  oilPrices as SourceAdapter<never>,
  unhcrDisplacement as SourceAdapter<never>,
  polymarketOdds as SourceAdapter<never>,
  odinPowerOutages as SourceAdapter<never>,
  faaAirportStatus as SourceAdapter<never>,
  faaAirspaceNotices as SourceAdapter<never>,
  bfsOdl as SourceAdapter<never>,
  stukRadiation as SourceAdapter<never>,
  epaRadnet as SourceAdapter<never>,
  noaaSwpc as SourceAdapter<never>,
  nasaDonki as SourceAdapter<never>,
  ncscUk as SourceAdapter<never>,
  cccsCanada as SourceAdapter<never>,
  jpcert as SourceAdapter<never>,
  certUa as SourceAdapter<never>,
  firstEpss as SourceAdapter<never>,
  ukrinformWar as SourceAdapter<never>,
  uaGeneralStaff as SourceAdapter<never>,
  uaAirForce as SourceAdapter<never>,
  ooni as SourceAdapter<never>,
  ngaMsi as SourceAdapter<never>,
  adsbEmergencies as SourceAdapter<never>,
  ucdp as SourceAdapter<never>,
  radioReceivers as SourceAdapter<never>,
  shortwaveSchedule as SourceAdapter<never>,
  localRadio as SourceAdapter<never>,
  // Free-key sources: active only when their key is set.
  firms as SourceAdapter<never>,
  cloudflareRadarOutages as SourceAdapter<never>,
  congress as SourceAdapter<never>,
  // Last: it awaits the AIS window that listened while the sources above were collected.
  aisSanctionedShips as SourceAdapter<never>,
];
