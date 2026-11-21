import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { SPACE_WX_PAGE, gFromKp, isNotableMessage, parseSwpcMessage, type CmeArrival, type ScaleDay, type SpaceWeatherSnapshot, type SwpcMessage } from '../../shared/domain/spaceWeather.ts';
import { contentHash } from '../lib/hash.ts';
import { readSecret } from '../lib/secrets.ts';
import { LIMITS, truncate } from '../lib/text.ts';
import type { AdapterContext, AdapterResult, SourceAdapter } from './types.ts';

const H = 3_600_000;
const DAY = 24 * H;
const iso = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : null);
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const fmt = (t: string) => `${t.slice(8, 10)}/${t.slice(5, 7)} ${t.slice(11, 16)} UTC`;

function record(sourceId: string, sourceName: string, id: string, title: string, summary: string, url: string, at: string, nowIso: string, metadata: Record<string, unknown>): IntelligenceEvent {
  return {
    id,
    contentHash: id,
    dataOrigin: 'live',
    sourceId,
    sourceName,
    sourceClass: 'scientific',
    sourceUrl: url,
    title: truncate(title, LIMITS.title),
    summary: truncate(summary, LIMITS.summary),
    category: 'disaster',
    regionIds: [],
    countryCodes: [],
    publishedAt: at,
    occurredAt: at,
    collectedAt: nowIso,
    credibility: 'official',
    verificationStatus: 'unreviewed',
    locationPrecision: 'none',
    metadata: { subtype: 'space-weather', geoBasis: 'none', ...metadata },
  };
}

// ---------------------------------------------------------------- NASA DONKI

export const DONKI_SOURCE_ID = 'nasa-donki';
/** api.nasa.gov is part of api.data.gov: the same key as Congress.gov and EIA (sent as a header, never in a URL). */
export const DONKI_KEY_ENV = 'CONGRESS_API_KEY';
export const DONKI_EVERY_HOURS = 2;
const DONKI = 'https://api.nasa.gov/DONKI';

export interface DonkiState {
  lastFetchedAt: string;
  arrivals: CmeArrival[];
  cmes7d: number;
  fastest7d: number | null;
  storms: { start: string; maxKp: number; url: string }[];
}

type Obj = Record<string, unknown>;

/** Latest model run per CME with a predicted Earth arrival (from 12 hours ago on), with the CME's measured speed. */
export function earthArrivals(sims: Obj[], analyses: Obj[], now: number): CmeArrival[] {
  const speed = new Map<string, number>();
  for (const a of analyses) if (typeof a.associatedCMEID === 'string' && num(a.speed)) speed.set(a.associatedCMEID, num(a.speed)!);
  const best = new Map<string, CmeArrival>();
  for (const s of sims) {
    const arrival = iso(s.estimatedShockArrivalTime);
    if (!arrival || Date.parse(arrival) < now - 12 * H) continue;
    const input = (Array.isArray(s.cmeInputs) ? (s.cmeInputs as Obj[]) : []).find((c) => typeof c.CMEID === 'string') ?? (Array.isArray(s.cmeInputs) ? (s.cmeInputs as Obj[])[0] : undefined);
    const cmeId = typeof input?.CMEID === 'string' ? input.CMEID : String(s.simulationID ?? '');
    if (!cmeId) continue;
    const kps = [num(s.kp_90), num(s.kp_180)].filter((k): k is number => k !== null);
    const a: CmeArrival = {
      cmeId,
      start: iso(input?.cmeStartTime),
      speed: speed.get(cmeId) ?? num(input?.speed),
      arrival,
      glancing: s.isEarthGB === true,
      kpLow: kps.length ? Math.min(...kps) : null,
      kpHigh: kps.length ? Math.max(...kps) : null,
      modelRunAt: iso(s.modelCompletionTime),
      url: typeof s.link === 'string' ? s.link : 'https://kauai.ccmc.gsfc.nasa.gov/DONKI/',
    };
    const prev = best.get(cmeId);
    if (!prev || (a.modelRunAt ?? '') > (prev.modelRunAt ?? '')) best.set(cmeId, a);
  }
  return [...best.values()].sort((x, y) => x.arrival.localeCompare(y.arrival));
}

