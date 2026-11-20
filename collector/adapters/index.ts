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
import { aljazeera, bbcWorld, iaeaNews, ukMod, unNews, warGovNews } from './news.ts';

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
  // Free-key sources: active only when their key is set.
  firms as SourceAdapter<never>,
  cloudflareRadarOutages as SourceAdapter<never>,
];
