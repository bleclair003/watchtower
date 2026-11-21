import { WATCH_REGIONS } from '../regions.ts';
import type { MeterInput } from './input.ts';
import type { LeadLagResult, Meter, MetersSnapshot } from './types.ts';
import { buildupVsNoise, escalationLadder, evacuationRisk } from './region.ts';
import {
  airSurge,
  armsFlow,
  cyberWeather,
  diplomaticTemperature,
  economicStress,
  homelandBoard,
  humanitarianStrain,
  informationBlackout,
  maritimeRisk,
  navalPresence,
  sanctionsPressure,
  strategicWeapons,
  washingtonAttention,
} from './topics.ts';
import { corroboration, visibility } from './quality.ts';
import { afterHours } from './afterHours.ts';
import { marketOdds } from './markets.ts';
import { infrastructureMeter } from './infrastructure.ts';
import { languageTemperature } from './languageTemp.ts';
import { actorsMeter } from './actorsMeter.ts';
import { coverageMeter } from './coverageMeter.ts';
import { whoIsFirst } from '../speed.ts';
import { trackRecord } from '../trackRecord.ts';
import { quietMeter } from './quietMeter.ts';
import { powerOutageMeter } from './power.ts';
import { airspaceMeter } from './airspace.ts';
import { radiationMeter } from './radiationMeter.ts';
import { daysSince, upcomingCalendar } from './clocks.ts';
import { appendShort, pointFor } from './history.ts';
import { BASELINE_DAYS, DAY } from './util.ts';

export type { MeterInput } from './input.ts';
export * from './types.ts';

/** Geographic watch regions (the cyber watch has no territory). */
export const GEO_REGIONS = WATCH_REGIONS.filter((r) => r.id !== 'global-cyber').map((r) => r.id);
const ABROAD = GEO_REGIONS.filter((r) => r !== 'united-states');

/** Every meter, in display order. Pure: same input → same meters. */
export function allMeters(input: MeterInput): Meter[] {
  return [
    ...GEO_REGIONS.map((r) => escalationLadder(input, r)),
    ...ABROAD.map((r) => evacuationRisk(input, r)),
    ...GEO_REGIONS.map((r) => buildupVsNoise(input, r)),
    ...GEO_REGIONS.map((r) => airSurge(input, r)),
    navalPresence(input),
    ...maritimeRisk(input),
    sanctionsPressure(input),
    armsFlow(input),
    washingtonAttention(input),
    ...GEO_REGIONS.map((r) => diplomaticTemperature(input, r)),
    ...GEO_REGIONS.map((r) => languageTemperature(input, r)),
    ...GEO_REGIONS.map((r) => actorsMeter(input, r)),
    strategicWeapons(input),
    ...GEO_REGIONS.map((r) => informationBlackout(input, r)),
    ...GEO_REGIONS.map((r) => powerOutageMeter(input, r)),
    ...GEO_REGIONS.map((r) => airspaceMeter(input, r)),
    ...ABROAD.map((r) => economicStress(input, r)),
    ...GEO_REGIONS.map((r) => humanitarianStrain(input, r)),
    ...GEO_REGIONS.map((r) => infrastructureMeter(input, r)),
    homelandBoard(input),
    afterHours(input),
    marketOdds(input),
    cyberWeather(input),
    radiationMeter(input),
    quietMeter(input),
    ...GEO_REGIONS.map((r) => corroboration(input, r)),
    ...GEO_REGIONS.map((r) => coverageMeter(input, r)),
    ...WATCH_REGIONS.map((r) => visibility(input, r.id)),
  ];
}

/**
 * Computes the meters snapshot. Counters and the short history carry over from `input.previous`;
 * the lead/lag result is computed by the caller from the long history (collector) and passed in.
 */
export function computeMeters(input: MeterInput, leadLag: LeadLagResult | null = null): MetersSnapshot {
  const nowIso = new Date(input.now).toISOString();
  const meters = allMeters(input);
  return {
    computedAt: nowIso,
    historyDays: input.historyStart === null ? 0 : Math.round(((input.now - input.historyStart) / DAY) * 10) / 10,
    baselineDays: BASELINE_DAYS,
    meters,
    counters: daysSince(input),
    calendar: upcomingCalendar(input),
    history: appendShort(input.previous?.history ?? [], pointFor(meters, input.regionScores, nowIso)),
    leadLag: leadLag ?? input.previous?.leadLag ?? null,
    speed: whoIsFirst(input.events, input.now),
    trackRecord: trackRecord(input.events, input.now, input.historyStart),
  };
}
