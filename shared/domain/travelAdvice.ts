import type { IntelligenceEvent } from './types.ts';

/**
 * Travel advice from several governments (v0.83.0): the US State Department and the UK FCDO (earlier
 * releases), Canada's Global Affairs (open data, levels 0–3) and US CDC travel health notices (levels 1–4).
 *
 * A raise by two or more governments for the same country within JOINT_WINDOW_HOURS is a JOINT RAISE: a
 * government raises its advice on information it often cannot publish, and several doing so within days
 * is a stronger signal than any one. Two governments is WATCH, three STRONG. Governments share
 * information, so a joint raise is agreement, not independent proof.
 */

export const JOINT_WINDOW_HOURS = 72;

export const CANADA_TRAVEL_SOURCE_ID = 'canada-travel-advisories';
export const CDC_SOURCE_ID = 'cdc-travel-notices';
export const US_TRAVEL_SOURCE_ID = 'state-travel-advisories';
export const UK_TRAVEL_SOURCE_ID = 'uk-fcdo-travel';

/** Canada's four levels (advisory-state 0–3). */
export const CANADA_LEVEL_LABEL = ['Take normal security precautions', 'Exercise a high degree of caution', 'Avoid non-essential travel', 'Avoid all travel'] as const;

export const GOVERNMENT_LABEL: Record<string, string> = {
  [US_TRAVEL_SOURCE_ID]: 'United States',
  [UK_TRAVEL_SOURCE_ID]: 'United Kingdom',
  [CANADA_TRAVEL_SOURCE_ID]: 'Canada',
};

/** FCDO publishes no levels; its change note says when it now advises against travel. */
const FCDO_RAISE = /\b(now advises?|advising|advise) against (all|all but essential) travel\b/i;

/** True when a record is a government raising its travel advice (US or Canada level up; FCDO "now advises against"). */
export function isAdviceRaise(e: IntelligenceEvent): boolean {
  if (e.sourceId === US_TRAVEL_SOURCE_ID || e.sourceId === CANADA_TRAVEL_SOURCE_ID) return e.metadata?.change === 'raised';
  if (e.sourceId === UK_TRAVEL_SOURCE_ID) return FCDO_RAISE.test(String(e.metadata?.changeNote ?? '')) && !/\bno longer\b/i.test(String(e.metadata?.changeNote ?? ''));
  return false;
}

export interface JointRaise {
  country: string;
  /** Source ids of the governments that raised, sorted. */
  governments: string[];
  level: 'watch' | 'strong';
  first: string;
  last: string;
  eventIds: string[];
  titles: string[];
}

export function findJointRaises(events: IntelligenceEvent[], now: number): JointRaise[] {
  const from = now - JOINT_WINDOW_HOURS * 3_600_000;
  const by = new Map<string, IntelligenceEvent[]>();
  for (const e of events) {
    const t = Date.parse(e.publishedAt ?? e.collectedAt);
    if (!(t >= from && t <= now + 3_600_000) || !isAdviceRaise(e)) continue;
    for (const c of e.countryCodes) by.set(c, [...(by.get(c) ?? []), e]);
  }
  const out: JointRaise[] = [];
  for (const [country, es] of by) {
    const governments = [...new Set(es.map((e) => e.sourceId))].sort();
    if (governments.length < 2) continue;
    const times = es.map((e) => e.publishedAt ?? e.collectedAt).sort();
    out.push({
      country,
      governments,
      level: governments.length >= 3 ? 'strong' : 'watch',
      first: times[0],
      last: times[times.length - 1],
      eventIds: es.map((e) => e.id),
      titles: es.map((e) => e.title),
    });
  }
  return out.sort((a, b) => b.governments.length - a.governments.length || b.last.localeCompare(a.last));
}

