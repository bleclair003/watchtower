import type { IntelligenceEvent } from './types.ts';
import type { CountryHotspot } from './countryConvergence.ts';
import { cellCentre, type GnssCell } from './gnss.ts';
import { distanceKm } from './installations.ts';
import { regionsForPoint } from './regions.ts';
import { NAV_KIND_LABEL, type NavWarningKind } from './navWarnings.ts';

/**
 * Signal convergence (v0.79.0): places where several different KINDS of signal line up in space and time.
 *
 * Each located record is sorted into a signal type (GPS interference, a ship going dark, a ship lingering
 * over a cable, a navigational warning, an aircraft pattern, an earthquake, a fire cluster…). Signals are
 * either anomalies (something out of the ordinary) or context (routine activity that helps read a place:
 * military flights, sanctioned ships passing through, the medium GPS interference that is near-constant
 * in parts of the Middle East and the Baltic). A hotspot needs anomalies of at least two types from at least
 * two independent feeds, within RADIUS_KM of each other in the last WINDOW_HOURS. Two feeds is WATCH,
 * three or more is STRONG.
 *
 * Counting types, not records, means one busy feed cannot make a hotspot on its own; requiring two feeds
 * means two readings of the same data (say GPS interference and an aircraft orbit, both from ADS-B) do not
 * count as independent. A hotspot is a coincidence worth a look, not evidence the signals are linked.
 */

export const CONVERGENCE_WINDOW_HOURS = 72;
export const CONVERGENCE_RADIUS_KM = 150;
export const MAX_HOTSPOTS = 40;
const MAX_SIGNALS_PER_HOTSPOT = 30;
const MIN_QUAKE_MAGNITUDE = 4;

/** Feeds: signals from the same feed are not independent of each other. */
export const FEED_LABEL: Record<string, string> = {
  adsb: 'ADS-B aircraft data',
  ais: 'AIS ship data',
  nga: 'NGA navigational warnings',
  usgs: 'USGS earthquakes',
  firms: 'NASA FIRMS fire detections',
  reports: 'news and official reports',
};

export type SignalRole = 'anomaly' | 'context';
export interface SignalType {
  label: string;
  feed: keyof typeof FEED_LABEL;
  role: SignalRole;
}

export const SIGNAL_TYPES = {
  gnss: { label: 'GPS interference (high)', feed: 'adsb', role: 'anomaly' },
  'air-pattern': { label: 'Aircraft pattern (orbit, surge or new type)', feed: 'adsb', role: 'anomaly' },
  'air-emergency': { label: 'Aircraft emergency squawk', feed: 'adsb', role: 'anomaly' },
  'ship-dark': { label: 'Ship went dark', feed: 'ais', role: 'anomaly' },
  'cable-loiter': { label: 'Ship lingering over a cable or pipeline', feed: 'ais', role: 'anomaly' },
  'tanker-level': { label: 'Tanker traffic surge or drop', feed: 'ais', role: 'anomaly' },
  'nav-warning': { label: 'Navigational warning', feed: 'nga', role: 'anomaly' },
  quake: { label: `Earthquake M${MIN_QUAKE_MAGNITUDE}+`, feed: 'usgs', role: 'anomaly' },
  fire: { label: 'Fire cluster', feed: 'firms', role: 'anomaly' },
  report: { label: 'Located military or unrest report', feed: 'reports', role: 'anomaly' },
  'mil-air': { label: 'Military flights', feed: 'adsb', role: 'context' },
  'sanctioned-ship': { label: 'Sanctioned ships', feed: 'ais', role: 'context' },
  'gnss-medium': { label: 'GPS interference (medium)', feed: 'adsb', role: 'context' },
} as const satisfies Record<string, SignalType>;
export type SignalTypeId = keyof typeof SIGNAL_TYPES;

export interface Signal {
  type: SignalTypeId;
  title: string;
  sourceId: string;
  /** ISO time of the signal (record published or collected time; for GPS cells, the reading time). */
  at: string;
  lat: number;
  lon: number;
  url: string;
  eventId?: string;
  regionIds: string[];
  /** Extra label (nav warning kind, quake magnitude). */
  detail?: string;
}

const at = (e: IntelligenceEvent) => e.publishedAt ?? e.collectedAt;

