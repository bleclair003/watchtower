/**
 * Unusual aircraft movement (v0.63.0): records the collector makes from the ADS-B snapshots when an
 * aircraft does something WATCHTOWER has not seen recently. See collector/adapters/aircraftPatterns.ts.
 */
export const AIRCRAFT_PATTERN_SUBTYPE = 'aircraft-pattern';
export type AircraftPattern = 'hold' | 'first-appearance';
export const AIRCRAFT_PATTERN_LABEL: Record<AircraftPattern, string> = {
  hold: 'unusual hold',
  'first-appearance': 'first appearance',
};
/** "Not seen recently" means not in this many days. */
export const PATTERN_NOVELTY_DAYS = 30;
/** Nothing is flagged until the memory is this old (before that everything looks new). */
export const PATTERN_LEARNING_DAYS = 14;

export const isAircraftPattern = (e: { sourceId: string; metadata?: Record<string, unknown> }) =>
  e.sourceId === 'adsb-military' && e.metadata?.subtype === AIRCRAFT_PATTERN_SUBTYPE;
