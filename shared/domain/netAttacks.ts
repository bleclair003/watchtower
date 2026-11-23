import { WATCH_REGIONS } from './regions.ts';

/**
 * Internet routing and DDoS (v0.70.0), from Cloudflare Radar (CC BY-NC 4.0, same free token as the
 * outage annotations).
 *
 * - Route hijacks: a network announces address blocks that belong to another network, so traffic for
 *   them goes to the wrong place. Cloudflare scores each detection 1–10; only high confidence (8+) is kept.
 * - Route leaks: a network passes on routes it should not, which can reroute traffic through it.
 *   Usually a mistake; kept as context.
 * - DDoS: layer-3 attack traffic that Cloudflare's network saw aimed at targets in each watch-region
 *   country, per day, against that country's own last four weeks. Cloudflare only sees attacks on
 *   networks it protects, so this is a sample, not a national total.
 */
export const BGP_SOURCE_ID = 'cloudflare-radar-bgp';
export const DDOS_SOURCE_ID = 'cloudflare-radar-ddos';
export const RADAR_API = 'https://api.cloudflare.com/client/v4/radar';
export const HIJACK_MIN_CONFIDENCE = 8;
/** Leaks with at least this many prefixes are shown as notable; smaller ones are routine. */
export const LEAK_NOTABLE_PREFIXES = 100;
export const DDOS_DAYS = 28;

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
  /** Median of the earlier days, and the score in typical spreads (null while building). */
  centre: number | null;
  score: number | null;
  ratio: number | null;
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

export const asnLabel = (n: BgpNetwork) => `AS${n.asn}${n.org ? ` ${n.org}` : ''}${n.country ? ` (${n.country})` : ''}`;
