import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { WATCH_REGIONS } from '../../shared/domain/regions.ts';
import {
  CHOKEPOINTS,
  CHOKEPOINT_STATUS_LABEL,
  assessChokepoint,
  type ChokepointReading,
  type ChokepointSnapshot,
  type ChokepointStatus,
  type DailyTransit,
} from '../../shared/domain/chokepoints.ts';
import { contentHash } from '../lib/hash.ts';
import { LIMITS, truncate } from '../lib/text.ts';
import type { AdapterContext, AdapterResult, SourceAdapter } from './types.ts';

export const PORTWATCH_SOURCE_ID = 'imf-portwatch-chokepoints';
const BASE = 'https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services';
export const PORTWATCH_DAILY = `${BASE}/Daily_Chokepoints_Data/FeatureServer/0/query`;
export const PORTWATCH_POINTS = `${BASE}/PortWatch_chokepoints_database/FeatureServer/0/query`;
/** One small query a day: the data is daily and runs several days behind. */
export const PORTWATCH_FETCH_HOURS = 20;
const KEEP_DAYS = 120;
const REF_REFRESH_DAYS = 30;
export const PORTWATCH_PAGE = 'https://portwatch.imf.org/pages/chokepoints';

export interface PortwatchState {
  series: Record<string, DailyTransit[]>;
  ref2025: Record<string, { total: number; tanker: number }>;
  points: Record<string, { lat: number; lon: number }>;
  refFetchedAt: string | null;
  lastFetchedAt: string;
  lastStatus: Record<string, ChokepointStatus>;
  latest: ChokepointSnapshot | null;
}

const ids = () => CHOKEPOINTS.map((c) => `'${c.portId}'`).join(',');
const q = (base: string, params: Record<string, string>) => `${base}?${new URLSearchParams({ ...params, f: 'json' }).toString()}`;
const day = (iso: string, deltaDays: number) => new Date(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + deltaDays * 86_400_000).toISOString().slice(0, 10);

interface ArcgisResponse {
  features?: { attributes: Record<string, unknown> }[];
  error?: { message?: string };
}
function features(body: string): Record<string, unknown>[] {
  const d = JSON.parse(body) as ArcgisResponse;
  if (d.error) throw new Error(`PortWatch: ${d.error.message ?? 'query error'}`);
  if (!Array.isArray(d.features)) throw new Error('PortWatch: response has no features');
  return d.features.map((f) => f.attributes);
}

/** ISO week label of a date, e.g. 2026-W46. */
export function isoWeek(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThu.getTime()) / 86_400_000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const pct = (a: number, b: number) => `${a >= b ? '+' : '−'}${Math.abs(Math.round((a / b - 1) * 100))}%`;

/**
 * Records: one per disrupted chokepoint per ISO week (so a lasting disruption keeps its
 * indicator active), plus one when a chokepoint returns to normal.
 */
export function chokepointEvents(items: ChokepointReading[], lastStatus: Record<string, ChokepointStatus>, nowIso: string): IntelligenceEvent[] {
  const events: IntelligenceEvent[] = [];
  for (const c of items) {
    if (c.status === 'insufficient-data' || !c.latestDate || c.mean7 === null || !c.ref2025) continue;
    const before = lastStatus[c.id];
    const recovered = c.status === 'normal' && before && before !== 'normal' && before !== 'insufficient-data';
    if (c.status === 'normal' && !recovered) continue;
    const m7 = c.mean7.toFixed(1);
    const ref = c.ref2025.total.toFixed(1);
    const window = `7 days to ${c.latestDate}`;
    let headline: string;
    if (c.status === 'sudden-drop' && c.meanPrior28) headline = `ship transits down ${pct(c.mean7, c.meanPrior28).slice(1)} on the previous 4 weeks — ${m7} a day (${window}) vs ${c.meanPrior28.toFixed(1)}`;
    else if (recovered) headline = `ship transits back to normal — ${m7} a day (${window}) vs ${ref} in 2025`;
    else headline = `ship transits ${CHOKEPOINT_STATUS_LABEL[c.status].toLowerCase()} — ${m7} a day (${window}) vs ${ref} in 2025 (${pct(c.mean7, c.ref2025.total)})`;
    const region = c.regionId ? WATCH_REGIONS.find((r) => r.id === c.regionId) : undefined;
    const tankers7 = c.series.slice(-7).reduce((a, d) => a + d[2], 0) / 7;
    const id = contentHash(PORTWATCH_SOURCE_ID, c.id, recovered ? 'normal' : c.status, isoWeek(c.latestDate));
    const at = `${c.latestDate}T00:00:00.000Z`;
    events.push({
      id,
      contentHash: id,
      dataOrigin: 'live',
      sourceId: PORTWATCH_SOURCE_ID,
      sourceName: 'IMF PortWatch — Daily chokepoint transits',
      sourceClass: 'scientific',
      sourceUrl: PORTWATCH_PAGE,
      title: truncate(`${c.name}${region ? ` (${region.shortCode})` : ''}: ${headline}`, LIMITS.title),
      summary: truncate(
        `IMF PortWatch counted an average of ${m7} ship transits a day through the ${c.name} over the ${window}, ${tankers7.toFixed(1)} of them tankers. ` +
          `The 2025 daily average was ${ref} (${c.ref2025.tanker.toFixed(1)} tankers)` +
          `${c.meanPrior28 ? `, and the previous four weeks averaged ${c.meanPrior28.toFixed(1)}` : ''}. ` +
          'Counts come from satellite and terrestrial AIS (UN Global Platform) and run several days behind; ships that switch off AIS are not counted. Source: International Monetary Fund, PortWatch.',
        LIMITS.summary,
      ),
      category: 'maritime',
      regionIds: c.regionId ? [c.regionId] : [],
      countryCodes: [],
      publishedAt: at,
      occurredAt: at,
      collectedAt: nowIso,
      credibility: 'official',
      verificationStatus: 'unreviewed',
      latitude: c.lat,
      longitude: c.lon,
      locationPrecision: 'exact',
      metadata: {
        subtype: 'chokepoint-transits',
        chokepoint: c.id,
        status: recovered ? 'normal' : c.status,
        change: recovered ? 'recovered' : before && before !== c.status ? 'changed' : 'continuing',
        mean7: Math.round(c.mean7 * 10) / 10,
        meanPrior28: c.meanPrior28 === null ? null : Math.round(c.meanPrior28 * 10) / 10,
        ref2025: Math.round(c.ref2025.total * 10) / 10,
        latestDate: c.latestDate,
        geoBasis: 'PortWatch chokepoint point',
      },
    });
  }
  return events;
}