/** Records: one per CME per predicted arrival (a revised arrival 6+ hours away is a new record). */
export function arrivalRecords(arrivals: CmeArrival[], nowIso: string): IntelligenceEvent[] {
  return arrivals.map((a) => {
    const id = contentHash(DONKI_SOURCE_ID, a.cmeId, String(Math.floor(Date.parse(a.arrival) / (6 * H))));
    const kp = a.kpLow !== null ? (a.kpHigh !== a.kpLow ? `Kp ${a.kpLow}–${a.kpHigh}` : `Kp ${a.kpLow}`) : null;
    return record(
      DONKI_SOURCE_ID,
      'NASA DONKI — CME arrival (WSA-Enlil model)',
      id,
      `CME expected to reach Earth ~${fmt(a.arrival)}${a.glancing ? ' (glancing blow)' : ''}${kp ? `, model ${kp}` : ''}`,
      `NASA's WSA-Enlil model run${a.modelRunAt ? ` of ${fmt(a.modelRunAt)}` : ''} predicts the shock of CME ${a.cmeId}${a.speed ? ` (${a.speed} km/s)` : ''} will reach Earth around ${fmt(a.arrival)}${a.glancing ? ' as a glancing blow' : ''}` +
        `${kp ? `, with a geomagnetic Kp of about ${kp.slice(3)} (G${gFromKp(a.kpHigh ?? a.kpLow ?? 0)} at most)` : ''}. Arrival predictions are typically within about ±7 hours.`,
      a.url,
      a.modelRunAt ?? nowIso,
      nowIso,
      { cmeId: a.cmeId, arrival: a.arrival, glancing: a.glancing, kpHigh: a.kpHigh },
    );
  });
}

export const nasaDonki: SourceAdapter<DonkiState> = {
  sourceId: DONKI_SOURCE_ID,
  async collect(ctx: AdapterContext<DonkiState>): Promise<AdapterResult<DonkiState>> {
    if (ctx.state && ctx.now - Date.parse(ctx.state.lastFetchedAt) < DONKI_EVERY_HOURS * H) {
      return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: ctx.state };
    }
    const nowIso = new Date(ctx.now).toISOString();
    const key = readSecret(DONKI_KEY_ENV);
    const start = new Date(ctx.now - 14 * DAY).toISOString().slice(0, 10);
    const end = new Date(ctx.now + DAY).toISOString().slice(0, 10);
    const get = async (path: string, extra = '') => {
      // Without a key NASA's shared DEMO_KEY is used (a low hourly limit per IP address).
      const url = `${DONKI}/${path}?startDate=${start}&endDate=${end}${extra}${key ? '' : '&api_key=DEMO_KEY'}`;
      const res = await ctx.fetch(url, undefined, key ? { 'X-Api-Key': key, Accept: 'application/json' } : { Accept: 'application/json' });
      if (res.kind !== 'ok') throw new Error(`DONKI ${path}: unexpected ${res.status}`);
      const body = res.body.trim() ? (JSON.parse(res.body) as unknown) : [];
      return Array.isArray(body) ? (body as Obj[]) : [];
    };
    const [analyses, sims, gst] = await Promise.all([get('CMEAnalysis', '&mostAccurateOnly=true'), get('WSAEnlilSimulations'), get('GST')]);
    const arrivals = earthArrivals(sims, analyses, ctx.now);
    const week = analyses.filter((a) => Date.parse(String(a.associatedCMEstartTime ?? a.time21_5 ?? '')) >= ctx.now - 7 * DAY);
    const speeds = week.map((a) => num(a.speed)).filter((s): s is number => s !== null);
    const storms = gst
      .map((g) => ({ start: iso(g.startTime) ?? '', maxKp: Math.max(0, ...((g.allKpIndex as Obj[] | undefined) ?? []).map((k) => num(k.kpIndex) ?? 0)), url: typeof g.link === 'string' ? g.link : SPACE_WX_PAGE, id: String(g.gstID ?? '') }))
      .filter((g) => g.start);
    const events = [
      ...arrivalRecords(arrivals, nowIso),
      ...storms.map((g) =>
        record(
          DONKI_SOURCE_ID,
          'NASA DONKI — geomagnetic storm',
          contentHash(DONKI_SOURCE_ID, g.id, String(gFromKp(g.maxKp))),
          `Geomagnetic storm G${gFromKp(g.maxKp)} (Kp ${g.maxKp}) from ${fmt(g.start)}`,
          `NASA DONKI lists a geomagnetic storm starting ${fmt(g.start)} with a maximum planetary K-index of ${g.maxKp} (NOAA scale G${gFromKp(g.maxKp)}). Strong storms can degrade GPS accuracy, HF radio and satellite operations and stress power grids at high latitudes.`,
          g.url,
          g.start,
          nowIso,
          { kp: g.maxKp, gScale: gFromKp(g.maxKp) },
        ),
      ),
    ];
    return {
      events,
      rejected: [],
      itemsSeen: analyses.length + sims.length + gst.length,
      notModified: false,
      state: { lastFetchedAt: nowIso, arrivals, cmes7d: week.length, fastest7d: speeds.length ? Math.max(...speeds) : null, storms: storms.map(({ id: _id, ...g }) => g) },
    };
  },
};

