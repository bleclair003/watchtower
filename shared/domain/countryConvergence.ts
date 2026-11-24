import type { IntelligenceEvent } from './types.ts';
import { classify, SIGNAL_TYPES, type HotspotLevel, type SignalRole } from './convergence.ts';
import { regionsForCountry } from './regions.ts';

/**
 * Country-level signal convergence (v0.80.0): the same idea as the map hotspots, for signals that have a
 * country but no position — routing hijacks and leaks, DDoS surges, internet outages, censorship, travel
 * advice changes, prediction-market swings, missile launches, disease outbreaks — plus located anomalies
 * that carry a country. A country hotspot needs anomalies of at least two types from at least two
 * independent feeds within COUNTRY_WINDOW_HOURS: two feeds is WATCH, three or more STRONG.
 *
 * Routing and DDoS records already marked `routine` by their own rules do not count. Daily front reports,
 * sanctions designations, Security Council meetings, military flights and sanctioned ships passing through
 * are context: they help read a country but never make a hotspot.
 */

export const COUNTRY_WINDOW_HOURS = 48;
const MAX_SIGNALS = 30;

export const COUNTRY_FEED_LABEL: Record<string, string> = {
  bgp: 'Cloudflare Radar routing (route collectors)',
  cloudflare: 'Cloudflare network (DDoS, outages)',
  ioda: 'IODA internet measurements',
  ooni: 'OONI censorship tests',
  travel: 'US and UK travel advice',
  markets: 'Prediction markets',
  yonhap: 'Yonhap launch reports',
  who: 'WHO outbreak news',
  sanctions: 'Sanctions lists',
  un: 'UN Security Council',
  front: 'Ukrainian military reports',
};

export const COUNTRY_TYPE_LABEL: Record<string, string> = {
  routing: 'Routing hijack or leak (not routine)',
  ddos: 'DDoS surge (not routine)',
  outage: 'Internet outage',
  censorship: 'Censorship (new blocking)',
  'travel-advice': 'Travel advice change',
  market: 'Prediction-market swing',
  'missile-launch': 'Missile launch',
  outbreak: 'Disease outbreak',
  sanctions: 'Sanctions designations',
  unsc: 'Security Council meeting',
  front: 'Daily front or air-attack report',
};

export interface CountrySignal {
  type: string;
  feed: string;
  role: SignalRole;
  title: string;
  sourceId: string;
  at: string;
  url: string;
  eventId: string;
}
export interface CountryHotspotType {
  type: string;
  label: string;
  role: SignalRole;
  feed: string;
  count: number;
}
export interface CountryHotspot {
  /** ISO 3166-1 alpha-2. */
  country: string;
  level: HotspotLevel;
  types: CountryHotspotType[];
  feeds: string[];
  first: string;
  last: string;
  regionIds: string[];
  signals: CountrySignal[];
  signalCount: number;
}

type Kind = { type: string; feed: string; role: SignalRole };

/** Sorts a record into a country signal, or null. Located anomalies keep their map type and feed. */
export function classifyCountry(e: IntelligenceEvent): Kind | null {
  const m = e.metadata ?? {};
  const sub = String(m.subtype ?? '');
  switch (e.sourceId) {
    case 'cloudflare-radar-bgp':
      return m.routine === true ? null : { type: 'routing', feed: 'bgp', role: 'anomaly' };
    case 'cloudflare-radar-ddos':
      return m.routine === true ? null : { type: 'ddos', feed: 'cloudflare', role: 'anomaly' };
    case 'cloudflare-radar-outages':
      return { type: 'outage', feed: 'cloudflare', role: 'anomaly' };
    case 'ioda-outages':
      return { type: 'outage', feed: 'ioda', role: 'anomaly' };
    case 'ooni':
      return { type: 'censorship', feed: 'ooni', role: 'anomaly' };
    case 'state-travel-advisories':
    case 'uk-fcdo-travel':
      return { type: 'travel-advice', feed: 'travel', role: 'anomaly' };
    case 'polymarket':
      return sub === 'market-odds-move' ? { type: 'market', feed: 'markets', role: 'anomaly' } : null;
    case 'yonhap-dprk-launches':
      return { type: 'missile-launch', feed: 'yonhap', role: 'anomaly' };
    case 'who-don':
      return { type: 'outbreak', feed: 'who', role: 'anomaly' };
    case 'ofac-sdn':
    case 'uk-sanctions':
    case 'eu-sanctions':
      return { type: 'sanctions', feed: 'sanctions', role: 'context' };
    case 'un-security-council':
      return { type: 'unsc', feed: 'un', role: 'context' };
    case 'ua-general-staff':
    case 'ua-air-force':
      return { type: 'front', feed: 'front', role: 'context' };
  }
  const located = classify(e);
  if (!located) return null;
  const t = SIGNAL_TYPES[located.type];
  return { type: located.type, feed: t.feed, role: t.role };
}

const labelOf = (type: string) => COUNTRY_TYPE_LABEL[type] ?? SIGNAL_TYPES[type as keyof typeof SIGNAL_TYPES]?.label ?? type;
export const countryFeedLabel = (feed: string) => COUNTRY_FEED_LABEL[feed] ?? feed;

export function findCountryHotspots(events: IntelligenceEvent[], now: number): CountryHotspot[] {
  const from = now - COUNTRY_WINDOW_HOURS * 3_600_000;
  const byCountry = new Map<string, CountrySignal[]>();
  for (const e of events) {
    const at = e.publishedAt ?? e.collectedAt;
    const t = Date.parse(at);
    if (!(t >= from && t <= now + 3_600_000)) continue;
    const k = classifyCountry(e);
    if (!k) continue;
    for (const c of new Set(e.countryCodes)) {
      const list = byCountry.get(c) ?? [];
      list.push({ ...k, title: e.title, sourceId: e.sourceId, at, url: e.sourceUrl, eventId: e.id });
      byCountry.set(c, list);
    }
  }
  const out: CountryHotspot[] = [];
  for (const [country, signals] of byCountry) {
    const anomalies = signals.filter((s) => s.role === 'anomaly');
    const anomalyTypes = new Set(anomalies.map((s) => s.type));
    const feeds = [...new Set(anomalies.map((s) => s.feed))].sort();
    if (anomalyTypes.size < 2 || feeds.length < 2) continue;
    const counts = new Map<string, CountrySignal>();
    const n = new Map<string, number>();
    for (const s of signals) {
      const key = `${s.type}|${s.feed}`;
      counts.set(key, s);
      n.set(key, (n.get(key) ?? 0) + 1);
    }
    const types: CountryHotspotType[] = [...counts.entries()]
      .map(([key, s]) => ({ type: s.type, label: labelOf(s.type), role: s.role, feed: s.feed, count: n.get(key)! }))
      .sort((a, b) => (a.role === b.role ? b.count - a.count : a.role === 'anomaly' ? -1 : 1));
    const times = signals.map((s) => s.at).sort();
    const sorted = [...signals].sort((a, b) => (a.role === b.role ? b.at.localeCompare(a.at) : a.role === 'anomaly' ? -1 : 1));
    out.push({
      country,
      level: feeds.length >= 3 ? 'strong' : 'watch',
      types,
      feeds,
      first: times[0],
      last: times[times.length - 1],
      regionIds: regionsForCountry(country),
      signals: sorted.slice(0, MAX_SIGNALS),
      signalCount: signals.length,
    });
  }
  return out.sort((a, b) => b.feeds.length - a.feeds.length || b.last.localeCompare(a.last) || a.country.localeCompare(b.country));
}
