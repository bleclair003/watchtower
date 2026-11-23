import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { regionsForCountry } from '../../shared/domain/regions.ts';
import { compare, median, VERY_UNUSUAL } from '../../shared/domain/anomaly.ts';
import {
  BGP_SOURCE_ID,
  DDOS_DAYS,
  DDOS_SOURCE_ID,
  HIJACK_MIN_CONFIDENCE,
  LEAK_NOTABLE_PREFIXES,
  NET_WATCH_COUNTRIES,
  RADAR_API,
  asnLabel,
  radarIso,
  type BgpHijack,
  type BgpLeak,
  type BgpNetwork,
  type DdosCountry,
} from '../../shared/domain/netAttacks.ts';
import { contentHash } from '../lib/hash.ts';
import { readSecret } from '../lib/secrets.ts';
import { LIMITS, cleanText, truncate } from '../lib/text.ts';
import { RADAR_TOKEN_ENV } from './cloudflareRadar.ts';
import type { AdapterContext, SourceAdapter } from './types.ts';

export { BGP_SOURCE_ID, DDOS_SOURCE_ID };
const LICENCE = 'CC BY-NC 4.0 — Cloudflare Radar';
const KEEP_MS = 7 * 86_400_000;
const PAGE = 100;
const MAX_PAGES = 5;
export const BGP_EVERY_MS = 55 * 60_000;
/** A DDoS surge is recorded at this score or more and at least this many times the usual level. */
export const DDOS_MIN_RATIO = 3;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const iso2 = (v: unknown): string | null => (typeof v === 'string' && /^[A-Za-z]{2}$/.test(v) ? v.toUpperCase() : null);
const watched = new Set(NET_WATCH_COUNTRIES);

function token(): string {
  const t = readSecret(RADAR_TOKEN_ENV);
  if (!t) throw new Error(`${RADAR_TOKEN_ENV} is not set`);
  return t;
}

async function radarJson(ctx: AdapterContext<unknown>, path: string, auth: string): Promise<Record<string, unknown>> {
  const res = await ctx.fetch(`${RADAR_API}${path}`, undefined, { Authorization: `Bearer ${auth}` });
  if (res.kind !== 'ok') throw new Error(`Cloudflare Radar ${path.split('?')[0]}: no content`);
  const doc = JSON.parse(res.body) as { success?: boolean; result?: Record<string, unknown>; errors?: unknown; result_info?: Record<string, unknown> };
  if (doc.success === false || !doc.result) throw new Error(`Cloudflare Radar error: ${truncate(JSON.stringify(doc.errors ?? 'no result'), 200)}`);
  return { ...doc.result, __info: doc.result_info ?? {} };
}

// ------------------------------------------------------------- routing ---

export interface BgpState {
  hijacks: BgpHijack[];
  leaks: BgpLeak[];
  fetchedAt: string;
  firstRunAt: string;
}

function asnIndex(result: Record<string, unknown>): Map<number, { org: string | null; country: string | null }> {
  const m = new Map<number, { org: string | null; country: string | null }>();
  for (const a of Array.isArray(result.asn_info) ? result.asn_info : []) {
    const r = a as Record<string, unknown>;
    const asn = num(r.asn);
    if (asn != null) m.set(asn, { org: typeof r.org_name === 'string' ? cleanText(r.org_name).slice(0, 80) || null : null, country: iso2(r.country_code) });
  }
  return m;
}

const net = (asn: number, idx: Map<number, { org: string | null; country: string | null }>, country?: string | null): BgpNetwork => ({
  asn,
  org: idx.get(asn)?.org ?? null,
  country: country ?? idx.get(asn)?.country ?? null,
});

export function parseHijacks(result: Record<string, unknown>): BgpHijack[] {
  const idx = asnIndex(result);
  const out: BgpHijack[] = [];
  for (const raw of Array.isArray(result.events) ? result.events : []) {
    const e = raw as Record<string, unknown>;
    const id = num(e.id);
    const from = radarIso(e.min_hijack_ts);
    const hijackerAsn = num(e.hijacker_asn);
    const confidence = num(e.confidence_score);
    if (id == null || !from || hijackerAsn == null || confidence == null) continue;
    const victimAsns = (Array.isArray(e.victim_asns) ? e.victim_asns : []).map(num).filter((x): x is number => x != null);
    const victimCountries = [...new Set((Array.isArray(e.victim_countries) ? e.victim_countries : []).map(iso2).filter((x): x is string => !!x))];
    const prefixes = (Array.isArray(e.prefixes) ? e.prefixes : []).filter((p): p is string => typeof p === 'string' && /^[0-9a-fA-F:.]+\/\d{1,3}$/.test(p));
    out.push({
      id,
      from,
      to: radarIso(e.max_hijack_ts),
      confidence,
      hijacker: net(hijackerAsn, idx, iso2(e.hijacker_country)),
      victims: victimAsns.slice(0, 10).map((a) => net(a, idx)),
      victimCountries,
      prefixes: prefixes.slice(0, 10),
      prefixCount: prefixes.length,
      stale: e.is_stale === true,
      tags: (Array.isArray(e.tags) ? e.tags : []).map((t) => (t && typeof t === 'object' ? String((t as Record<string, unknown>).name ?? '') : '')).filter(Boolean).slice(0, 6),
    });
  }
  return out;
}