// ---------------------------------------------------------------- NOAA SWPC

export const SWPC_SOURCE_ID = 'noaa-swpc';
const SWPC = 'https://services.swpc.noaa.gov/products';

export interface SwpcState {
  lastFetchedAt: string;
  now: SpaceWeatherSnapshot['now'];
  forecast: ScaleDay[];
  kp: SpaceWeatherSnapshot['kp'];
  messages: SwpcMessage[];
}

export function parseScales(body: Record<string, Obj>): { now: SpaceWeatherSnapshot['now']; forecast: ScaleDay[] } {
  const scale = (o: unknown, k = 'Scale') => num((o as Obj | undefined)?.[k]);
  const cur = body['0'];
  const now = cur ? { r: scale(cur.R) ?? 0, s: scale(cur.S) ?? 0, g: scale(cur.G) ?? 0 } : null;
  const forecast: ScaleDay[] = ['1', '2', '3']
    .map((k) => body[k])
    .filter(Boolean)
    .map((d) => ({ date: String(d.DateStamp ?? ''), rMinor: scale(d.R, 'MinorProb'), rMajor: scale(d.R, 'MajorProb'), s: scale(d.S, 'Prob'), g: scale(d.G) }));
  return { now, forecast };
}

/** Planetary K-index table (first row may be a header): latest value and the 24-hour maximum. */
export function parseKp(rows: unknown[], now: number): SpaceWeatherSnapshot['kp'] {
  const pts = rows
    .map((r) => (Array.isArray(r) ? { t: String(r[0]), kp: Number(r[1]) } : { t: String((r as Obj).time_tag), kp: Number((r as Obj).Kp) }))
    .map((p) => ({ at: iso(`${p.t.replace(' ', 'T')}${/Z$/.test(p.t) ? '' : 'Z'}`), kp: p.kp }))
    .filter((p): p is { at: string; kp: number } => !!p.at && Number.isFinite(p.kp));
  if (!pts.length) return null;
  const last = pts[pts.length - 1];
  const day = pts.filter((p) => Date.parse(p.at) >= now - DAY);
  return { latest: Math.round(last.kp * 100) / 100, at: last.at, max24h: Math.round(Math.max(...day.map((p) => p.kp), last.kp) * 100) / 100 };
}

export const noaaSwpc: SourceAdapter<SwpcState> = {
  sourceId: SWPC_SOURCE_ID,
  async collect(ctx: AdapterContext<SwpcState>): Promise<AdapterResult<SwpcState>> {
    const nowIso = new Date(ctx.now).toISOString();
    const json = async (path: string) => {
      const res = await ctx.fetch(`${SWPC}/${path}`, undefined, { Accept: 'application/json' });
      if (res.kind !== 'ok') throw new Error(`SWPC ${path}: unexpected ${res.status}`);
      return JSON.parse(res.body) as unknown;
    };
    const [scales, alerts, kp] = await Promise.all([json('noaa-scales.json'), json('alerts.json'), json('noaa-planetary-k-index.json')]);
    const { now, forecast } = parseScales(scales as Record<string, Obj>);
    const messages = (Array.isArray(alerts) ? (alerts as Obj[]) : [])
      .map(parseSwpcMessage)
      .filter((m): m is SwpcMessage => !!m && Date.parse(m.issued) >= ctx.now - 72 * H)
      .sort((a, b) => b.issued.localeCompare(a.issued));
    const notable = messages.filter(isNotableMessage);
    const events = notable.map((m) =>
      record(
        SWPC_SOURCE_ID,
        'NOAA Space Weather Prediction Center',
        contentHash(SWPC_SOURCE_ID, m.code, m.serial || m.issued),
        `NOAA space weather: ${m.headline.replace(/^(\w[\w ]*?):\s*/, (_, k: string) => `${k.charAt(0)}${k.slice(1).toLowerCase()}: `)}`,
        `NOAA SWPC message ${m.code}${m.serial ? ` (serial ${m.serial})` : ''}, issued ${fmt(m.issued)}: ${m.headline}.${m.mentionsCme ? ' The message refers to a coronal mass ejection.' : ''}`,
        'https://www.swpc.noaa.gov/products/alerts-watches-and-warnings',
        m.issued,
        nowIso,
        { swpcCode: m.code, scale: m.scale },
      ),
    );
    return {
      events,
      rejected: [],
      itemsSeen: messages.length,
      notModified: false,
      state: { lastFetchedAt: nowIso, now, forecast, kp: parseKp(Array.isArray(kp) ? kp : [], ctx.now), messages: notable.slice(0, 10) },
    };
  },
};
