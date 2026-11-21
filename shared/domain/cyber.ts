/**
 * Cyber (Phase 20): the CYBER page's data, built by the collector from what it already holds so the page
 * does not depend on which records fit in the feed snapshot.
 *  - Known exploited vulnerabilities added to CISA's catalog in the last 30 days, with FIRST EPSS scores
 *    (the modelled probability of exploitation activity in the next 30 days).
 *  - CISA alerts and advisories (30 days), split into alerts/joint advisories and routine ICS advisories.
 *  - National cyber agencies: UK NCSC, Canadian Centre for Cyber Security, JPCERT/CC, CERT-UA (30 days).
 *  - Internet disruptions with a stated cause (Cloudflare Radar) and IODA outages (7 days).
 */
import type { IntelligenceEvent } from './types.ts';

export interface KevItem {
  cve: string;
  vendor: string;
  product: string;
  name: string;
  /** YYYY-MM-DD */
  added: string;
  /** Federal remediation due date (YYYY-MM-DD), if given. */
  due: string | null;
  ransomware: boolean;
  /** FIRST EPSS probability (0–1) and percentile (0–1), if scored. */
  epss: number | null;
  percentile: number | null;
}

export interface CyberItem {
  title: string;
  url: string;
  at: string;
  /** Publisher label (agency or CISA product type). */
  label: string;
  /** For CISA: routine ICS/medical advisories, KEV announcements and guidance. */
  routine?: boolean;
  /** For outages: Cloudflare's stated cause, scope, and whether still ongoing. */
  cause?: string | null;
  ongoing?: boolean;
}

export interface CyberSnapshot {
  computedAt: string;
  kev: KevItem[];
  advisories: CyberItem[];
  agencies: CyberItem[];
  outages: CyberItem[];
  /** When EPSS scores were last fetched. */
  epssAt: string | null;
  simulated?: boolean;
}

export const AGENCY_SOURCES: Record<string, string> = {
  'ncsc-uk': 'UK NCSC',
  'cccs-canada': 'Canadian Centre for Cyber Security',
  'jpcert': 'JPCERT/CC',
  'cert-ua': 'CERT-UA (Ukraine)',
};

const CISA_LABEL: Record<string, string> = {
  alert: 'Alert',
  'joint-advisory': 'Joint advisory',
  'analysis-report': 'Analysis report',
  'ics-advisory': 'ICS advisory',
  'ics-medical-advisory': 'ICS medical advisory',
  'kev-announcement': 'KEV announcement',
  guidance: 'Guidance',
  other: 'Advisory',
};

const DAY = 86_400_000;
const at = (e: IntelligenceEvent) => e.publishedAt ?? e.collectedAt;
const meta = (e: IntelligenceEvent, k: string) => (e.metadata ?? {})[k];

/** Builds the page data from loaded records, the KEV catalog's recent entries and EPSS scores. Pure. */
export function buildCyberSnapshot(
  events: IntelligenceEvent[],
  kevRecent: Omit<KevItem, 'epss' | 'percentile'>[],
  epss: Record<string, [number, number]>,
  epssAt: string | null,
  now: number,
): CyberSnapshot {
  const since = (days: number) => (e: IntelligenceEvent) => Date.parse(at(e)) >= now - days * DAY;
  const item = (e: IntelligenceEvent, label: string, extra: Partial<CyberItem> = {}): CyberItem => ({ title: e.title, url: e.sourceUrl, at: at(e), label, ...extra });
  const newest = (a: CyberItem, b: CyberItem) => b.at.localeCompare(a.at);
  const kev = kevRecent
    .filter((k) => Date.parse(`${k.added}T00:00:00Z`) >= now - 30 * DAY)
    .map((k) => ({ ...k, epss: epss[k.cve]?.[0] ?? null, percentile: epss[k.cve]?.[1] ?? null }))
    .sort((a, b) => b.added.localeCompare(a.added) || (b.epss ?? 0) - (a.epss ?? 0));
  const advisories = events
    .filter((e) => e.sourceId === 'cisa-advisories' && since(30)(e))
    .map((e) => item(e, CISA_LABEL[String(meta(e, 'subtype'))] ?? 'Advisory', { routine: meta(e, 'routine') === true }))
    .sort(newest)
    .slice(0, 80);
  const agencies = events
    .filter((e) => e.sourceId in AGENCY_SOURCES && since(30)(e))
    .map((e) => item(e, AGENCY_SOURCES[e.sourceId]))
    .sort(newest)
    .slice(0, 40);
  const outages = events
    .filter((e) => (e.sourceId === 'cloudflare-radar-outages' || e.sourceId === 'ioda-outages') && since(7)(e))
    .map((e) =>
      item(e, e.sourceId === 'cloudflare-radar-outages' ? 'Cloudflare Radar' : 'IODA', {
        cause: (meta(e, 'outageCause') as string | null | undefined) ?? null,
        ongoing: e.sourceId === 'cloudflare-radar-outages' ? !meta(e, 'endedAt') : meta(e, 'ongoingAtCollection') === true,
      }),
    )
    .sort(newest)
    .slice(0, 40);
  return { computedAt: new Date(now).toISOString(), kev, advisories, agencies, outages, epssAt };
}

export const CAUSE_LABEL: Record<string, string> = {
  GOVERNMENT_DIRECTED: 'government order',
  MILITARY_ACTION: 'military action',
  CYBERATTACK: 'cyberattack',
  CABLE_CUT: 'cable cut',
  POWER_OUTAGE: 'power outage',
  NATURAL_DISASTER: 'natural disaster',
  WEATHER: 'weather',
  FIRE: 'fire',
  BLOCKING: 'blocking',
  MAINTENANCE: 'maintenance',
  TECHNICAL_PROBLEM: 'technical problem',
  NETWORK_PROBLEM: 'network problem',
  UNKNOWN: 'cause unknown',
};