export function parseLeaks(result: Record<string, unknown>): BgpLeak[] {
  const idx = asnIndex(result);
  const out: BgpLeak[] = [];
  for (const raw of Array.isArray(result.events) ? result.events : []) {
    const e = raw as Record<string, unknown>;
    const id = num(e.id);
    const at = radarIso(e.detected_ts) ?? radarIso(e.min_ts);
    const leakAsn = num(e.leak_asn);
    if (id == null || !at || leakAsn == null) continue;
    out.push({
      id,
      at,
      leaker: net(leakAsn, idx),
      countries: [...new Set((Array.isArray(e.countries) ? e.countries : []).map(iso2).filter((x): x is string => !!x))],
      prefixCount: num(e.prefix_count) ?? 0,
      originCount: num(e.origin_count) ?? 0,
      peerCount: num(e.peer_count) ?? 0,
      finished: e.finished === true,
    });
  }
  return out;
}

export const hijackCountries = (h: BgpHijack) => [...new Set([h.hijacker.country, ...h.victimCountries].filter((c): c is string => !!c))];
export const leakCountries = (l: BgpLeak) => [...new Set([l.leaker.country, ...l.countries].filter((c): c is string => !!c))];
const involvesWatch = (cs: string[]) => cs.some((c) => watched.has(c));

export function hijackRecord(h: BgpHijack, nowIso: string): IntelligenceEvent {
  const cs = hijackCountries(h).filter((c) => watched.has(c));
  const victims = h.victims.slice(0, 3).map(asnLabel).join(', ') || 'networks not named';
  const key = contentHash(BGP_SOURCE_ID, 'hijack', String(h.id));
  return {
    id: key,
    contentHash: key,
    dataOrigin: 'live',
    sourceId: BGP_SOURCE_ID,
    sourceName: 'Cloudflare Radar — route hijacks',
    sourceClass: 'scientific',
    sourceUrl: `https://radar.cloudflare.com/as${h.hijacker.asn}`,
    title: truncate(`Route hijack: ${asnLabel(h.hijacker)} announced ${h.prefixCount} address block${h.prefixCount === 1 ? '' : 's'} of ${victims}`, LIMITS.title),
    summary: truncate(
      `Cloudflare Radar detected a route hijack (confidence ${h.confidence} of 10): ${asnLabel(h.hijacker)} announced ${h.prefixes.slice(0, 4).join(', ')}${h.prefixCount > 4 ? ' and more' : ''}, ` +
        `which belong to ${victims}${h.victimCountries.length ? ` (${h.victimCountries.join(', ')})` : ''}. Seen from ${h.from}${h.to ? ` to ${h.to}` : ''}. ` +
        'Traffic for those addresses could be diverted, intercepted or dropped. Hijacks are also caused by misconfiguration; the detection does not say which.',
      LIMITS.summary,
    ),
    category: 'cyber',
    regionIds: [...new Set(cs.flatMap(regionsForCountry))],
    countryCodes: cs,
    publishedAt: h.from,
    occurredAt: h.from,
    collectedAt: nowIso,
    credibility: 'single-source',
    verificationStatus: 'unreviewed',
    locationPrecision: cs.length ? 'country' : 'none',
    metadata: { subtype: 'bgp-hijack', radarId: h.id, confidence: h.confidence, hijackerAsn: h.hijacker.asn, victimAsns: h.victims.map((v) => v.asn), geoBasis: 'source-country (network registration)', licence: LICENCE },
  };
}

