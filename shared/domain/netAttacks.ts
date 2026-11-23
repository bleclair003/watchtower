import { WATCH_REGIONS } from './regions.ts';

/**
 * Internet routing and DDoS (v0.70.0), from Cloudflare Radar (CC BY-NC 4.0, same free token as the
 * outage annotations).
 *
 * - Route hijacks: a network announces address blocks that belong to another network, so traffic for
 *   them goes to the wrong place. Cloudflare scores each detection 1–10; only high confidence (8+) is kept.
 *   Most are misconfigurations between neighbouring networks, so only cross-border hijacks where both
 *   sides are in watch-region countries (e.g. a Russian network announcing Ukrainian addresses) are
 *   notable; the rest are routine.
 * - Route leaks: a network passes on routes it should not, which can reroute traffic through it.
 *   Usually a mistake; notable from 100 address blocks.
 * - DDoS: layer-3 attack traffic that Cloudflare's network saw aimed at targets in each watch-region
 *   country, per day for four weeks. Attack traffic is spiky (most days near zero, a few large days), so
 *   a day is judged against the biggest day of the four weeks, not the median. Cloudflare only sees
 *   attacks on networks it protects, so this is a sample, not a national total.
 */
export const BGP_SOURCE_ID = 'cloudflare-radar-bgp';
export const DDOS_SOURCE_ID = 'cloudflare-radar-ddos';
export const RADAR_API = 'https://api.cloudflare.com/client/v4/radar';
export const HIJACK_MIN_CONFIDENCE = 8;
/** Leaks with at least this many prefixes are shown as notable; smaller ones are routine. */
export const LEAK_NOTABLE_PREFIXES = 100;
export const DDOS_DAYS = 28;
/** A day at this share of the four-week peak or more is a surge. */
export const DDOS_PEAK_SHARE = 0.5;
/** A day counts as an attack day at this share of the peak or more. */
export const DDOS_ACTIVE_SHARE = 0.05;

/** Watch-region countries (the United States is left out: its routing churn would drown the rest). */
export const NET_WATCH_COUNTRIES: string[] = [...new Set(WATCH_REGIONS.filter((r) => r.id !== 'united-states').flatMap((r) => r.countryCodes))];

export interface BgpNetwork {
  asn: number;
  org: string | null;
  country: string | null;
}

export interface BgpHijack {
  id: number;
  /** First and last time the hijacked routes were seen (UTC ISO). */
  from: string;
  to: string | null;
  confidence: number;
  hijacker: BgpNetwork;
  victims: BgpNetwork[];
  victimCountries: string[];
  prefixes: string[];
  prefixCount: number;
  /** Cloudflare marks an event stale when it is no longer being seen. */
  stale: boolean;
  tags: string[];
}

export interface BgpLeak {
  id: number;
  at: string;
  leaker: BgpNetwork;
  countries: string[];
  prefixCount: number;
  originCount: number;
  peerCount: number;
  finished: boolean;
}

export interface DdosCountry {
  country: string;
  /** Daily values as Cloudflare returns them (normalised within the country's own series), oldest first. */
  values: number[];
  /** Day of the last complete value (YYYY-MM-DD). */
  day: string;
  latest: number;
  /** The last day as a share of the biggest day in the window (0–1), and when that biggest day was. */
  peakShare: number;
  peakDay: string;
  /** Days in the window at 5% of the peak or more. */
  activeDays: number;
}

export interface NetAttackSnapshot {
  fetchedAt: string | null;
  /** High-confidence hijacks and leaks involving watch-region countries, last 7 days, newest first. */
  hijacks: BgpHijack[];
  leaks: BgpLeak[];
  ddos: { fetchedAt: string; countries: DdosCountry[]; noData: string[] } | null;
  simulated?: boolean;
}

/** Radar timestamps sometimes lack a zone; they are UTC. */
export function radarIso(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  const s = /[zZ]|[+-]\d{2}:?\d{2}$/.test(v) ? v : `${v}Z`;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Notable hijack: networks in two different countries, both in watch-region countries. */
export function hijackNotable(h: Pick<BgpHijack, 'hijacker' | 'victimCountries'>): boolean {
  const w = new Set(NET_WATCH_COUNTRIES);
  const from = h.hijacker.country;
  return !!from && w.has(from) && h.victimCountries.some((c) => c !== from && w.has(c));
}
export const ddosSurge = (c: Pick<DdosCountry, 'peakShare'>) => c.peakShare >= DDOS_PEAK_SHARE;

export const asnLabel = (n: BgpNetwork) => `AS${n.asn}${n.org ? ` ${n.org}` : ''}${n.country ? ` (${n.country})` : ''}`;
