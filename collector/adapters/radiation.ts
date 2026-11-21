import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import {
  NETWORK_LABEL,
  NETWORK_SOURCE,
  classify,
  clusterStations,
  median,
  packBaselines,
  ratioOf,
  unpackBaselines,
  updateBaseline,
  type FlaggedStation,
  type NetworkSummary,
  type RadCluster,
  type RadNetwork,
  type RadReading,
  type StationBaseline,
} from '../../shared/domain/radiation.ts';
import { contentHash } from '../lib/hash.ts';
import { LIMITS, truncate } from '../lib/text.ts';
import type { AdapterContext, AdapterResult, SourceAdapter } from './types.ts';

export interface RadState {
  lastFetchedAt: string;
  /** Packed StationBaseline per station id (see packBaselines). */
  baselines: string;
  latest: { summary: NetworkSummary; flagged: FlaggedStation[] } | null;
  /** RadNet only: rotation cursor and each monitor's latest reading. */
  cursor?: number;
  last?: Record<string, { value: number; at: string }>;
}

const H = 3_600_000;
const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** Judges each reading against its station's usual level, then folds it into that level. Pure. */
export function evaluateReadings(network: RadNetwork, readings: RadReading[], prev: Record<string, StationBaseline>, nowIso: string): { baselines: Record<string, StationBaseline>; summary: NetworkSummary; flagged: FlaggedStation[] } {
  const baselines = { ...prev };
  const flagged: FlaggedStation[] = [];
  for (const r of readings) {
    const base = prev[r.id];
    const status = classify(r.value, base);
    if (status === 'elevated' || status === 'high') flagged.push({ ...r, network, status, usual: base && base.n > 0 ? base.b : null });
    baselines[r.id] = updateBaseline(base, r);
  }
  flagged.sort((a, b) => (ratioOf(b) ?? 99) - (ratioOf(a) ?? 99));
  return {
    baselines,
    flagged,
    summary: { network, fetchedAt: nowIso, stations: readings.length, withBaseline: readings.filter((r) => (prev[r.id]?.n ?? 0) >= 24).length, median: (() => { const m = median(readings.map((r) => r.value)); return m === null ? null : r4(m); })() },
  };
}

const PAGE: Record<RadNetwork, string> = {
  bfs: 'https://odlinfo.bfs.de/',
  stuk: 'https://www.stuk.fi/en/topical/radiation-situation-in-finland',
  radnet: 'https://www.epa.gov/radnet/radnet-near-real-time-air-data',
};
const COUNTRY: Record<RadNetwork, string> = { bfs: 'DE', stuk: 'FI', radnet: 'US' };

