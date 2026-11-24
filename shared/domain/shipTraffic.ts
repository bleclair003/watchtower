/**
 * Tanker and cargo ship traffic (v0.75.0), from the same aisstream.io listen as the sanctioned-ship
 * check, and shipping lanes (static).
 *
 * AIS ship types: 70–79 cargo, 80–89 tanker. A ship states its type in identity messages sent every few
 * minutes, so a 25-second listen sees the type of only some ships; the collector remembers types between
 * runs. Positions are sampled once per collection run, so tracks are a dot every half hour or so, not a
 * continuous path. aisstream.io's volunteer receivers cover the Baltic and North Sea well, the Black Sea
 * and eastern Mediterranean coasts partly, and the Gulf, Red Sea and Asian seas not at all.
 */
export const TRAFFIC_SOURCE_ID = 'ais-shipping';
export const SHIPS_DOC_ID = 'ships';

export type TrafficKind = 'tanker' | 'cargo';
export const TRAFFIC_LABEL: Record<TrafficKind, string> = { tanker: 'Tanker', cargo: 'Cargo ship' };
export const kindOfType = (t: number | null | undefined): TrafficKind | null =>
  typeof t !== 'number' ? null : t >= 80 && t <= 89 ? 'tanker' : t >= 70 && t <= 79 ? 'cargo' : null;

/** AIS second digit of the ship type: what it carries (hazard category), for 7x and 8x. */
export function cargoHazard(t: number): string | null {
  const d = t % 10;
  return d === 1 ? 'hazardous cargo A' : d === 2 ? 'hazardous cargo B' : d === 3 ? 'hazardous cargo C' : d === 4 ? 'hazardous cargo D' : null;
}

/** Tracks keep a point at most this often and for this long. */
export const TRACK_HOURS = 24;
export const TRACK_MAX_POINTS = 24;
/** At most this many ships in the map document, watch-region seas and tankers first. */
export const TRAFFIC_MAX_SHIPS = 800;

export interface TrafficShip {
  mmsi: string;
  name: string | null;
  imo: string | null;
  kind: TrafficKind;
  /** AIS type code (70–89). */
  type: number;
  destination: string | null;
  la: number;
  lo: number;
  sog: number | null;
  cog: number | null;
  seenAt: string;
  area: string;
  /** Earlier positions, oldest first, flat [lon, lat, minutes before seenAt, …] (Firestore has no nested arrays). */
  track: number[];
}

export interface ShipTrafficDoc {
  fetchedAt: string;
  listenSeconds: number;
  /** Ships whose type the collector knows (remembered between runs). */
  typesKnown: number;
  ships: TrafficShip[];
  /** Tanker and cargo ships with a position in the last 24 h before the cap. */
  totalSeen: number;
  /** v0.76.0: positions from Fintraffic's Digitraffic feed in the last run (null when it did not answer). */
  fintraffic?: number | null;
  simulated?: boolean;
}

/** Track points as [lon, lat, time ISO], oldest first, ending with the current position. */
export function trackPoints(s: Pick<TrafficShip, 'track' | 'la' | 'lo' | 'seenAt'>): [number, number, string][] {
  const t0 = Date.parse(s.seenAt);
  const out: [number, number, string][] = [];
  for (let i = 0; i + 2 < s.track.length; i += 3) out.push([s.track[i], s.track[i + 1], new Date(t0 - s.track[i + 2] * 60_000).toISOString()]);
  out.push([s.lo, s.la, s.seenAt]);
  return out;
}

export type LaneClass = 'major' | 'middle' | 'minor';
export interface LanesDataset {
  source: { name: string; url: string; licence: string };
  retrievedAt: string;
  lanes: { c: LaneClass; g: [number, number][][] }[];
}

/** First three digits of an MMSI (Maritime Identification Digits) → flag state, for common flags. */
const MID: Record<string, string> = {
  '211': 'DE', '218': 'DE', '219': 'DK', '220': 'DK', '230': 'FI', '231': 'FO', '232': 'GB', '233': 'GB', '234': 'GB', '235': 'GB', '236': 'GI',
  '244': 'NL', '245': 'NL', '246': 'NL', '209': 'CY', '210': 'CY', '212': 'CY', '229': 'MT', '248': 'MT', '249': 'MT', '256': 'MT', '237': 'GR',
  '239': 'GR', '240': 'GR', '241': 'GR', '257': 'NO', '258': 'NO', '259': 'NO', '261': 'PL', '265': 'SE', '266': 'SE', '271': 'TR', '272': 'UA',
  '273': 'RU', '275': 'LV', '276': 'EE', '277': 'LT', '247': 'IT', '224': 'ES', '225': 'ES', '226': 'FR', '227': 'FR', '228': 'FR', '205': 'BE',
  '351': 'PA', '352': 'PA', '353': 'PA', '354': 'PA', '355': 'PA', '356': 'PA', '357': 'PA', '370': 'PA', '371': 'PA', '372': 'PA', '373': 'PA',
  '374': 'PA', '636': 'LR', '637': 'LR', '538': 'MH', '308': 'BS', '309': 'BS', '311': 'BS', '341': 'KN', '312': 'BZ', '314': 'BB', '304': 'AG',
  '305': 'AG', '477': 'HK', '563': 'SG', '564': 'SG', '565': 'SG', '566': 'SG', '412': 'CN', '413': 'CN', '414': 'CN', '431': 'JP', '440': 'KR',
  '441': 'KR', '667': 'SL', '511': 'PW', '620': 'KM', '613': 'CM', '572': 'TV', '577': 'VU', '515': 'KH', '403': 'SA', '422': 'IR', '470': 'AE',
  '471': 'AE', '466': 'QA', '461': 'OM', '447': 'KW', '408': 'BH', '425': 'IQ', '428': 'IL', '450': 'LB', '468': 'SY', '622': 'EG', '242': 'MA',
  '214': 'MD', '264': 'RO', '207': 'BG', '213': 'GE', '423': 'AZ',
};
export const flagOf = (mmsi: string) => MID[mmsi.slice(0, 3)] ?? null;
