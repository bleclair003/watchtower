import type { EventCategory, IntelligenceEvent } from '@shared/domain/types';
import { WATCH_REGIONS } from '@shared/domain/regions';
import { isOffTopic } from '@shared/domain/relevance';
import { HOUR } from './time';

export type SourceClassFilter = 'all' | 'official' | 'non-official';

export interface DashboardFilters {
  regionId: string | null;
  /** Empty = all categories. */
  categories: EventCategory[];
  sourceId: string | null;
  /** null = no time limit. */
  windowHours: number | null;
  sourceClass: SourceClassFilter;
  keyword: string;
  /** Show news items marked off-topic (sport, entertainment …). Hidden by default. */
  showOffTopic: boolean;
}

export const DEFAULT_FILTERS: DashboardFilters = {
  regionId: null,
  categories: [],
  sourceId: null,
  windowHours: 72,
  sourceClass: 'all',
  keyword: '',
  showOffTopic: false,
};

export const TIME_WINDOWS: { hours: number | null; label: string }[] = [
  { hours: 6, label: '6H' },
  { hours: 24, label: '24H' },
  { hours: 72, label: '72H' },
  { hours: 168, label: '7D' },
  { hours: null, label: 'ALL' },
];

/** The timestamp used for ordering and time-window filtering. */
export function eventTime(e: IntelligenceEvent): number {
  return Date.parse(e.publishedAt ?? e.collectedAt);
}

export function applyFilters(
  events: IntelligenceEvent[],
  f: DashboardFilters,
  now: number = Date.now(),
): IntelligenceEvent[] {
  const kw = f.keyword.trim().toLowerCase();
  const cutoff = f.windowHours == null ? -Infinity : now - f.windowHours * HOUR;

  return events
    .filter((e) => {
      if (!f.showOffTopic && isOffTopic(e)) return false;
      if (f.regionId && !e.regionIds.includes(f.regionId)) return false;
      if (f.categories.length && !f.categories.includes(e.category)) return false;
      if (f.sourceId && e.sourceId !== f.sourceId) return false;
      if (f.sourceClass === 'official' && e.sourceClass !== 'official') return false;
      if (f.sourceClass === 'non-official' && e.sourceClass === 'official') return false;
      if (eventTime(e) < cutoff) return false;
      if (kw) {
        const hay = `${e.title} ${e.summary ?? ''} ${e.sourceName} ${e.countryCodes.join(' ')}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    })
    .sort((a, b) => eventTime(b) - eventTime(a));
}

export function countActiveFilters(f: DashboardFilters): number {
  let n = 0;
  if (f.regionId) n++;
  if (f.categories.length) n++;
  if (f.sourceId) n++;
  if (f.sourceClass !== 'all') n++;
  if (f.keyword.trim()) n++;
  if (f.showOffTopic) n++;
  if (f.windowHours !== DEFAULT_FILTERS.windowHours) n++;
  return n;
}

export interface RegionStats {
  regionId: string;
  last24h: number;
  prev24h: number;
  delta: number;
  latestAt: string | null;
}

/**
 * Report counts per watch region. This is a plain volume count — NOT the
 * Regional Activity Index, which requires the Phase 3 indicator engine.
 */
export function computeRegionStats(events: IntelligenceEvent[], now: number = Date.now()): RegionStats[] {
  return WATCH_REGIONS.map((r) => {
    let last24h = 0;
    let prev24h = 0;
    let latest = -Infinity;
    for (const e of events) {
      if (!e.regionIds.includes(r.id)) continue;
      const t = eventTime(e);
      if (t > latest) latest = t;
      const age = now - t;
      if (age >= 0 && age < 24 * HOUR) last24h++;
      else if (age >= 24 * HOUR && age < 48 * HOUR) prev24h++;
    }
    return {
      regionId: r.id,
      last24h,
      prev24h,
      delta: last24h - prev24h,
      latestAt: Number.isFinite(latest) ? new Date(latest).toISOString() : null,
    };
  });
}
