/**
 * Maritime chokepoint transits from IMF PortWatch (Phase 13, item 3).
 *
 * PortWatch counts daily ship transits through 28 chokepoints from satellite and terrestrial AIS
 * (UN Global Platform, Spire). Counts cover container, dry bulk, general cargo, ro-ro and tanker
 * ships; the data runs several days behind. Positions are PortWatch's own chokepoint points.
 */

export interface ChokepointDef {
  /** WATCHTOWER id. */
  id: string;
  /** PortWatch portid. */
  portId: string;
  name: string;
  regionId: string | null;
}

export const CHOKEPOINTS: ChokepointDef[] = [
  { id: 'hormuz', portId: 'chokepoint6', name: 'Strait of Hormuz', regionId: 'middle-east' },
  { id: 'bab-el-mandeb', portId: 'chokepoint4', name: 'Bab el-Mandeb', regionId: 'red-sea' },
  { id: 'suez', portId: 'chokepoint1', name: 'Suez Canal', regionId: null },
  { id: 'bosporus', portId: 'chokepoint3', name: 'Bosporus', regionId: 'eastern-europe' },
  { id: 'taiwan-strait', portId: 'chokepoint11', name: 'Taiwan Strait', regionId: 'taiwan-strait' },
  { id: 'malacca', portId: 'chokepoint5', name: 'Malacca Strait', regionId: null },
];

export type ChokepointStatus = 'normal' | 'reduced' | 'severe' | 'sudden-drop' | 'insufficient-data';

export const CHOKEPOINT_STATUS_LABEL: Record<ChokepointStatus, string> = {
  normal: 'Normal',
  reduced: 'Reduced',
  severe: 'Severely reduced',
  'sudden-drop': 'Sudden drop',
  'insufficient-data': 'Not enough data',
};

/** 7-day mean below this share of the 2025 average → reduced; below SEVERE_SHARE → severe. */
export const REDUCED_SHARE = 0.7;
export const SEVERE_SHARE = 0.4;
/** 7-day mean below this share of the preceding 28-day mean → sudden drop (only if not already severe). */
export const SUDDEN_DROP_SHARE = 0.6;

/** [date YYYY-MM-DD, ships, tankers] */
export type DailyTransit = [string, number, number];

export interface ChokepointReading {
  id: string;
  name: string;
  regionId: string | null;
  lat: number;
  lon: number;
  /** 2025 daily averages (PortWatch, all ship types / tankers). */
  ref2025: { total: number; tanker: number } | null;
  /** Oldest first, up to 120 days. */
  series: DailyTransit[];
  latestDate: string | null;
  mean7: number | null;
  meanPrior28: number | null;
  status: ChokepointStatus;
}

export interface ChokepointSnapshot {
  fetchedAt: string;
  /** Latest day in the data (PortWatch runs several days behind). */
  latestDate: string | null;
  items: ChokepointReading[];
  simulated?: boolean;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Status from the last 7 days vs the 2025 average and vs the preceding 28 days. */
export function assessChokepoint(series: DailyTransit[], ref2025: { total: number } | null): Pick<ChokepointReading, 'mean7' | 'meanPrior28' | 'status' | 'latestDate'> {
  const s = [...series].sort((a, b) => a[0].localeCompare(b[0]));
  const last7 = s.slice(-7).map((d) => d[1]);
  const prior28 = s.slice(-35, -7).map((d) => d[1]);
  const mean7 = last7.length === 7 ? mean(last7) : null;
  const meanPrior28 = prior28.length >= 21 ? mean(prior28) : null;
  const latestDate = s.length ? s[s.length - 1][0] : null;
  if (mean7 === null || !ref2025 || ref2025.total <= 0) return { mean7, meanPrior28, latestDate, status: 'insufficient-data' };
  const share = mean7 / ref2025.total;
  let status: ChokepointStatus = share < SEVERE_SHARE ? 'severe' : share < REDUCED_SHARE ? 'reduced' : 'normal';
  if (status !== 'severe' && meanPrior28 && meanPrior28 > 0 && mean7 / meanPrior28 < SUDDEN_DROP_SHARE) status = 'sudden-drop';
  return { mean7, meanPrior28, latestDate, status };
}

/** Data older than this (latest day vs today) is shown as out of date. PortWatch normally lags ~5–7 days. */
export const CHOKEPOINT_STALE_DAYS = 14;