/** One government's current advice for a country, for the region page table. */
export interface GovernmentAdvice {
  /** US 1–4, Canada 0–3; null for the FCDO (no levels). */
  level: number | null;
  label: string;
  at: string | null;
  url: string | null;
}
export interface CountryAdvice {
  country: string;
  us?: GovernmentAdvice;
  ca?: GovernmentAdvice;
  uk?: GovernmentAdvice;
  /** CDC notices naming the country, level 1–4, newest first. */
  cdc?: { level: number; title: string; at: string | null; url: string }[];
}
export interface TravelAdviceSnapshot {
  generatedAt: string;
  countries: CountryAdvice[];
  joint: JointRaise[];
  simulated?: boolean;
}

/** Parses a CDC notice title: "Level 2 - Yellow Fever in Burkina Faso, Côte d’Ivoire, and Ghana". */
export function parseCdcTitle(title: string): { level: number; disease: string; places: string[] } | null {
  const m = /^\s*Level\s+([1-4])\s*[-–—]\s*(.+?)\s*$/i.exec(title);
  if (!m) return null;
  const rest = m[2];
  const i = rest.search(/\s+in\s+(?=[A-Z])/);
  const disease = (i >= 0 ? rest.slice(0, i) : rest).trim();
  const where = i >= 0 ? rest.slice(i).replace(/^\s+in\s+/, '') : '';
  const places = where
    .replace(/^the\s+/i, '')
    .split(/,\s*(?:and\s+)?|\s+and\s+/)
    .map((p) => p.replace(/^the\s+/i, '').trim())
    .filter(Boolean);
  return { level: Number(m[1]), disease, places };
}

/** Inputs for the region-page table: each government's latest known advice per watch-region country. */
export interface TravelAdviceInputs {
  /** US advisories from the State Department adapter's state (keyed by advisory URL). */
  us: Record<string, { name: string; iso: string | null; level: number; publishedAt: string | null }>;
  /** Canada levels from its adapter's state. */
  ca: Record<string, { level: number; publishedAt: string | null }>;
  /** Recent records (FCDO updates and CDC notices are read from these). */
  events: IntelligenceEvent[];
  /** Countries to include (the watch regions' countries). */
  countries: string[];
  joint: JointRaise[];
  now: number;
}

const US_LEVEL_LABEL = ['', 'Exercise normal precautions', 'Exercise increased caution', 'Reconsider travel', 'Do not travel'];

export function buildTravelAdvice(i: TravelAdviceInputs): TravelAdviceSnapshot {
  const out: CountryAdvice[] = [];
  const recent = (sourceId: string) => i.events.filter((e) => e.sourceId === sourceId).sort((a, b) => (b.publishedAt ?? b.collectedAt).localeCompare(a.publishedAt ?? a.collectedAt));
  const uk = recent(UK_TRAVEL_SOURCE_ID);
  const cdc = recent(CDC_SOURCE_ID);
  for (const country of [...new Set(i.countries)].sort()) {
    const row: CountryAdvice = { country };
    const usHit = Object.entries(i.us).find(([, a]) => a.iso === country);
    if (usHit) row.us = { level: usHit[1].level, label: US_LEVEL_LABEL[usHit[1].level] ?? '', at: usHit[1].publishedAt, url: usHit[0] };
    const ca = i.ca[country];
    if (ca) row.ca = { level: ca.level, label: CANADA_LEVEL_LABEL[ca.level] ?? '', at: ca.publishedAt, url: null };
    const ukHit = uk.find((e) => e.countryCodes.includes(country));
    if (ukHit) row.uk = { level: null, label: String(ukHit.metadata?.changeNote ?? 'Updated').slice(0, 160), at: ukHit.publishedAt, url: ukHit.sourceUrl };
    const notices = cdc.filter((e) => e.countryCodes.includes(country)).slice(0, 3);
    if (notices.length) row.cdc = notices.map((e) => ({ level: Number(e.metadata?.advisoryLevel ?? 0), title: e.title, at: e.publishedAt, url: e.sourceUrl }));
    if (row.us || row.ca || row.uk || row.cdc) out.push(row);
  }
  return { generatedAt: new Date(i.now).toISOString(), countries: out, joint: i.joint };
}