/**
 * IMF PortWatch daily chokepoint transits for six chokepoints. One small query a day (plus,
 * monthly, the 2025 averages and the chokepoint points). The owner chose to use it without
 * asking the IMF for permission for automated access (see the source registry).
 */
export const portwatchChokepoints: SourceAdapter<PortwatchState> = {
  sourceId: PORTWATCH_SOURCE_ID,
  async collect(ctx: AdapterContext<PortwatchState>): Promise<AdapterResult<PortwatchState>> {
    const prev = ctx.state;
    const nowIso = new Date(ctx.now).toISOString();
    if (prev && ctx.now - Date.parse(prev.lastFetchedAt) < PORTWATCH_FETCH_HOURS * 3_600_000) {
      return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: prev };
    }
    const state: PortwatchState = prev ?? { series: {}, ref2025: {}, points: {}, refFetchedAt: null, lastFetchedAt: nowIso, lastStatus: {}, latest: null };

    // Monthly: 2025 averages and chokepoint points.
    if (!state.refFetchedAt || ctx.now - Date.parse(state.refFetchedAt) > REF_REFRESH_DAYS * 86_400_000) {
      const stats = JSON.stringify([
        { statisticType: 'avg', onStatisticField: 'n_total', outStatisticFieldName: 'avg_total' },
        { statisticType: 'avg', onStatisticField: 'n_tanker', outStatisticFieldName: 'avg_tanker' },
      ]);
      const ref = await ctx.fetch(q(PORTWATCH_DAILY, { where: `portid IN (${ids()}) AND year = 2025`, outStatistics: stats, groupByFieldsForStatistics: 'portid' }));
      if (ref.kind === 'ok') {
        for (const a of features(ref.body)) {
          const c = CHOKEPOINTS.find((x) => x.portId === a.portid);
          if (c && typeof a.avg_total === 'number') state.ref2025[c.id] = { total: a.avg_total, tanker: Number(a.avg_tanker) || 0 };
        }
      }
      const pts = await ctx.fetch(q(PORTWATCH_POINTS, { where: `portid IN (${ids()})`, outFields: 'portid,lat,lon', returnGeometry: 'false' }));
      if (pts.kind === 'ok') {
        for (const a of features(pts.body)) {
          const c = CHOKEPOINTS.find((x) => x.portId === a.portid);
          if (c && typeof a.lat === 'number' && typeof a.lon === 'number') state.points[c.id] = { lat: a.lat, lon: a.lon };
        }
      }
      state.refFetchedAt = nowIso;
    }

    // Daily counts: everything since a few days before the newest stored day (PortWatch revises recent days).
    const newest = Object.values(state.series).flatMap((s) => s.map((d) => d[0])).sort().pop();
    const since = newest ? day(newest, -3) : day(nowIso, -KEEP_DAYS);
    const res = await ctx.fetch(
      q(PORTWATCH_DAILY, { where: `portid IN (${ids()}) AND date >= DATE '${since}'`, outFields: 'date,portid,n_total,n_tanker', orderByFields: 'date', resultRecordCount: '2000' }),
    );
    let rows = 0;
    if (res.kind === 'ok') {
      for (const a of features(res.body)) {
        const c = CHOKEPOINTS.find((x) => x.portId === a.portid);
        const date = typeof a.date === 'string' ? a.date.slice(0, 10) : typeof a.date === 'number' ? new Date(a.date).toISOString().slice(0, 10) : null;
        if (!c || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || typeof a.n_total !== 'number') continue;
        const s = (state.series[c.id] ??= []).filter((d) => d[0] !== date);
        s.push([date, a.n_total, Number(a.n_tanker) || 0]);
        state.series[c.id] = s.sort((x, y) => x[0].localeCompare(y[0])).slice(-KEEP_DAYS);
        rows++;
      }
    }

    const items: ChokepointReading[] = CHOKEPOINTS.flatMap((c) => {
      const pt = state.points[c.id];
      if (!pt) return [];
      const series = state.series[c.id] ?? [];
      const ref2025 = state.ref2025[c.id] ?? null;
      return [{ id: c.id, name: c.name, regionId: c.regionId, lat: pt.lat, lon: pt.lon, ref2025, series: series.slice(-90), ...assessChokepoint(series, ref2025) }];
    });
    const events = chokepointEvents(items, state.lastStatus, nowIso);
    const latestDate = items.map((i) => i.latestDate).filter((d): d is string => !!d).sort().pop() ?? null;
    return {
      events,
      rejected: [],
      itemsSeen: rows,
      notModified: false,
      state: {
        ...state,
        lastFetchedAt: nowIso,
        lastStatus: Object.fromEntries(items.map((i) => [i.id, i.status])),
        latest: { fetchedAt: nowIso, latestDate, items },
      },
    };
  },
};