/** Records: one per alerting cluster per 6-hour block, at its most raised station. */
export function radiationRecords(clusters: RadCluster[], nowIso: string): IntelligenceEvent[] {
  const block = Math.floor(Date.parse(nowIso) / (6 * H));
  return clusters
    .filter((c) => c.alert)
    .map((c) => {
      const top = c.stations[0];
      const ratio = ratioOf(top);
      const id = contentHash(NETWORK_SOURCE[c.network], top.id, String(block));
      const others = c.stations.length - 1;
      return {
        id,
        contentHash: id,
        dataOrigin: 'live' as const,
        sourceId: NETWORK_SOURCE[c.network],
        sourceName: `${NETWORK_LABEL[c.network]} — ambient gamma dose rate`,
        sourceClass: 'official' as const,
        sourceUrl: PAGE[c.network],
        title: truncate(
          `Radiation above usual — ${NETWORK_LABEL[c.network]}: ${top.name}${others ? ` and ${others} nearby station${others === 1 ? '' : 's'}` : ''}, ${top.value.toFixed(3)} µSv/h${ratio ? ` (${ratio}× usual)` : ''}`,
          LIMITS.title,
        ),
        summary: truncate(
          `${c.stations.length} station${c.stations.length === 1 ? '' : 's'} of the ${NETWORK_LABEL[c.network]} network read above their usual level: ` +
            c.stations
              .slice(0, 6)
              .map((s) => `${s.name} ${s.value.toFixed(3)} µSv/h${s.usual ? ` (usual ${s.usual.toFixed(3)})` : ''}`)
              .join('; ') +
            '. Rain can raise readings for a few hours by washing natural radon products to the ground; a release would show as a lasting rise across a wider area.',
          LIMITS.summary,
        ),
        category: 'disaster' as const,
        regionIds: c.network === 'radnet' ? ['united-states'] : [],
        countryCodes: [COUNTRY[c.network]],
        publishedAt: top.at,
        occurredAt: top.at,
        collectedAt: nowIso,
        credibility: 'official' as const,
        verificationStatus: 'unreviewed' as const,
        latitude: top.lat,
        longitude: top.lon,
        locationPrecision: c.network === 'radnet' ? ('city' as const) : ('exact' as const),
        metadata: {
          subtype: 'radiation',
          network: c.network,
          stations: c.stations.length,
          maxValue: top.value,
          usual: top.usual,
          high: c.stations.some((s) => s.status === 'high'),
          geoBasis: c.network === 'radnet' ? 'monitor city (RadNet gives the city, not the monitor position)' : 'station position',
        },
      };
    });
}

function finish(network: RadNetwork, readings: RadReading[], ctx: AdapterContext<RadState>, nowIso: string, extra: Partial<RadState> = {}): AdapterResult<RadState> {
  const ev = evaluateReadings(network, readings, unpackBaselines(ctx.state?.baselines), nowIso);
  const clusters = clusterStations(ev.flagged);
  return {
    events: radiationRecords(clusters, nowIso),
    rejected: [],
    itemsSeen: readings.length,
    notModified: false,
    state: { ...extra, lastFetchedAt: nowIso, baselines: packBaselines(ev.baselines), latest: { summary: ev.summary, flagged: ev.flagged } },
  };
}

const fresh = (at: string, now: number, hours: number) => now - Date.parse(at) <= hours * H;

// ---------------------------------------------------------------- Germany (BfS)

export const BFS_URL =
  'https://www.imis.bfs.de/ogc/opendata/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=opendata:odlinfo_odl_1h_latest&outputFormat=application/json&propertyName=id,name,site_status,end_measure,value,geom';

interface BfsFeature {
  geometry?: { coordinates?: unknown };
  properties?: { id?: unknown; name?: unknown; site_status?: unknown; end_measure?: unknown; value?: unknown };
}

export function parseBfs(features: BfsFeature[], now: number): RadReading[] {
  const out: RadReading[] = [];
  for (const f of features) {
    const p = f.properties ?? {};
    const c = f.geometry?.coordinates;
    if (p.site_status !== 1 || typeof p.value !== 'number' || !Array.isArray(c)) continue;
    const at = typeof p.end_measure === 'string' ? p.end_measure : '';
    if (!at || !fresh(at, now, 6)) continue;
    out.push({ id: String(p.id), name: String(p.name ?? p.id), lat: Number(c[1]), lon: Number(c[0]), at: new Date(Date.parse(at)).toISOString(), value: r4(p.value) });
  }
  return out;
}

export const bfsOdl: SourceAdapter<RadState> = {
  sourceId: NETWORK_SOURCE.bfs,
  async collect(ctx) {
    const nowIso = new Date(ctx.now).toISOString();
    const res = await ctx.fetch(BFS_URL, undefined, { Accept: 'application/json' }, { maxBytes: 8 * 1024 * 1024 });
    if (res.kind !== 'ok') throw new Error(`BfS ODL: unexpected ${res.status}`);
    const features = (JSON.parse(res.body) as { features?: BfsFeature[] }).features;
    if (!Array.isArray(features)) throw new Error('BfS ODL: no features');
    return finish('bfs', parseBfs(features, ctx.now), ctx, nowIso);
  },
};

