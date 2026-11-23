import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { getRegion, regionsForPoint } from '../../shared/domain/regions.ts';
import {
  GNSS_CIRCLES,
  GNSS_HIGH_MIN_DEGRADED,
  GNSS_MIN_SIGHTINGS,
  GNSS_RADIUS_NM,
  GNSS_RECENT_HOURS,
  GNSS_SOURCE_ID,
  GNSS_WINDOW_HOURS,
  cellCentre,
  cellKey,
  gnssLevel,
  readAircraft,
  type GnssCell,
  type GnssCircle,
  type GnssLostPoint,
  type GnssSnapshot,
  type RawGnssAircraft,
} from '../../shared/domain/gnss.ts';
import { contentHash } from '../lib/hash.ts';
import { LIMITS, truncate } from '../lib/text.ts';
import type { AdapterContext, AdapterResult, SourceAdapter } from './types.ts';

/**
 * GPS interference (v0.69.0): once an hour, ten 250 nm circle queries on adsb.lol (adsb.fi for a circle
 * when adsb.lol fails). Per 1° square and hour it keeps sightings, degraded and lost counts for 48 hours;
 * the map shows the last 24. A region gets a record when a square there is high in one hourly sample of
 * the last 6 hours (10%+ degraded, at least 5 degraded sightings) and was not high over the 24 hours
 * before them, at most once a day, after a day of history.
 */
export { GNSS_SOURCE_ID };

export const GNSS_ENDPOINTS = [
  { provider: 'adsb.lol', url: (c: GnssCircle) => `https://api.adsb.lol/v2/point/${c.lat}/${c.lon}/${GNSS_RADIUS_NM}` },
  { provider: 'adsb.fi', url: (c: GnssCircle) => `https://opendata.adsb.fi/api/v2/lat/${c.lat}/lon/${c.lon}/dist/${GNSS_RADIUS_NM}` },
] as const;
/** Sample at most this often (runs are more frequent; each sample costs ten requests). */
export const GNSS_EVERY_MS = 55 * 60_000;
const HOUR = 3_600_000;
const KEEP_HOURS = 48;
const MAX_LOST = 400;

export interface GnssState {
  latest: GnssSnapshot;
  /** cellKey → "hour:n,bad,lost;…" where hour = epoch hours; the last 48 hours. */
  hours: Record<string, string>;
  lost: (GnssLostPoint & { hex: string })[];
  since: string;
  lastSampleAt: string;
  /** regionId → UTC day (YYYY-MM-DD) of its last record. */
  recorded: Record<string, string>;
}

type Bucket = { h: number; n: number; bad: number; lost: number };
export const unpackHours = (s: string): Bucket[] =>
  s
    ? s.split(';').map((p) => {
        const [h, rest] = p.split(':');
        const [n, bad, lost] = rest.split(',').map(Number);
        return { h: Number(h), n, bad, lost };
      })
    : [];
const packHours = (b: Bucket[]) => b.map((x) => `${x.h}:${x.n},${x.bad},${x.lost}`).join(';');

/** Sums the buckets of each square from hour `from` (inclusive) to `to` (exclusive). */
export function windowCells(hours: Record<string, string>, from: number, to: number): Map<string, { n: number; bad: number; lost: number }> {
  const out = new Map<string, { n: number; bad: number; lost: number }>();
  for (const [k, packed] of Object.entries(hours)) {
    const sum = { n: 0, bad: 0, lost: 0 };
    for (const b of unpackHours(packed)) if (b.h >= from && b.h < to) {
      sum.n += b.n;
      sum.bad += b.bad;
      sum.lost += b.lost;
    }
    if (sum.n) out.set(k, sum);
  }
  return out;
}

const isHigh = (c: { n: number; bad: number } | undefined) => !!c && c.n >= GNSS_MIN_SIGHTINGS && c.bad >= GNSS_HIGH_MIN_DEGRADED && gnssLevel(c.bad, c.n) === 'high';

