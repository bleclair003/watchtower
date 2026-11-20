import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { WATCH_REGIONS, regionsForPoint } from '../../shared/domain/regions.ts';
import { getSource } from '../../shared/domain/sources.ts';
import { contentHash } from '../lib/hash.ts';
import { readSecret } from '../lib/secrets.ts';
import { LIMITS, truncate } from '../lib/text.ts';
import type { AdapterContext, AdapterResult, SourceAdapter } from './types.ts';

const SOURCE_ID = 'nasa-firms';
export const FIRMS_KEY_ENV = 'FIRMS_MAP_KEY';
/** VIIRS on NOAA-20: 375 m pixels, near-real-time (~3 h after overpass). */
export const FIRMS_PRODUCT = 'VIIRS_NOAA20_NRT';
/** Grid used to group detections: 0.25° (~25 km). */
export const CELL_DEG = 0.25;
/** A cell is reported when it has this many usable detections on one day ... */
export const MIN_DETECTIONS = 3;
/** ... and had no usable detections on any of the previous NOVELTY_DAYS days. */
export const NOVELTY_DAYS = 7;
const DAY_RANGE = 5;

export interface FirmsState {
  /** cell id → acquisition dates (YYYY-MM-DD) with usable detections, newest first, ≤ 14 kept. */
  cellDays: Record<string, string[]>;
  firstRunAt: string;
}

export interface Detection {
  lat: number;
  lon: number;
  date: string;
  time: string;
  confidence: string;
  frp: number;
  daynight: string;
}

/** Parses the FIRMS VIIRS area CSV by header name; unknown layouts fail loudly instead of being guessed. */
export function parseFirmsCsv(csv: string): Detection[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length === 0 || !lines[0].includes('latitude')) {
    throw new Error(`FIRMS: unexpected response (${truncate(lines[0] ?? '', 80)})`);
  }
  const head = lines[0].split(',').map((h) => h.trim());
  const col = (n: string) => {
    const i = head.indexOf(n);
    if (i < 0) throw new Error(`FIRMS: column "${n}" missing`);
    return i;
  };
  const [iLat, iLon, iDate, iTime, iConf, iFrp, iDn] = ['latitude', 'longitude', 'acq_date', 'acq_time', 'confidence', 'frp', 'daynight'].map(col);
  const out: Detection[] = [];
  for (const line of lines.slice(1)) {
    const c = line.split(',');
    const lat = Number(c[iLat]);
    const lon = Number(c[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c[iDate] ?? '')) continue;
    out.push({ lat, lon, date: c[iDate], time: (c[iTime] ?? '').padStart(4, '0'), confidence: (c[iConf] ?? '').trim().toLowerCase(), frp: Number(c[iFrp]) || 0, daynight: c[iDn] ?? '' });
  }
  return out;
}

export const cellId = (lat: number, lon: number) => `${Math.floor(lat / CELL_DEG)}:${Math.floor(lon / CELL_DEG)}`;
const daysBefore = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

/**
 * NASA FIRMS active-fire detections inside the geographic watch areas.
 *
 * Raw fire pixels are mostly agriculture, wildfire and gas flares, so WATCHTOWER does not
 * import pixels. It groups usable detections (VIIRS confidence nominal or high) into
 * 0.25° cells per day and reports a cell only when it shows ≥ MIN_DETECTIONS detections
 * after NOVELTY_DAYS days with none. That removes persistent sources such as gas flares
 * and continuing fires. The record's point is the strongest real detection in the cell.
 *
 * A thermal anomaly is not evidence of an attack: it can be a field burn, a wildfire or an
 * industrial fire. The record says so.
 */