// ---------------------------------------------------------------- Finland (STUK via FMI)

export const STUK_URL = 'https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature&storedquery_id=stuk::observations::external-radiation::latest::simple';

/** STUK's simple format gives positions, not names: stations are identified by position. */
export function parseStuk(xml: string, now: number): RadReading[] {
  const out: RadReading[] = [];
  for (const m of xml.matchAll(/<BsWfs:BsWfsElement[\s\S]*?<gml:pos>\s*([-\d.]+)\s+([-\d.]+)\s*<\/gml:pos>[\s\S]*?<BsWfs:Time>([^<]+)<\/BsWfs:Time>[\s\S]*?<BsWfs:ParameterName>([^<]+)<\/BsWfs:ParameterName>[\s\S]*?<BsWfs:ParameterValue>([^<]+)<\/BsWfs:ParameterValue>/g)) {
    if (m[4] !== 'DR_PT10M_avg') continue;
    const value = Number(m[5]);
    if (!Number.isFinite(value) || !fresh(m[3], now, 6)) continue;
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    out.push({ id: `${lat.toFixed(4)}_${lon.toFixed(4)}`, name: `station at ${lat.toFixed(2)}°N ${lon.toFixed(2)}°E`, lat, lon, at: new Date(Date.parse(m[3])).toISOString(), value: r4(value) });
  }
  return out;
}

export const stukRadiation: SourceAdapter<RadState> = {
  sourceId: NETWORK_SOURCE.stuk,
  async collect(ctx) {
    const nowIso = new Date(ctx.now).toISOString();
    const res = await ctx.fetch(STUK_URL, undefined, undefined, { maxBytes: 8 * 1024 * 1024 });
    if (res.kind !== 'ok') throw new Error(`STUK: unexpected ${res.status}`);
    if (!res.body.includes('BsWfs')) throw new Error('STUK: response is not a WFS feature collection');
    return finish('stuk', parseStuk(res.body, ctx.now), ctx, nowIso);
  },
};

// ---------------------------------------------------------------- United States (EPA RadNet)

/** The 16 monitors read (big cities, nuclear sites, major commands, Pacific and Alaska). Coordinates are the city centres. */
export const RADNET_STATIONS: { path: string; name: string; lat: number; lon: number }[] = [
  { path: 'DC/WASHINGTON', name: 'Washington, DC', lat: 38.9072, lon: -77.0369 },
  { path: 'NY/YAPHANK', name: 'Yaphank, NY', lat: 40.8368, lon: -72.9176 },
  { path: 'MA/BOSTON', name: 'Boston, MA', lat: 42.3601, lon: -71.0589 },
  { path: 'GA/ATLANTA', name: 'Atlanta, GA', lat: 33.749, lon: -84.388 },
  { path: 'FL/JACKSONVILLE', name: 'Jacksonville, FL', lat: 30.3322, lon: -81.6557 },
  { path: 'NE/OMAHA', name: 'Omaha, NE', lat: 41.2565, lon: -95.9345 },
  { path: 'CO/COLORADO%20SPRINGS', name: 'Colorado Springs, CO', lat: 38.8339, lon: -104.8214 },
  { path: 'NM/CARLSBAD', name: 'Carlsbad, NM', lat: 32.4207, lon: -104.2288 },
  { path: 'ID/IDAHO%20FALLS', name: 'Idaho Falls, ID', lat: 43.4917, lon: -112.0339 },
  { path: 'WA/RICHLAND', name: 'Richland, WA', lat: 46.2857, lon: -119.2845 },
  { path: 'CA/SAN%20FRANCISCO', name: 'San Francisco, CA', lat: 37.7749, lon: -122.4194 },
  { path: 'CA/LOS%20ANGELES', name: 'Los Angeles, CA', lat: 34.0522, lon: -118.2437 },
  { path: 'CA/SAN%20DIEGO', name: 'San Diego, CA', lat: 32.7157, lon: -117.1611 },
  { path: 'HI/HONOLULU', name: 'Honolulu, HI', lat: 21.3069, lon: -157.8583 },
  { path: 'AK/FAIRBANKS', name: 'Fairbanks, AK', lat: 64.8378, lon: -147.7164 },
  { path: 'PR/SAN%20JUAN', name: 'San Juan, PR', lat: 18.4655, lon: -66.1057 },
];
/** Each file holds the whole year (~800 kB), so two monitors are read per run in turn. */
export const RADNET_PER_RUN = 2;
export const radnetUrl = (path: string, year: number) => `https://radnet.epa.gov/cdx-radnet-rest/api/rest/csv/${year}/fixed/${path}`;