export function gnssRecord(regionId: string, cells: { k: string; n: number; bad: number; lost: number }[], nowIso: string): IntelligenceEvent {
  const region = getRegion(regionId);
  const name = region?.name ?? regionId;
  const n = cells.reduce((a, c) => a + c.n, 0);
  const bad = cells.reduce((a, c) => a + c.bad, 0);
  const lost = cells.reduce((a, c) => a + c.lost, 0);
  const [la, lo] = cellCentre(cells[0].k);
  const squares = cells.map((c) => {
    const [cla, clo] = cellCentre(c.k);
    return `${Math.abs(cla).toFixed(1)}°${cla >= 0 ? 'N' : 'S'} ${Math.abs(clo).toFixed(1)}°${clo >= 0 ? 'E' : 'W'} (${c.bad}/${c.n})`;
  });
  const id = contentHash(GNSS_SOURCE_ID, regionId, nowIso.slice(0, 10));
  return {
    id,
    contentHash: id,
    dataOrigin: 'live',
    sourceId: GNSS_SOURCE_ID,
    sourceName: 'adsb.lol — aircraft GPS accuracy',
    sourceClass: 'aggregator',
    sourceUrl: `https://adsb.lol/?lat=${la.toFixed(2)}&lon=${lo.toFixed(2)}&zoom=7`,
    title: truncate(`GPS interference: degraded aircraft positions over ${name} (${cells.length} area${cells.length === 1 ? '' : 's'} at 10%+)`, LIMITS.title),
    summary: truncate(
      `In the worst hourly sample of the last ${GNSS_RECENT_HOURS} hours, ${bad} of ${n} aircraft sightings in ${cells.length} 1° square${cells.length === 1 ? '' : 's'} over ${name} reported degraded GPS accuracy (NACp below 8)` +
        `${lost ? `, ${lost} of them flagged as having lost GPS that worked before` : ''}; these squares were not high in the ${GNSS_WINDOW_HOURS} hours before. Squares: ${squares.join('; ')}. ` +
        'Interference (jamming or spoofing) is the usual cause when many aircraft in one area report it at once; it does not say who is responsible. Hourly samples of fixed circles; data: adsb.lol (ODbL).',
      LIMITS.summary,
    ),
    category: 'aviation',
    regionIds: [regionId],
    countryCodes: [],
    publishedAt: nowIso,
    occurredAt: nowIso,
    collectedAt: nowIso,
    credibility: 'single-source',
    verificationStatus: 'unreviewed',
    locationPrecision: 'region',
    metadata: { subtype: 'gnss-interference', squares: cells.length, degraded: bad, sightings: n, lost, geoBasis: 'adsb-position' },
  };
}

