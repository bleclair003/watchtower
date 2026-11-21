import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { regionsForCountry } from '../../shared/domain/regions.ts';
import { matchGazetteer } from '../../shared/domain/geo/gazetteer.ts';
import { contentHash } from '../lib/hash.ts';
import { LIMITS, cleanText, safeUrl, truncate } from '../lib/text.ts';
import type { AdapterContext, AdapterResult, SourceAdapter } from './types.ts';

export const FEDREG_SOURCE_ID = 'federal-register';
const API = 'https://www.federalregister.gov/api/v1/documents.json';
const FIELDS = ['title', 'type', 'subtype', 'publication_date', 'signing_date', 'agencies', 'html_url', 'document_number', 'executive_order_number', 'abstract']
  .map((f) => `fields[]=${f}`)
  .join('&');
export const FEDREG_EVERY_HOURS = 2;
const LOOKBACK_DAYS = 30;

export const fedregQueries = (since: string) => ({
  presidential: `${API}?conditions[type][]=PRESDOCU&conditions[publication_date][gte]=${since}&per_page=100&order=newest&${FIELDS}`,
  exportControls: `${API}?conditions[agencies][]=industry-and-security-bureau&conditions[type][]=RULE&conditions[publication_date][gte]=${since}&per_page=50&order=newest&${FIELDS}`,
  terrorism: `${API}?conditions[agencies][]=state-department&conditions[term]=%22Terrorist%22&conditions[publication_date][gte]=${since}&per_page=50&order=newest&${FIELDS}`,
});

export interface FedRegDoc {
  title: string;
  type: string;
  subtype?: string | null;
  publication_date: string;
  signing_date?: string | null;
  agencies?: { slug?: string; name?: string }[];
  html_url: string;
  document_number: string;
  executive_order_number?: number | null;
  abstract?: string | null;
}

/** Presidential documents that concern security or foreign policy. */
export const SECURITY_RE =
  /\b(national emergency|national security|national defense|defense production|armed forces|military|sanction\w*|terror\w*|weapons|nuclear|missiles?|export controls?|Iran|Russia|China|Chinese|North Korea|Korea|Ukraine|Israel|Gaza|Syria|Lebanon|Yemen|Venezuela|Cuba|cartels?|invasion|cyber\w*|intelligence (community|activities|agenc\w+)|foreign intelligence|drawdown|foreign assistance|National Defense Authorization)\b/i;
/** Commemorative proclamations ("Patriot Day, 2026", "Anti-Communism Week, 2026") are not actions. */
const COMMEMORATIVE = /\b(Day|Week|Month|Year)\b,? \d{4}\b|\bDay \d{4}\b|\bAnniversary\b/;

export type FedRegKind = 'national-emergency-declared' | 'national-emergency-terminated' | 'executive-order' | 'presidential-action' | 'export-controls' | 'terrorist-designation' | 'terrorist-revocation';

export function classify(d: FedRegDoc, query: 'presidential' | 'exportControls' | 'terrorism'): FedRegKind | null {
  const t = d.title;
  if (query === 'exportControls') return 'export-controls';
  if (query === 'terrorism') {
    // Only actual designations or revocations, not procedural notices that mention them.
    if (/^(Revocation|Amendment)\b[^.]{0,40}\bDesignation\b/i.test(t) && /Terrorist/i.test(t)) return 'terrorist-revocation';
    if (/^(Foreign Terrorist Organization|Specially Designated Global Terrorist) Designations? of\b/i.test(t)) return 'terrorist-designation';
    return null;
  }
  if (/^Continuation of the National Emergency/i.test(t)) return null; // routine annual renewal
  if (/\b(Declaring|Declaration of) (a )?National Emergency\b/i.test(t)) return 'national-emergency-declared';
  if (/\bTermination of (the )?(National )?Emergency\b/i.test(t)) return 'national-emergency-terminated';
  if (d.subtype === 'Proclamation' && COMMEMORATIVE.test(t)) return null;
  if (!SECURITY_RE.test(t)) return null;
  return d.executive_order_number ? 'executive-order' : 'presidential-action';
}

const KIND_LABEL: Record<FedRegKind, string> = {
  'national-emergency-declared': 'NATIONAL EMERGENCY DECLARED',
  'national-emergency-terminated': 'National emergency terminated',
  'executive-order': 'Executive order',
  'presidential-action': 'Presidential action',
  'export-controls': 'Export controls (Commerce/BIS)',
  'terrorist-designation': 'Terrorist designation (State Department)',
  'terrorist-revocation': 'Terrorist designation revoked (State Department)',
};