/** Rows of a RadNet CSV: [ISO time (UTC), dose rate µSv/h]. */
export function parseRadnetCsv(csv: string): [string, number][] {
  const out: [string, number][] = [];
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const c = line.split(',');
    const m = c[1]?.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
    const nsv = Number(c[2]);
    if (!m || !Number.isFinite(nsv) || nsv <= 0) continue;
    out.push([new Date(Date.UTC(+m[3], +m[1] - 1, +m[2], +m[4], +m[5], +m[6])).toISOString(), r4(nsv / 1000)]);
  }
  return out;
}

export const epaRadnet: SourceAdapter<RadState> = {
  sourceId: NETWORK_SOURCE.radnet,
  async collect(ctx) {
    const nowIso = new Date(ctx.now).toISOString();
    const prev = ctx.state;
    const baselines = unpackBaselines(prev?.baselines);
    const last = { ...(prev?.last ?? {}) };
    const cursor = prev?.cursor ?? 0;
    const year = new Date(ctx.now).getUTCFullYear();
    const batch = Array.from({ length: RADNET_PER_RUN }, (_, i) => RADNET_STATIONS[(cursor + i) % RADNET_STATIONS.length]);
    let read = 0;
    for (const st of batch) {
      const res = await ctx.fetch(radnetUrl(st.path, year), undefined, undefined, { maxBytes: 4 * 1024 * 1024, timeoutMs: 45_000 });
      if (res.kind !== 'ok') continue;
      const rows = parseRadnetCsv(res.body).filter(([at]) => Date.parse(at) <= ctx.now + H);
      if (!rows.length) continue;
      read++;
      const id = st.path;
      // A new monitor's usual level starts from its last two weeks (excluding the latest six hours).
      if (!baselines[id] || baselines[id].n < 24) {
        const ref = rows.filter(([at]) => Date.parse(at) >= ctx.now - 14 * 24 * H && Date.parse(at) < ctx.now - 6 * H).map(([, v]) => v);
        const m = median(ref);
        if (m !== null && ref.length >= 24) baselines[id] = { b: m, n: ref.length, t: Math.floor((ctx.now - 6 * H) / 60_000) };
      }
      const [at, value] = rows[rows.length - 1];
      last[id] = { value, at };
    }
    if (read === 0 && prev) throw new Error('EPA RadNet: no monitor file could be read this run');
    // Judge every monitor's latest reading (kept from earlier runs for the ones not read now).
    const readings: RadReading[] = RADNET_STATIONS.filter((s) => last[s.path] && fresh(last[s.path].at, ctx.now, 30)).map((s) => ({ id: s.path, name: s.name, lat: s.lat, lon: s.lon, ...last[s.path] }));
    return finish('radnet', readings, { ...ctx, state: prev ? { ...prev, baselines: packBaselines(baselines) } : ({ baselines: packBaselines(baselines) } as RadState) }, nowIso, {
      cursor: (cursor + RADNET_PER_RUN) % RADNET_STATIONS.length,
      last,
    });
  },
};
