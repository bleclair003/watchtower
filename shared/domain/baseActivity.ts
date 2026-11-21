import type { IntelligenceEvent } from './types.ts';
import { distanceKm, installationAliases, isDistinctiveName, type Installation, type WorldInstallation } from './installations.ts';

/**
 * Phase 13 item 17: activity near bases. Counts the records that name each installation or lie
 * within 50 km of it this week, against its usual weekly level over the earlier weeks of loaded
 * history. Runs in the collector over the events it already loads; the result goes in the snapshot.
 */

export const BASE_ACTIVITY = {
  weekDays: 7,
  /** No flags until this much history exists (fewer weeks make the baseline meaningless). */
  minHistoryDays: 21,
  /** At most this many earlier weeks form the baseline. */
  maxBaselineWeeks: 4,
  /** Unusual = at least this many records this week… */
  minWeek: 3,
  /** …from at least this many sources… */
  minSources: 2,
  /** …and at least this many times the usual weekly level (a usual level under 1 counts as 1). */
  ratio: 3,
  radiusKm: 50,
  maxItems: 250,
};

/**
 * Location matches count only for record kinds that say something about activity. Weather
 * warnings, earthquakes and fire detections near a base are not activity at the base.
 */
const NEARBY_CATEGORIES = new Set(['military', 'unrest', 'aviation', 'maritime', 'diplomatic', 'cyber']);
const NEARBY_EXCLUDED_SOURCES = new Set(['nws-alerts', 'usgs-earthquakes', 'gdacs', 'nasa-firms', 'fema-declarations']);

export interface BaseRef {
  /** `dod:<name>` or `wd:<Q-id>`, as used by the map and the card. */
  key: string;
  name: string;
  lat: number;
  lon: number;
  country: string;
}

export const dodBaseRef = (i: Installation): BaseRef => ({ key: `dod:${i.name}`, name: i.name, lat: i.lat, lon: i.lon, country: 'US' });
export const worldBaseRef = (w: WorldInstallation): BaseRef => ({ key: `wd:${w.q}`, name: w.n, lat: w.la, lon: w.lo, country: w.c });

export interface BaseMatch {
  key: string;
  how: 'named' | 'nearby';
}

const WORD = /[\p{L}\p{N}]+/gu;
const words = (s: string) => s.match(WORD) ?? [];
const MAX_ALIAS_WORDS = 8;

interface AliasEntry {
  ref: BaseRef;
  /** The installation's full name: matched in any case and in any record. */
  full: boolean;
  /** One-word short name: Capitalised or ALL CAPS only, as written. */
  single: string | null;
}

/**
 * Matcher over all installations, built once. Names use the same rules as the installation card
 * (full name in any case; short names only in records about the installation's own country,
 * one-word short names only as written or in capitals), found by word n-gram lookup rather than
 * one regular expression per installation. Locations use a 1° grid.
 */
export function buildBaseMatcher(refs: BaseRef[]): (e: IntelligenceEvent) => BaseMatch[] {
  const byAlias = new Map<string, AliasEntry[]>();
  for (const ref of refs) {
    for (const a of installationAliases(ref.name)) {
      const w = words(a);
      if (w.length === 0 || w.length > MAX_ALIAS_WORDS) continue;
      const k = w.join(' ').toLowerCase();
      const full = a === ref.name && isDistinctiveName(a);
      const entry: AliasEntry = { ref, full, single: !full && w.length === 1 ? w[0] : null };
      byAlias.set(k, [...(byAlias.get(k) ?? []), entry]);
    }
  }
  const grid = new Map<string, BaseRef[]>();
  const cell = (lat: number, lon: number) => `${Math.floor(lat)}:${Math.floor(lon)}`;
  for (const ref of refs) grid.set(cell(ref.lat, ref.lon), [...(grid.get(cell(ref.lat, ref.lon)) ?? []), ref]);

  return (e) => {
    const out = new Map<string, BaseMatch>();
    const text = words(`${e.title} ${e.summary ?? ''}`);
    const lower = text.map((w) => w.toLowerCase());
    for (let i = 0; i < text.length; i++) {
      let k = '';
      for (let n = 1; n <= MAX_ALIAS_WORDS && i + n <= text.length; n++) {
        k = n === 1 ? lower[i] : `${k} ${lower[i + n - 1]}`;
        const entries = byAlias.get(k);
        if (!entries) continue;
        for (const a of entries) {
          if (out.has(a.ref.key)) continue;
          const sameCountry = e.countryCodes.includes(a.ref.country) || (a.ref.country === 'US' && e.regionIds.includes('united-states'));
          if (!a.full && !sameCountry) continue;
          if (a.single && text[i] !== a.single && text[i] !== a.single.toUpperCase()) continue;
          out.set(a.ref.key, { key: a.ref.key, how: 'named' });
        }
      }
    }
    if (
      (e.locationPrecision === 'exact' || e.locationPrecision === 'city') &&
      typeof e.latitude === 'number' &&
      typeof e.longitude === 'number' &&
      NEARBY_CATEGORIES.has(e.category) &&
      !NEARBY_EXCLUDED_SOURCES.has(e.sourceId)
    ) {
      const la = Math.floor(e.latitude);
      const lo = Math.floor(e.longitude);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          for (const ref of grid.get(`${la + dy}:${lo + dx}`) ?? []) {
            if (!out.has(ref.key) && distanceKm(ref.lat, ref.lon, e.latitude, e.longitude) <= BASE_ACTIVITY.radiusKm) out.set(ref.key, { key: ref.key, how: 'nearby' });
          }
        }
      }
    }
    return [...out.values()];
  };
}