/** Sorts a record into a signal type, or null when it is not one (no position, or not a signal kind). */
export function classify(e: IntelligenceEvent): { type: SignalTypeId; detail?: string } | null {
  if (e.latitude === undefined || e.longitude === undefined) return null;
  if (e.locationPrecision !== 'exact' && e.locationPrecision !== 'city') return null;
  const sub = String(e.metadata?.subtype ?? '');
  switch (e.sourceId) {
    case 'adsb-gnss':
      return { type: 'gnss' };
    case 'adsb-military':
      return sub === 'aircraft-pattern' ? { type: 'air-pattern' } : { type: 'mil-air' };
    case 'adsb-emergencies':
      return { type: 'air-emergency' };
    case 'ais-shipping':
      if (sub === 'ship-dark' || sub === 'ship-reappeared') return { type: 'ship-dark' };
      if (sub === 'tanker-level') return { type: 'tanker-level' };
      return null;
    case 'ais-sanctioned-ships':
      if (sub === 'cable-proximity') return { type: 'cable-loiter' };
      if (sub === 'sanctioned-vessel-sighting') return { type: 'sanctioned-ship' };
      return null;
    case 'nga-msi': {
      const kind = e.metadata?.navKind as NavWarningKind | undefined;
      if (!kind || kind === 'other') return null;
      return { type: 'nav-warning', detail: NAV_KIND_LABEL[kind] };
    }
    case 'usgs-earthquakes': {
      const mag = Number(e.metadata?.magnitude);
      return Number.isFinite(mag) && mag >= MIN_QUAKE_MAGNITUDE ? { type: 'quake', detail: `M${mag.toFixed(1)}` } : null;
    }
    case 'nasa-firms':
      return { type: 'fire' };
    default:
      // Anything else with a real position that reports fighting or unrest.
      return e.category === 'military' || e.category === 'unrest' ? { type: 'report' } : null;
  }
}

export function signalsFromEvents(events: IntelligenceEvent[], now: number): Signal[] {
  const from = now - CONVERGENCE_WINDOW_HOURS * 3_600_000;
  const out: Signal[] = [];
  for (const e of events) {
    const t = Date.parse(at(e));
    if (!(t >= from && t <= now + 3_600_000)) continue;
    const c = classify(e);
    if (!c) continue;
    out.push({ type: c.type, detail: c.detail, title: e.title, sourceId: e.sourceId, at: at(e), lat: e.latitude!, lon: e.longitude!, url: e.sourceUrl, eventId: e.id, regionIds: e.regionIds });
  }
  return out;
}

/** GPS interference squares at medium (context) or high (anomaly) level, as signals at the square's centre. */
export function signalsFromGnss(cells: GnssCell[], fetchedAt: string): Signal[] {
  return cells
    .filter((c) => c.level !== 'low')
    .map((c) => {
      const [lat, lon] = cellCentre(c.k);
      const pct = c.n ? Math.round((c.bad / c.n) * 100) : 0;
      return {
        type: c.level === 'high' ? ('gnss' as const) : ('gnss-medium' as const),
        title: `GPS interference ${c.level}: ${pct}% of ${c.n} aircraft sightings degraded`,
        detail: `${c.level}, ${pct}%`,
        sourceId: 'adsb-gnss',
        at: fetchedAt,
        lat,
        lon,
        url: '',
        regionIds: c.regionIds,
      };
    });
}

