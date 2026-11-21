/**
 * Radiation (Phase 18): ambient gamma dose rate from three official networks, each station judged
 * against its own usual level.
 *  - Germany: BfS ODL network (~1,700 stations, hourly), open data (dl-de/by-2-0).
 *  - Finland: STUK external radiation via the FMI open data service (~250 stations, 10-minute), CC BY 4.0.
 *  - United States: EPA RadNet near-real-time (a subset of 16 monitors, hourly, posted ~6 times a day).
 *
 * Rain washes radon decay products out of the air and can double a station's reading for a few hours,
 * so a single station rarely means anything: an alert needs several nearby stations, or a high level.
 */

export type RadNetwork = 'bfs' | 'stuk' | 'radnet';

export const NETWORK_LABEL: Record<RadNetwork, string> = {
  bfs: 'Germany (BfS)',
  stuk: 'Finland (STUK)',
  radnet: 'United States (EPA RadNet)',
};
export const NETWORK_SOURCE: Record<RadNetwork, string> = { bfs: 'bfs-odl', stuk: 'stuk-radiation', radnet: 'epa-radnet' };

/** One station's latest reading, in µSv/h. */
export interface RadReading {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** End of the measuring interval (ISO). */
  at: string;
  value: number;
}

/** Usual level: a slow running average of normal readings; readings flagged as raised do not move it. */
export interface StationBaseline {
  b: number;
  n: number;
  /** Last reading folded in (epoch minutes), so the same reading is not counted twice. */
  t: number;
}

export const BASELINE_MIN_READINGS = 24;
const ALPHA = 0.03;
/** Elevated: at least this many times usual and this much above it (µSv/h). */
export const ELEVATED_RATIO = 2;
export const ELEVATED_EXCESS = 0.1;
/** High: at least this level and this much above usual, or the absolute level alone without a baseline. */
export const HIGH_LEVEL = 0.5;
export const HIGH_EXCESS = 0.3;
export const HIGH_ABSOLUTE = 1.0;
/** Elevated stations within this distance form one cluster; an alert needs this many (RadNet: one). */
export const CLUSTER_KM = 100;
export const CLUSTER_MIN = 3;

export type RadStatus = 'normal' | 'elevated' | 'high' | 'no-baseline';

export function classify(value: number, base: StationBaseline | undefined): RadStatus {
  if (!base || base.n < BASELINE_MIN_READINGS) return value >= HIGH_ABSOLUTE ? 'high' : 'no-baseline';
  const excess = value - base.b;
  if (value >= HIGH_LEVEL && excess >= HIGH_EXCESS) return 'high';
  if (value >= base.b * ELEVATED_RATIO && excess >= ELEVATED_EXCESS) return 'elevated';
  return 'normal';
}

/** Folds a reading into the station's usual level (only new readings, and only if not raised). */
export function updateBaseline(base: StationBaseline | undefined, r: Pick<RadReading, 'value' | 'at'>): StationBaseline {
  const t = Math.floor(Date.parse(r.at) / 60_000);
  if (base && t <= base.t) return base;
  if (!base || base.n === 0) return { b: r.value, n: 1, t };
  const st = classify(r.value, base);
  if (st === 'elevated' || st === 'high') return { ...base, t };
  // A plain mean while the baseline builds, then a slow running average.
  const w = base.n < BASELINE_MIN_READINGS ? 1 / (base.n + 1) : ALPHA;
  return { b: Math.round((base.b + w * (r.value - base.b)) * 10_000) / 10_000, n: Math.min(base.n + 1, 99_999), t };
}

/** Packs baselines as "id=b,n,t;…" (Firestore refuses big maps of small objects; a string stays one field). */
export function packBaselines(m: Record<string, StationBaseline>): string {
  return Object.entries(m)
    .map(([id, x]) => `${id}=${x.b},${x.n},${x.t}`)
    .join(';');
}
export function unpackBaselines(s: string | null | undefined): Record<string, StationBaseline> {
  const out: Record<string, StationBaseline> = {};
  for (const part of (s ?? '').split(';')) {
    const i = part.lastIndexOf('=');
    if (i <= 0) continue;
    const [b, n, t] = part.slice(i + 1).split(',').map(Number);
    if ([b, n, t].every(Number.isFinite)) out[part.slice(0, i)] = { b, n, t };
  }
  return out;
}

export interface FlaggedStation extends RadReading {
  network: RadNetwork;
  status: 'elevated' | 'high';
  /** Usual level (µSv/h), or null when the station has none yet. */
  usual: number | null;
}

export interface RadCluster {
  network: RadNetwork;
  stations: FlaggedStation[];
  /** Meets the alert rule (CLUSTER_MIN stations, any high, or any RadNet station). */
  alert: boolean;
}

export interface NetworkSummary {
  network: RadNetwork;
  fetchedAt: string;
  stations: number;
  /** Stations with a usual level established. */
  withBaseline: number;
  /** Median of the latest readings (µSv/h). */
  median: number | null;
}

export interface RadiationSnapshot {
  networks: NetworkSummary[];
  /** Stations above their usual level now (largest ratio first). */
  flagged: FlaggedStation[];
  clusters: RadCluster[];
  simulated?: boolean;
}

const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/** Groups raised stations of one network: stations within CLUSTER_KM of any member join (single link). */
export function clusterStations(flagged: FlaggedStation[]): RadCluster[] {
  const left = [...flagged];
  const out: RadCluster[] = [];
  while (left.length) {
    const group = [left.shift()!];
    for (let i = 0; i < group.length; i++) {
      for (let j = left.length - 1; j >= 0; j--) {
        if (left[j].network === group[i].network && km(left[j], group[i]) <= CLUSTER_KM) group.push(...left.splice(j, 1));
      }
    }
    const network = group[0].network;
    out.push({ network, stations: group, alert: group.length >= CLUSTER_MIN || group.some((s) => s.status === 'high') || network === 'radnet' });
  }
  return out.sort((a, b) => Number(b.alert) - Number(a.alert) || b.stations.length - a.stations.length);
}

export const ratioOf = (s: Pick<FlaggedStation, 'value' | 'usual'>) => (s.usual ? Math.round((s.value / s.usual) * 10) / 10 : null);
export const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
