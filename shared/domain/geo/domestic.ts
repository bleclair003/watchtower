import { matchGazetteer } from './gazetteer.ts';
import { matchUsPlaces } from './usPlaces.ts';
import { regionsForCountry } from '../regions.ts';

/**
 * How a headline feed's items are judged "inside the United States":
 *  - 'by-place': only when a US state, city or military installation is named (world news feeds).
 *  - 'unless-foreign': US-based sources (DoD, the services, US defence press): domestic unless the
 *    headline names a foreign country, in which case it is about the US abroad.
 *  - 'always': a national desk that only covers the US (NPR National).
 * A US place name always makes an item domestic, whatever the mode.
 */
export type UsMode = 'by-place' | 'unless-foreign' | 'always';

/**
 * Words that place a story abroad without naming a country. Found on live data:
 * "Hegseth Wraps Central, South American Trip …" was counted as domestic before this.
 */
const ABROAD = /(?<![\p{L}])(Central America\w*|South America\w*|Latin America\w*|North Africa\w*|Africa\w*|Europe\w*|Asia\w*|Middle East\w*|Indo-Pacific|Pacific|Arctic|Antarctic\w*|Caribbean|Balkans|abroad|overseas|worldwide|foreign|international|allies|allied|NATO|Operation Deep Freeze)(?![\p{L}])/iu;

export interface HeadlineGeo {
  countryCodes: string[];
  regionIds: string[];
  /** Matched words (countries, areas, US places), for display and audit. */
  terms: string[];
  usDomestic: boolean;
  usBasis: 'place' | 'source' | null;
  usStates: string[];
}

export function headlineGeo(title: string, mode: UsMode = 'by-place'): HeadlineGeo {
  const g = matchGazetteer(title);
  const us = matchUsPlaces(title);
  const foreign = g.countryCodes.filter((c) => c !== 'US');
  const byPlace = us.states.length > 0;
  const abroad = foreign.length > 0 || ABROAD.test(title);
  const bySource = !byPlace && (mode === 'always' || (mode === 'unless-foreign' && !abroad));
  const usDomestic = byPlace || bySource;
  // A bare "US" in a headline does not make it domestic: only the rules above do.
  const regionIds = new Set([...foreign.flatMap(regionsForCountry), ...g.areaRegionIds]);
  if (usDomestic) regionIds.add('united-states');
  const countryCodes = [...new Set([...g.countryCodes.filter((c) => c !== 'US' || usDomestic), ...(usDomestic ? ['US'] : [])])];
  return {
    countryCodes: usDomestic ? countryCodes : g.countryCodes,
    regionIds: [...regionIds],
    terms: [...new Set([...g.terms, ...us.terms])],
    usDomestic,
    usBasis: byPlace ? 'place' : bySource ? 'source' : null,
    usStates: us.states,
  };
}
