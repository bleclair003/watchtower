/**
 * GPS / GNSS interference from aircraft position quality (v0.69.0).
 *
 * Aircraft with ADS-B version 2 transponders broadcast how accurate their own GPS position is (NACp,
 * Navigation Accuracy Category for Position) and its integrity (NIC). Over a jammed or spoofed area,
 * many aircraft at once report poor accuracy. The receiving network (readsb, used by adsb.lol and
 * adsb.fi) also marks an aircraft whose GPS was working and then failed ("gpsOkBefore"), with its last
 * good position.
 *
 * WATCHTOWER samples fixed circles over the watch regions once an hour and counts, per 1° square over
 * the last 24 hours, how many aircraft sightings had degraded positions. That share is the signal; a
 * single aircraft proves nothing (some transponders are badly installed and always report poor
 * accuracy). This is the same idea as public GPS-jamming maps, computed here from hourly samples, so
 * short or low-altitude interference and areas without receivers are missed.
 */

export const GNSS_SOURCE_ID = 'adsb-gnss';

export interface GnssCircle {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

/** Sampled circles (250 nm each), over the watch regions where aircraft fly and receivers exist. */
export const GNSS_RADIUS_NM = 250;
export const GNSS_CIRCLES: GnssCircle[] = [
  { id: 'baltic', name: 'Baltic and Kaliningrad', lat: 55.5, lon: 20.5 },
  { id: 'gulf-of-finland', name: 'Gulf of Finland and Estonia', lat: 59.5, lon: 26.5 },
  { id: 'black-sea', name: 'Black Sea and Turkey', lat: 42.5, lon: 32.5 },
  { id: 'east-med', name: 'Eastern Mediterranean, Israel and Lebanon', lat: 33.5, lon: 34.5 },
  { id: 'iraq-gulf', name: 'Iraq, Kuwait and the northern Gulf', lat: 30.5, lon: 46.5 },
  { id: 'hormuz', name: 'Strait of Hormuz and the UAE', lat: 25.5, lon: 55 },
  { id: 'red-sea', name: 'Red Sea and Bab el-Mandeb', lat: 16, lon: 41.5 },
  { id: 'korea', name: 'Korean Peninsula', lat: 37.5, lon: 127.5 },
  { id: 'taiwan', name: 'Taiwan Strait', lat: 24, lon: 120.5 },
  { id: 'south-china-sea', name: 'South China Sea', lat: 14, lon: 115 },
];

/** NACp below this (an estimated position error of more than 0.05 nm, about 93 m) counts as degraded. */
export const GNSS_DEGRADED_NACP = 8;
/** Only aircraft at or above this barometric altitude are counted (ground clutter and taxiing excluded). */
export const GNSS_MIN_ALT_FT = 1000;
/** A square needs this many sightings in the window before it is coloured. */
export const GNSS_MIN_SIGHTINGS = 10;
export const GNSS_WINDOW_HOURS = 24;
/** Records compare the last few hours with the day before them, so a new episode is not diluted by a quiet day. */
export const GNSS_RECENT_HOURS = 6;
/** Degraded share bands. */
export const GNSS_MEDIUM = 0.02;
export const GNSS_HIGH = 0.1;
/** A square is only recorded as high with this many degraded sightings (not just a high share of few). */
export const GNSS_HIGH_MIN_DEGRADED = 5;

export type GnssLevel = 'low' | 'medium' | 'high';
export const GNSS_LEVEL_LABEL: Record<GnssLevel, string> = { low: 'low (under 2%)', medium: 'medium (2–10%)', high: 'high (10% or more)' };

export interface GnssCell {
  /** "lat|lon" of the square's south-west corner, whole degrees. */
  k: string;
  /** Sightings in the window: aircraft counted, once per sample. */
  n: number;
  /** Of which with degraded accuracy (NACp below 8, or GPS lost). */
  bad: number;
  /** Of which flagged by the network as having lost GPS that was working before. */
  lost: number;
  level: GnssLevel;
  regionIds: string[];
}

export interface GnssLostPoint {
  /** Last good position before GPS was lost. */
  la: number;
  lo: number;
  /** When it was last good (UTC ISO). */
  at: string;
  /** Where the aircraft was when sampled. */
  nowLa: number;
  nowLo: number;
  cs: string | null;
}

export interface GnssSnapshot {
  fetchedAt: string;
  windowHours: number;
  provider: string;
  /** Circles sampled in the last run; failed ones are listed apart. */
  circles: GnssCircle[];
  failed: string[];
  cells: GnssCell[];
  lost: GnssLostPoint[];
  /** Totals over the window. */
  sightings: number;
  degraded: number;
  /** First hourly sample kept (records start after a day of history). */
  since: string;
  simulated?: boolean;
}

export const cellKey = (lat: number, lon: number) => `${Math.floor(lat)}|${Math.floor(lon)}`;
export function cellBounds(k: string): [w: number, s: number, e: number, n: number] {
  const [la, lo] = k.split('|').map(Number);
  return [lo, la, lo + 1, la + 1];
}
export const cellCentre = (k: string): [lat: number, lon: number] => {
  const [la, lo] = k.split('|').map(Number);
  return [la + 0.5, lo + 0.5];
};

export function gnssLevel(bad: number, n: number): GnssLevel {
  const share = n ? bad / n : 0;
  return share >= GNSS_HIGH ? 'high' : share >= GNSS_MEDIUM ? 'medium' : 'low';
}

/** Raw readsb / ADSBExchange v2 aircraft fields used here. */
export interface RawGnssAircraft {
  hex?: string;
  type?: string;
  flight?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | 'ground';
  version?: number;
  nac_p?: number;
  nic?: number;
  seen_pos?: number;
  gpsOkBefore?: number;
  gpsOkLat?: number;
  gpsOkLon?: number;
}

export type GnssReading = { status: 'ok' | 'degraded' | 'lost'; lat: number; lon: number };

/**
 * One aircraft: counted only if it is an ADS-B (not MLAT or TIS-B) version 2 transponder, airborne at
 * 1,000 ft or more, with a fresh position and an accuracy value. Lost = the network says GPS was working
 * before; degraded = NACp below 8.
 */
export function readAircraft(a: RawGnssAircraft): GnssReading | null {
  if (a.type !== 'adsb_icao' && a.type !== 'adsb_icao_nt') return null;
  if (a.version !== 2 || typeof a.nac_p !== 'number') return null;
  if (typeof a.alt_baro !== 'number' || a.alt_baro < GNSS_MIN_ALT_FT) return null;
  if (typeof a.lat !== 'number' || typeof a.lon !== 'number' || Math.abs(a.lat) > 90 || Math.abs(a.lon) > 180) return null;
  if (typeof a.seen_pos === 'number' && a.seen_pos > 60) return null;
  if (typeof a.gpsOkBefore === 'number') return { status: 'lost', lat: a.lat, lon: a.lon };
  return { status: a.nac_p < GNSS_DEGRADED_NACP ? 'degraded' : 'ok', lat: a.lat, lon: a.lon };
}