export type HotspotLevel = 'watch' | 'strong';
export interface HotspotType {
  type: SignalTypeId;
  label: string;
  role: SignalRole;
  feed: string;
  count: number;
}
export interface Hotspot {
  id: string;
  lat: number;
  lon: number;
  /** Distance from the centre to the farthest signal, at least 25 km. */
  radiusKm: number;
  level: HotspotLevel;
  /** Anomaly types first, then context, most signals first. */
  types: HotspotType[];
  /** Independent feeds behind the anomaly signals. */
  feeds: string[];
  first: string;
  last: string;
  regionIds: string[];
  /** Anomalies first, newest first; capped. */
  signals: Signal[];
  signalCount: number;
}
export interface ConvergenceSnapshot {
  generatedAt: string;
  windowHours: number;
  radiusKm: number;
  signalsChecked: number;
  hotspots: Hotspot[];
  /** v0.80.0: countries where signals without a position line up (48 h). */
  countries?: CountryHotspot[];
  simulated?: boolean;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const role = (s: Signal) => SIGNAL_TYPES[s.type].role;

function describe(members: Signal[], seedKey: string): Hotspot | null {
  const anomalies = members.filter((s) => role(s) === 'anomaly');
  const anomalyTypes = new Set(anomalies.map((s) => s.type));
  const feeds = [...new Set(anomalies.map((s) => SIGNAL_TYPES[s.type].feed))].sort();
  if (anomalyTypes.size < 2 || feeds.length < 2) return null;
  const lat = anomalies.reduce((a, s) => a + s.lat, 0) / anomalies.length;
  const lon = anomalies.reduce((a, s) => a + s.lon, 0) / anomalies.length;
  const counts = new Map<SignalTypeId, number>();
  for (const s of members) counts.set(s.type, (counts.get(s.type) ?? 0) + 1);
  const types: HotspotType[] = [...counts.entries()]
    .map(([type, count]) => ({ type, label: SIGNAL_TYPES[type].label, role: SIGNAL_TYPES[type].role as SignalRole, feed: SIGNAL_TYPES[type].feed, count }))
    .sort((a, b) => (a.role === b.role ? b.count - a.count : a.role === 'anomaly' ? -1 : 1));
  const times = members.map((s) => s.at).sort();
  const sorted = [...members].sort((a, b) => (role(a) === role(b) ? b.at.localeCompare(a.at) : role(a) === 'anomaly' ? -1 : 1));
  return {
    id: seedKey,
    lat: r3(lat),
    lon: r3(lon),
    radiusKm: Math.max(25, Math.round(Math.max(...members.map((s) => distanceKm(lat, lon, s.lat, s.lon))))),
    level: feeds.length >= 3 ? 'strong' : 'watch',
    types,
    feeds,
    first: times[0],
    last: times[times.length - 1],
    regionIds: [...new Set([...members.flatMap((s) => s.regionIds), ...regionsForPoint(lat, lon)])].sort(),
    signals: sorted.slice(0, MAX_SIGNALS_PER_HOTSPOT),
    signalCount: members.length,
  };
}

const keyOf = (s: Signal) => `${s.type}|${s.eventId ?? `${s.lat},${s.lon}`}`;

/**
 * Finds hotspots: each anomaly in turn is a seed, its hotspot is every signal within the radius; the best
 * hotspots (most feeds, then most anomaly types, then most recent) are kept, and an anomaly already in a
 * kept hotspot cannot seed another, so overlapping candidates collapse into one.
 */
export function findHotspots(signals: Signal[], radiusKm = CONVERGENCE_RADIUS_KM): Hotspot[] {
  const anomalies = signals.filter((s) => role(s) === 'anomaly');
  const candidates: { h: Hotspot; seed: Signal; members: Signal[] }[] = [];
  for (const seed of anomalies) {
    const members = signals.filter((s) => s === seed || distanceKm(seed.lat, seed.lon, s.lat, s.lon) <= radiusKm);
    const h = describe(members, keyOf(seed));
    if (h) candidates.push({ h, seed, members });
  }
  const anomalyTypes = (h: Hotspot) => h.types.filter((t) => t.role === 'anomaly').length;
  candidates.sort((a, b) => b.h.feeds.length - a.h.feeds.length || anomalyTypes(b.h) - anomalyTypes(a.h) || b.h.last.localeCompare(a.h.last) || a.h.id.localeCompare(b.h.id));
  const used = new Set<Signal>();
  const kept: Hotspot[] = [];
  for (const c of candidates) {
    if (used.has(c.seed)) continue;
    // Signals already in a kept hotspot are left out, so a hotspot is never just a corner of another.
    const rest = c.members.filter((s) => !used.has(s) || role(s) === 'context');
    if (!rest.includes(c.seed)) continue;
    const h = describe(rest, c.h.id);
    if (!h) continue;
    kept.push(h);
    for (const s of rest) if (role(s) === 'anomaly') used.add(s);
    if (kept.length >= MAX_HOTSPOTS) break;
  }
  return kept;
}

export function computeConvergence(events: IntelligenceEvent[], gnss: { cells: GnssCell[]; fetchedAt: string } | null, now: number): ConvergenceSnapshot {
  const signals = [...signalsFromEvents(events, now), ...(gnss ? signalsFromGnss(gnss.cells, gnss.fetchedAt) : [])];
  return {
    generatedAt: new Date(now).toISOString(),
    windowHours: CONVERGENCE_WINDOW_HOURS,
    radiusKm: CONVERGENCE_RADIUS_KM,
    signalsChecked: signals.length,
    hotspots: findHotspots(signals),
  };
}