export function fedregEvents(docs: { doc: FedRegDoc; kind: FedRegKind }[], nowMs: number): IntelligenceEvent[] {
  const nowIso = new Date(nowMs).toISOString();
  const today = nowIso.slice(0, 10);
  return docs.flatMap(({ doc: d, kind }) => {
    const url = safeUrl(d.html_url);
    if (!url || !/^\d{4}-\d{2}-\d{2}$/.test(d.publication_date)) return [];
    const title = cleanText(d.title);
    const abstract = cleanText(d.abstract ?? '');
    const countries = matchGazetteer(`${title} ${abstract}`).countryCodes.filter((c) => c !== 'US');
    // Documents appear on public inspection a few days before their publication date.
    const day = d.publication_date > today ? today : d.publication_date;
    const at = `${day}T12:00:00.000Z`;
    const id = contentHash(FEDREG_SOURCE_ID, d.document_number);
    const eo = d.executive_order_number ? ` ${d.executive_order_number}` : '';
    return [{
      id,
      contentHash: id,
      dataOrigin: 'live' as const,
      sourceId: FEDREG_SOURCE_ID,
      sourceName: 'Federal Register',
      sourceClass: 'official' as const,
      sourceUrl: url,
      title: truncate(`${KIND_LABEL[kind]}${kind === 'executive-order' ? eo : ''}: ${title}`, LIMITS.title),
      summary: truncate(
        `${abstract || title} Federal Register document ${d.document_number}, ${d.publication_date > today ? `to be published ${d.publication_date}` : `published ${d.publication_date}`}${d.signing_date ? `, signed ${d.signing_date}` : ''}.`,
        LIMITS.summary,
      ),
      category: kind === 'export-controls' ? ('economic' as const) : ('official' as const),
      regionIds: [...new Set(countries.flatMap(regionsForCountry))].filter((r) => r !== 'united-states'),
      countryCodes: countries,
      publishedAt: at,
      occurredAt: d.signing_date && /^\d{4}-\d{2}-\d{2}$/.test(d.signing_date) ? `${d.signing_date}T12:00:00.000Z` : null,
      collectedAt: nowIso,
      credibility: 'official' as const,
      verificationStatus: 'unreviewed' as const,
      locationPrecision: countries.length ? ('country' as const) : ('none' as const),
      metadata: { subtype: 'federal-register', fedregKind: kind, documentNumber: d.document_number, executiveOrder: d.executive_order_number ?? null },
    }];
  });
}

export interface FedRegState {
  lastFetchedAt: string;
}

/**
 * Federal Register (official journal of the US government): security-related presidential
 * documents, new or ended national emergencies, Commerce export-control rules, and State
 * Department terrorist designations. Free API, no key; three small queries every 2 hours.
 */
export const federalRegister: SourceAdapter<FedRegState> = {
  sourceId: FEDREG_SOURCE_ID,
  async collect(ctx: AdapterContext<FedRegState>): Promise<AdapterResult<FedRegState>> {
    if (ctx.state && ctx.now - Date.parse(ctx.state.lastFetchedAt) < FEDREG_EVERY_HOURS * 3_600_000) {
      return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: ctx.state };
    }
    const since = new Date(ctx.now - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
    const docs: { doc: FedRegDoc; kind: FedRegKind }[] = [];
    let seen = 0;
    for (const [query, url] of Object.entries(fedregQueries(since)) as ['presidential' | 'exportControls' | 'terrorism', string][]) {
      const res = await ctx.fetch(url, undefined, { Accept: 'application/json' });
      if (res.kind !== 'ok') continue;
      const body = JSON.parse(res.body) as { results?: FedRegDoc[]; errors?: unknown };
      if (!Array.isArray(body.results)) throw new Error(`Federal Register: unexpected response for ${query}`);
      seen += body.results.length;
      for (const d of body.results) {
        const kind = classify(d, query);
        if (kind) docs.push({ doc: d, kind });
      }
    }
    return { events: fedregEvents(docs, ctx.now), rejected: [], itemsSeen: seen, notModified: false, state: { lastFetchedAt: new Date(ctx.now).toISOString() } };
  },
};
