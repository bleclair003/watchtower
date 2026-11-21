import type { EventCategory, IntelligenceEvent } from '@shared/domain/types';
import { getRegion } from '@shared/domain/regions';
import { isOffTopic } from '@shared/domain/relevance';
import { eventTime } from './filters';
import { HOUR } from './time';

export interface RegionSummary {
  regionId: string;
  /** Relevant records tagged to the region within the window, newest first. */
  events: IntelligenceEvent[];
  last24h: number;
  prev24h: number;
  /** Records per country (watch-region countries first, then others named alongside). */
  byCountry: { code: string; count: number; inRegion: boolean }[];
  byCategory: { category: EventCategory; count: number }[];
  /** US states named or supplied (United States region only; from metadata.usStates). */
  byState: { code: string; count: number }[];
  /** Records with exact coordinates (plotted points). */
  plotted: number;
}

const displayNames = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    return null;
  }
})();

export function countryName(code: string): string {
  try {
    return displayNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Everything a region page shows, from records already loaded (no database reads). Off-topic news excluded. */
export function summarizeRegion(all: IntelligenceEvent[], regionId: string, now: number, windowDays = 7): RegionSummary {
  const region = getRegion(regionId);
  const cutoff = now - windowDays * 24 * HOUR;
  const events = all
    .filter((e) => e.regionIds.includes(regionId) && !isOffTopic(e) && eventTime(e) >= cutoff)
    .sort((a, b) => eventTime(b) - eventTime(a));

  let last24h = 0;
  let prev24h = 0;
  const countries = new Map<string, number>();
  const categories = new Map<EventCategory, number>();
  const states = new Map<string, number>();
  let plotted = 0;
  for (const e of events) {
    const age = now - eventTime(e);
    if (age >= 0 && age < 24 * HOUR) last24h++;
    else if (age >= 24 * HOUR && age < 48 * HOUR) prev24h++;
    for (const c of e.countryCodes) countries.set(c, (countries.get(c) ?? 0) + 1);
    categories.set(e.category, (categories.get(e.category) ?? 0) + 1);
    const us = e.metadata?.usStates;
    if (Array.isArray(us)) for (const st of us) if (typeof st === 'string') states.set(st, (states.get(st) ?? 0) + 1);
    if (e.locationPrecision === 'exact' || e.locationPrecision === 'city') plotted++;
  }
  const inRegion = new Set(region?.countryCodes ?? []);
  return {
    regionId,
    events,
    last24h,
    prev24h,
    byCountry: [...countries]
      .map(([code, count]) => ({ code, count, inRegion: inRegion.has(code) }))
      .sort((a, b) => Number(b.inRegion) - Number(a.inRegion) || b.count - a.count || a.code.localeCompare(b.code)),
    byCategory: [...categories].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
    byState: [...states].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
    plotted,
  };
}