export function leakRecord(l: BgpLeak, nowIso: string): IntelligenceEvent {
  const cs = leakCountries(l).filter((c) => watched.has(c));
  const key = contentHash(BGP_SOURCE_ID, 'leak', String(l.id));
  return {
    id: key,
    contentHash: key,
    dataOrigin: 'live',
    sourceId: BGP_SOURCE_ID,
    sourceName: 'Cloudflare Radar — route leaks',
    sourceClass: 'scientific',
    sourceUrl: `https://radar.cloudflare.com/as${l.leaker.asn}`,
    title: truncate(`Route leak by ${asnLabel(l.leaker)}: ${l.prefixCount} address blocks rerouted`, LIMITS.title),
    summary: truncate(
      `Cloudflare Radar detected a route leak at ${l.at}: ${asnLabel(l.leaker)} passed on routes for ${l.prefixCount} address blocks from ${l.originCount} networks to ${l.peerCount} peers, ` +
        `involving ${leakCountries(l).join(', ') || 'countries not stated'}. Leaks are usually configuration mistakes; they can send traffic the long way round or through networks that should not carry it.`,
      LIMITS.summary,
    ),
    category: 'cyber',
    regionIds: [...new Set(cs.flatMap(regionsForCountry))],
    countryCodes: cs,
    publishedAt: l.at,
    occurredAt: l.at,
    collectedAt: nowIso,
    credibility: 'single-source',
    verificationStatus: 'unreviewed',
    locationPrecision: cs.length ? 'country' : 'none',
    metadata: { subtype: 'bgp-leak', radarId: l.id, prefixes: l.prefixCount, routine: l.prefixCount < LEAK_NOTABLE_PREFIXES, geoBasis: 'source-country (network registration)', licence: LICENCE },
  };
}

async function pages(ctx: AdapterContext<unknown>, path: string, auth: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await radarJson(ctx, `${path}&page=${page}&per_page=${PAGE}`, auth);
    out.push(r);
    const events = Array.isArray(r.events) ? r.events.length : 0;
    const total = num((r.__info as Record<string, unknown>).total_count) ?? 0;
    if (events < PAGE || page * PAGE >= total) break;
  }
  return out;
}

export const radarBgp: SourceAdapter<BgpState> = {
  sourceId: BGP_SOURCE_ID,
  requiredEnv: [RADAR_TOKEN_ENV],
  async collect(ctx) {
    const prev = ctx.state;
    if (prev && ctx.now - Date.parse(prev.fetchedAt) < BGP_EVERY_MS) return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: prev };
    const auth = token();
    const nowIso = new Date(ctx.now).toISOString();
    const range = prev ? '2d' : '7d';
    const hj = (await pages(ctx as AdapterContext<unknown>, `/bgp/hijacks/events?dateRange=${range}&minConfidence=${HIJACK_MIN_CONFIDENCE}&sortBy=TIME&sortOrder=DESC&format=JSON`, auth)).flatMap(parseHijacks);
    const lk = (await pages(ctx as AdapterContext<unknown>, `/bgp/leaks/events?dateRange=${range}&sortBy=TIME&sortOrder=DESC&format=JSON`, auth)).flatMap(parseLeaks);
    const hijacks = hj.filter((h) => involvesWatch(hijackCountries(h)));
    const leaks = lk.filter((l) => involvesWatch(leakCountries(l)));
    const keep = <T extends { id: number }>(now: T[], before: T[], at: (x: T) => string) => {
      const ids = new Set(now.map((x) => x.id));
      return [...now, ...before.filter((x) => !ids.has(x.id))].filter((x) => ctx.now - Date.parse(at(x)) <= KEEP_MS).sort((a, b) => at(b).localeCompare(at(a))).slice(0, 100);
    };
    const events = [...hijacks.map((h) => hijackRecord(h, nowIso)), ...leaks.map((l) => leakRecord(l, nowIso))];
    return {
      events,
      rejected: [],
      itemsSeen: hj.length + lk.length,
      notModified: false,
      state: {
        hijacks: keep(hijacks, prev?.hijacks ?? [], (h) => h.from),
        leaks: keep(leaks, prev?.leaks ?? [], (l) => l.at),
        fetchedAt: nowIso,
        firstRunAt: prev?.firstRunAt ?? nowIso,
      },
    };
  },
};

// ----------------------------------------------------------------- DDoS ---

export interface DdosState {
  fetchedAt: string;
  /** Day (YYYY-MM-DD) the last complete value belongs to. */
  day: string;
  countries: DdosCountry[];
  noData: string[];
}

/** Daily series from a Radar timeseries result: serie_0 (or the first serie_*), without today's partial day. */
export function parseDaily(result: Record<string, unknown>, now: number): { days: string[]; values: number[] } {
  const key = 'serie_0' in result ? 'serie_0' : Object.keys(result).find((k) => k.startsWith('serie'));
  const s = key ? (result[key] as Record<string, unknown>) : null;
  const ts = Array.isArray(s?.timestamps) ? s!.timestamps : [];
  const vs = Array.isArray(s?.values) ? s!.values : [];
  const today = new Date(now).toISOString().slice(0, 10);
  const days: string[] = [];
  const values: number[] = [];
  ts.forEach((t, i) => {
    const d = radarIso(t)?.slice(0, 10);
    const v = num(vs[i]);
    if (!d || v == null || d >= today) return;
    days.push(d);
    values.push(v);
  });
  return { days, values };
}