const sleepDefault = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function collectGnss(ctx: AdapterContext<GnssState>, opts: { sleep?: (ms: number) => Promise<void> } = {}): Promise<AdapterResult<GnssState>> {
  const sleep = opts.sleep ?? sleepDefault;
  const prev = ctx.state;
  if (prev && ctx.now - Date.parse(prev.lastSampleAt) < GNSS_EVERY_MS) {
    return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: prev };
  }
  const nowIso = new Date(ctx.now).toISOString();
  const hourNow = Math.floor(ctx.now / HOUR);

  // Sample every circle; an aircraft in two overlapping circles counts once.
  const seen = new Map<string, { r: NonNullable<ReturnType<typeof readAircraft>>; raw: RawGnssAircraft }>();
  const failed: string[] = [];
  const providers = new Set<string>();
  let parsed = 0;
  for (const [i, circle] of GNSS_CIRCLES.entries()) {
    if (i > 0) await sleep(1100);
    let body: string | null = null;
    for (const ep of GNSS_ENDPOINTS) {
      try {
        const res = await ctx.fetch(ep.url(circle));
        if (res.kind === 'ok') {
          body = res.body;
          providers.add(ep.provider);
          break;
        }
      } catch {
        // try the next provider
      }
    }
    let ac: RawGnssAircraft[] | null = null;
    try {
      const data = body ? (JSON.parse(body) as { ac?: unknown }) : null;
      ac = data && Array.isArray(data.ac) ? (data.ac as RawGnssAircraft[]) : null;
    } catch {
      ac = null;
    }
    if (!ac) {
      failed.push(circle.id);
      continue;
    }
    parsed += ac.length;
    for (const a of ac) {
      const r = readAircraft(a);
      if (r && a.hex) seen.set(a.hex, { r, raw: a });
    }
  }
  if (failed.length === GNSS_CIRCLES.length) throw new Error('No circle could be sampled from adsb.lol or adsb.fi');

  // This hour's bucket per square (a second sample in the same hour replaces the first).
  const thisHour = new Map<string, Bucket>();
  for (const { r } of seen.values()) {
    const k = cellKey(r.lat, r.lon);
    const b = thisHour.get(k) ?? { h: hourNow, n: 0, bad: 0, lost: 0 };
    b.n++;
    if (r.status !== 'ok') b.bad++;
    if (r.status === 'lost') b.lost++;
    thisHour.set(k, b);
  }
  const hours: Record<string, string> = {};
  const keys = new Set([...Object.keys(prev?.hours ?? {}), ...thisHour.keys()]);
  for (const k of keys) {
    const kept = unpackHours(prev?.hours[k] ?? '').filter((b) => b.h > hourNow - KEEP_HOURS && b.h !== hourNow);
    const add = thisHour.get(k);
    const all = add ? [...kept, add] : kept;
    if (all.length) hours[k] = packHours(all);
  }

  // Where GPS was lost: last good positions, newest per aircraft, last 24 hours.
  const lostNow = [...seen.entries()]
    .filter(([, v]) => v.r.status === 'lost' && typeof v.raw.gpsOkLat === 'number' && typeof v.raw.gpsOkLon === 'number' && typeof v.raw.gpsOkBefore === 'number')
    .map(([hex, v]) => ({
      hex,
      la: Number(v.raw.gpsOkLat!.toFixed(3)),
      lo: Number(v.raw.gpsOkLon!.toFixed(3)),
      at: new Date(v.raw.gpsOkBefore! * 1000).toISOString(),
      nowLa: Number(v.r.lat.toFixed(3)),
      nowLo: Number(v.r.lon.toFixed(3)),
      cs: v.raw.flight?.trim() || null,
    }))
    .filter((p) => Math.abs(p.la) <= 90 && Math.abs(p.lo) <= 180);
  const lostHexNow = new Set(lostNow.map((p) => p.hex));
  const lost = [...lostNow, ...(prev?.lost ?? []).filter((p) => !lostHexNow.has(p.hex))]
    .filter((p) => ctx.now - Date.parse(p.at) <= GNSS_WINDOW_HOURS * HOUR)
    .slice(0, MAX_LOST);

  const current = windowCells(hours, hourNow - GNSS_WINDOW_HOURS + 1, hourNow + 1);
  // Per square, the worst single hourly sample of the last 6 hours (so a new episode is not diluted).
  const recent = new Map<string, { n: number; bad: number; lost: number }>();
  for (const [k, packed] of Object.entries(hours)) {
    for (const b of unpackHours(packed)) {
      if (b.h <= hourNow - GNSS_RECENT_HOURS || b.h > hourNow || b.n < GNSS_MIN_SIGHTINGS) continue;
      const cur = recent.get(k);
      if (!cur || b.bad / b.n > cur.bad / cur.n) recent.set(k, { n: b.n, bad: b.bad, lost: b.lost });
    }
  }
  const before = windowCells(hours, hourNow - GNSS_RECENT_HOURS - GNSS_WINDOW_HOURS + 1, hourNow - GNSS_RECENT_HOURS + 1);
  const cells: GnssCell[] = [...current.entries()]
    .filter(([, c]) => c.n >= GNSS_MIN_SIGHTINGS)
    .map(([k, c]) => {
      const [la, lo] = cellCentre(k);
      return { k, ...c, level: gnssLevel(c.bad, c.n), regionIds: regionsForPoint(la, lo).filter((r) => r !== 'united-states') };
    })
    .sort((a, b) => b.bad / b.n - a.bad / a.n);

  const since = prev?.since ?? nowIso;
  const recorded = { ...(prev?.recorded ?? {}) };
  const events: IntelligenceEvent[] = [];
  const day = nowIso.slice(0, 10);
  // After a full day of history: a square high in an hourly sample of the last 6 hours that was not high
  // over the 24 hours before them is recorded, per region.
  if (ctx.now - Date.parse(since) >= GNSS_WINDOW_HOURS * HOUR) {
    const byRegion = new Map<string, { k: string; n: number; bad: number; lost: number }[]>();
    for (const [k, c] of recent) {
      if (!isHigh(c) || isHigh(before.get(k))) continue;
      const [la, lo] = cellCentre(k);
      for (const r of regionsForPoint(la, lo).filter((x) => x !== 'united-states')) byRegion.set(r, [...(byRegion.get(r) ?? []), { k, ...c }]);
    }
    for (const [regionId, list] of byRegion) {
      if (recorded[regionId] === day) continue;
      events.push(gnssRecord(regionId, list, nowIso));
      recorded[regionId] = day;
    }
  }

  const all = [...current.values()];
  const latest: GnssSnapshot = {
    fetchedAt: nowIso,
    windowHours: GNSS_WINDOW_HOURS,
    provider: [...providers].join(' + ') || 'none',
    circles: GNSS_CIRCLES,
    failed,
    cells,
    lost: lost.map(({ hex: _hex, ...p }) => p),
    sightings: all.reduce((a, c) => a + c.n, 0),
    degraded: all.reduce((a, c) => a + c.bad, 0),
    since,
  };
  return { events, rejected: [], itemsSeen: parsed, notModified: false, state: { latest, hours, lost, since, lastSampleAt: nowIso, recorded } };
}

export const gnssInterference: SourceAdapter<GnssState> = {
  sourceId: GNSS_SOURCE_ID,
  collect: (ctx) => collectGnss(ctx),
};