export const firms: SourceAdapter<FirmsState> = {
  sourceId: SOURCE_ID,
  requiredEnv: [FIRMS_KEY_ENV],
  async collect(ctx: AdapterContext<FirmsState>): Promise<AdapterResult<FirmsState>> {
    const key = readSecret(FIRMS_KEY_ENV);
    if (!key) throw new Error(`${FIRMS_KEY_ENV} is not set`);
    const def = getSource(SOURCE_ID)!;
    const nowIso = new Date(ctx.now).toISOString();
    const firstRun = !ctx.state;

    const detections: Detection[] = [];
    for (const r of WATCH_REGIONS) {
      if (!r.bbox) continue;
      const res = await ctx.fetch(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${FIRMS_PRODUCT}/${r.bbox.join(',')}/${firstRun ? DAY_RANGE : 2}`);
      if (res.kind === 'not-modified') continue;
      detections.push(...parseFirmsCsv(res.body));
    }

    const usable = detections.filter((d) => d.confidence === 'n' || d.confidence === 'h' || d.confidence === 'nominal' || d.confidence === 'high');
    // Watch boxes overlap (Middle East / Red Sea), so the same pixel can arrive twice.
    const uniq = new Map(usable.map((d) => [`${d.lat},${d.lon},${d.date},${d.time}`, d]));
    const byCellDay = new Map<string, Detection[]>();
    for (const d of uniq.values()) {
      const k = `${cellId(d.lat, d.lon)}|${d.date}`;
      byCellDay.set(k, [...(byCellDay.get(k) ?? []), d]);
    }

    const cellDays: Record<string, Set<string>> = {};
    for (const [cell, days] of Object.entries(ctx.state?.cellDays ?? {})) cellDays[cell] = new Set(days);
    for (const k of byCellDay.keys()) {
      const [cell, date] = k.split('|');
      (cellDays[cell] ??= new Set()).add(date);
    }

    const events: IntelligenceEvent[] = [];
    const dates = [...new Set([...byCellDay.keys()].map((k) => k.split('|')[1]))].sort();
    // History needs NOVELTY_DAYS of look-back; the first run can only judge its newest day.
    const reportable = firstRun ? dates.slice(-1) : dates;
    for (const [k, ds] of byCellDay) {
      const [cell, date] = k.split('|');
      if (!reportable.includes(date) || ds.length < MIN_DETECTIONS) continue;
      const prior = [...(cellDays[cell] ?? [])].filter((d) => d < date && d >= daysBefore(date, NOVELTY_DAYS));
      if (prior.length) continue;
      if (firstRun && dates.length < 2) continue; // no history at all: cannot judge novelty

      const top = ds.reduce((a, b) => (b.frp > a.frp ? b : a));
      const frpSum = Math.round(ds.reduce((s, d) => s + d.frp, 0));
      const regionIds = regionsForPoint(top.lat, top.lon);
      const occurredAt = `${date}T${top.time.slice(0, 2)}:${top.time.slice(2, 4)}:00.000Z`;
      const id = contentHash(SOURCE_ID, cell, date);
      events.push({
        id,
        contentHash: id,
        dataOrigin: 'live',
        sourceId: SOURCE_ID,
        sourceName: `NASA FIRMS — ${def.name}`,
        sourceClass: 'scientific',
        sourceUrl: `https://firms.modaps.eosdis.nasa.gov/map/#d:${date};@${top.lon.toFixed(3)},${top.lat.toFixed(3)},11.0z`,
        title: truncate(`New thermal-anomaly cluster: ${ds.length} satellite fire detections (${regionIds.map((r) => WATCH_REGIONS.find((w) => w.id === r)?.shortCode ?? r).join('/') || 'watch area'})`, LIMITS.title),
        summary: truncate(
          `${ds.length} VIIRS (NOAA-20) detections on ${date} in a ~25 km cell with none in the previous ${NOVELTY_DAYS} days; total fire radiative power ${frpSum} MW. ` +
            'A thermal anomaly can be a field burn, wildfire, industrial fire or a fire from military action; the satellite cannot tell which.',
          LIMITS.summary,
        ),
        category: 'disaster',
        regionIds,
        countryCodes: [],
        publishedAt: occurredAt,
        occurredAt,
        collectedAt: nowIso,
        credibility: 'official',
        verificationStatus: 'unreviewed',
        latitude: top.lat,
        longitude: top.lon,
        locationPrecision: 'exact',
        metadata: {
          subtype: 'thermal-anomaly-cluster',
          detections: ds.length,
          frpTotalMw: frpSum,
          cell,
          product: FIRMS_PRODUCT,
          dayNight: [...new Set(ds.map((d) => d.daynight))].join('/'),
          geoBasis: 'source-coordinates',
          pointBasis: 'strongest detection in the cell',
        },
      });
    }

    const cutoff = daysBefore(nowIso.slice(0, 10), 14);
    const kept: Record<string, string[]> = {};
    for (const [cell, days] of Object.entries(cellDays)) {
      const recent = [...days].filter((d) => d >= cutoff).sort().reverse();
      if (recent.length) kept[cell] = recent;
    }
    return { events, rejected: [], itemsSeen: detections.length, notModified: false, state: { cellDays: kept, firstRunAt: ctx.state?.firstRunAt ?? nowIso } };
  },
};