export interface BaseActivityItem {
  key: string;
  name: string;
  /** Records this week (last 7 days). */
  week: number;
  named: number;
  nearby: number;
  sources: number;
  /** Mean records per earlier week, or null without enough history. */
  usualPerWeek: number | null;
  unusual: boolean;
  latestAt: string;
}

export interface BaseActivitySnapshot {
  computedAt: string;
  /** Oldest loaded record: the start of usable history. */
  historyStart: string | null;
  historyDays: number;
  /** Earlier weeks averaged for the usual level (0 until there is a full earlier week). */
  baselineWeeks: number;
  /** Whether flags are possible yet (history ≥ minHistoryDays). */
  flagsActive: boolean;
  /** Installations with any record this week, unusual first, then by count. */
  items: BaseActivityItem[];
  simulated?: boolean;
}

const DAY = 86_400_000;
const at = (e: IntelligenceEvent) => Date.parse(e.publishedAt ?? e.collectedAt);

export function computeBaseActivity(refs: BaseRef[], events: IntelligenceEvent[], now: number, matcher = buildBaseMatcher(refs)): BaseActivitySnapshot {
  const P = BASE_ACTIVITY;
  const seen = new Set<string>();
  const unique = events.filter((e) => (seen.has(e.contentHash) ? false : (seen.add(e.contentHash), true)));
  const oldest = unique.reduce((m, e) => Math.min(m, Date.parse(e.collectedAt)), Infinity);
  const historyDays = Number.isFinite(oldest) ? Math.max(0, (now - oldest) / DAY) : 0;
  const baselineWeeks = Math.min(P.maxBaselineWeeks, Math.floor((historyDays - P.weekDays) / P.weekDays));
  const flagsActive = historyDays >= P.minHistoryDays && baselineWeeks >= 1;
  const weekStart = now - P.weekDays * DAY;
  const baseStart = weekStart - Math.max(0, baselineWeeks) * P.weekDays * DAY;

  const names = new Map(refs.map((r) => [r.key, r.name]));
  const acc = new Map<string, { week: number; named: number; nearby: number; sources: Set<string>; earlier: number; latest: number }>();
  for (const e of unique) {
    const t = at(e);
    if (t < baseStart || t > now + 3_600_000) continue;
    for (const m of matcher(e)) {
      const a = acc.get(m.key) ?? { week: 0, named: 0, nearby: 0, sources: new Set<string>(), earlier: 0, latest: 0 };
      if (t >= weekStart) {
        a.week++;
        a[m.how]++;
        a.sources.add(e.sourceId);
        a.latest = Math.max(a.latest, t);
      } else {
        a.earlier++;
      }
      acc.set(m.key, a);
    }
  }

  const items: BaseActivityItem[] = [];
  for (const [key, a] of acc) {
    if (a.week === 0) continue;
    const usual = baselineWeeks >= 1 ? a.earlier / baselineWeeks : null;
    const unusual = flagsActive && usual !== null && a.week >= P.minWeek && a.sources.size >= P.minSources && a.week >= P.ratio * Math.max(1, usual);
    items.push({ key, name: names.get(key) ?? key, week: a.week, named: a.named, nearby: a.nearby, sources: a.sources.size, usualPerWeek: usual === null ? null : Math.round(usual * 10) / 10, unusual, latestAt: new Date(a.latest).toISOString() });
  }
  items.sort((x, y) => Number(y.unusual) - Number(x.unusual) || y.week - x.week || x.name.localeCompare(y.name));
  return {
    computedAt: new Date(now).toISOString(),
    historyStart: Number.isFinite(oldest) ? new Date(oldest).toISOString() : null,
    historyDays: Math.round(historyDays * 10) / 10,
    baselineWeeks: Math.max(0, baselineWeeks),
    flagsActive,
    items: items.slice(0, P.maxItems),
  };
}