export function scoreDdos(country: string, days: string[], values: number[]): DdosCountry | null {
  if (!values.length) return null;
  const latest = values[values.length - 1];
  // Cloudflare's values are scaled 0–1; the anomaly floor assumes larger numbers, so score them with
  // the earlier days' median as 100 (the score and ratio do not depend on the scale).
  const earlier = values.slice(0, -1);
  const med = median(earlier.filter((v) => v > 0));
  const k = Number.isFinite(med) && med > 0 ? 100 / med : 1;
  const raw = compare(latest * k, earlier.map((v) => v * k), { kind: 'measure' });
  const a = { ...raw, centre: raw.centre == null ? null : raw.centre / k };
  const r2 = (x: number) => Math.round(x * 1000) / 1000;
  return {
    country,
    values: values.map(r2),
    day: days[days.length - 1],
    latest: r2(latest),
    centre: a.centre == null ? null : r2(a.centre),
    score: a.score,
    ratio: a.centre && a.centre > 0 ? Math.round((latest / a.centre) * 10) / 10 : null,
  };
}

export function ddosRecord(c: DdosCountry, nowIso: string): IntelligenceEvent {
  const key = contentHash(DDOS_SOURCE_ID, c.country, c.day);
  return {
    id: key,
    contentHash: key,
    dataOrigin: 'live',
    sourceId: DDOS_SOURCE_ID,
    sourceName: 'Cloudflare Radar — DDoS attacks',
    sourceClass: 'scientific',
    sourceUrl: `https://radar.cloudflare.com/${c.country.toLowerCase()}`,
    title: truncate(`DDoS surge: network-layer attacks on targets in ${c.country} at ${c.ratio}× the usual level on ${c.day}`, LIMITS.title),
    summary: truncate(
      `Attack traffic that Cloudflare's network saw aimed at targets in ${c.country} on ${c.day} was ${c.ratio}× the median of the previous ${c.values.length - 1} days (${c.score} typical spreads above normal). ` +
        'Cloudflare only sees attacks on networks it protects, so this is a sample of attacks on the country, not a total; it does not say who attacked.',
      LIMITS.summary,
    ),
    category: 'cyber',
    regionIds: regionsForCountry(c.country),
    countryCodes: [c.country],
    publishedAt: `${c.day}T23:59:00.000Z`,
    occurredAt: `${c.day}T12:00:00.000Z`,
    collectedAt: nowIso,
    credibility: 'single-source',
    verificationStatus: 'unreviewed',
    locationPrecision: 'country',
    metadata: { subtype: 'ddos-surge', ratio: c.ratio, score: c.score, day: c.day, geoBasis: 'source-country (attack target)', licence: LICENCE },
  };
}

export const radarDdos: SourceAdapter<DdosState> = {
  sourceId: DDOS_SOURCE_ID,
  requiredEnv: [RADAR_TOKEN_ENV],
  async collect(ctx) {
    const prev = ctx.state;
    const yesterday = new Date(ctx.now - 86_400_000).toISOString().slice(0, 10);
    // Daily values: once yesterday is complete and read, nothing changes until tomorrow.
    if (prev && prev.day >= yesterday) return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: prev };
    const auth = token();
    const nowIso = new Date(ctx.now).toISOString();
    const countries: DdosCountry[] = [];
    const noData: string[] = [];
    let failures = 0;
    let lastError = '';
    for (const cc of NET_WATCH_COUNTRIES) {
      try {
        const r = await radarJson(ctx as AdapterContext<unknown>, `/attacks/layer3/timeseries?location=${cc}&direction=TARGET&dateRange=${DDOS_DAYS + 1}d&aggInterval=1d&format=JSON`, auth);
        const { days, values } = parseDaily(r, ctx.now);
        const scored = scoreDdos(cc, days, values);
        if (scored) countries.push(scored);
        else noData.push(cc);
      } catch (err) {
        failures++;
        lastError = err instanceof Error ? err.message : String(err);
        noData.push(cc);
      }
    }
    if (failures === NET_WATCH_COUNTRIES.length) throw new Error(`No country could be read: ${truncate(lastError, 200)}`);
    const day = countries.reduce((d, c) => (c.day > d ? c.day : d), '');
    const events = countries
      .filter((c) => c.day === day && c.score != null && c.score >= VERY_UNUSUAL && (c.ratio ?? 0) >= DDOS_MIN_RATIO)
      .map((c) => ddosRecord(c, nowIso));
    return { events, rejected: [], itemsSeen: countries.length, notModified: false, state: { fetchedAt: nowIso, day: day || yesterday, countries, noData } };
  },
};
