import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { WATCH_REGIONS, regionsForCountry } from '../../shared/domain/regions.ts';
import { matchGazetteer } from '../../shared/domain/geo/gazetteer.ts';
import { parseFeed } from '../lib/feed.ts';
import { parseFeedDate } from '../lib/dates.ts';
import { contentHash } from '../lib/hash.ts';
import { LIMITS, cleanText, decodeEntities, safeUrl, truncate } from '../lib/text.ts';
import type { Validators } from '../lib/http.ts';
import type { AdapterContext, AdapterResult, SourceAdapter } from './types.ts';

export const DOD_CONTRACTS_SOURCE_ID = 'dod-contracts';
export const DOD_CONTRACTS_FEED = 'https://www.war.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=400&Site=945&max=10';
const HTML = { Accept: 'text/html,application/xhtml+xml' };

/** Thresholds for recording an award (the daily list holds every award of $7.5 million or more). */
export const LARGE_AWARD_USD = 1_000_000_000;
export const MUNITIONS_AWARD_USD = 100_000_000;

export const MUNITIONS_RE =
  /\b(missiles?|munitions?|ammunition|artillery|projectiles?|warheads?|rocket motors?|solid rocket|interceptors?|torpedo(?:es)?|bombs?|155\s?mm|Patriot|PAC-3|Standard Missile|SM-[236]|Tomahawk|JASSM|LRASM|AMRAAM|GMLRS|HIMARS|Javelin|Stinger|THAAD|Trident|Hellfire|JDAM|PrSM|NASAMS|Sentinel ICBM)\b/i;

/** Partner countries whose FMS awards are recorded: countries of the foreign watch regions. */
const PARTNERS = new Set(WATCH_REGIONS.filter((r) => r.id !== 'united-states').flatMap((r) => r.countryCodes));

export interface Award {
  service: string;
  contractor: string;
  amountUsd: number | null;
  purpose: string;
  contractNumber: string | null;
  munitions: boolean;
  /** The amount is a ceiling (IDIQ maximum, not-to-exceed), not money obligated. */
  ceiling: boolean;
  /** ISO alpha-2 of Foreign Military Sales customers named in the award. */
  fmsCountries: string[];
  text: string;
}

const money = (s: string) => {
  const digits = s.replace(/[^\d.,]/g, '').replace(/,/g, '');
  const n = Number(digits.includes('.') && digits.split('.').length > 2 ? digits.replace(/\./g, '') : digits);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

/** Splits one day's contracts page into awards (paragraphs with an amount), keeping the service heading. */
export function parseContractsDay(html: string): Award[] {
  const body = /<div class="body">([\s\S]*?)<\/div>\s*<\/div>/.exec(html)?.[1];
  if (!body) throw new Error('DoD contracts: page body not found');
  const awards: Award[] = [];
  let service = '';
  for (const m of body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)) {
    const text = cleanText(decodeEntities(m[1].replace(/<[^>]+>/g, ' ')));
    if (!text) continue;
    if (/^[A-Z.&\s-]{3,60}$/.test(text)) {
      service = text.replace(/\s+/g, ' ').trim();
      continue;
    }
    if (!text.includes('$')) continue;
    // The awarded amount: "awarded a(n) ($)…", "maximum $…", "not to exceed amount of $…", else the first amount.
    const amountMatch =
      /(?:awarded|awards?)\b[^$]{0,160}?\$\s?([\d,]+(?:\.\d+)*)/.exec(text) ?? /\$\s?([\d,]+(?:\.\d+)*)/.exec(text);
    const multi = (text.match(/\([A-Z0-9-]{8,}\)/g) ?? []).length > 2 && /\bwere awarded|have been awarded|are awarded\b/.test(text);
    const contractor = multi ? `${(text.match(/\([A-Z0-9-]{8,}\)/g) ?? []).length} companies (multiple-award)` : text.split(',')[0].trim();
    const afterAmount = amountMatch ? text.slice((amountMatch.index ?? 0) + amountMatch[0].length) : text;
    let purpose = /\b(?:contract|modification|order)?[^.]{0,120}?\bfor (?:the )?([^.;]{3,160})/.exec(afterAmount)?.[1]?.trim() ?? '';
    // "for fiscal 2027 Navy and FMS production" names funding, not the item.
    if (/^fiscal \d{4}\b/i.test(purpose)) purpose = '';
    const fmsSentences = text.split(/(?<=\.)\s+/).filter((s) => /Foreign Military Sales|\bFMS\b/i.test(s));
    const fmsCountries = [...new Set(fmsSentences.flatMap((s) => matchGazetteer(s.replace(/Republic of Korea/g, 'South Korea')).countryCodes))].filter((c) => c !== 'US');
    awards.push({
      service,
      contractor: truncate(contractor, 120),
      amountUsd: amountMatch ? money(amountMatch[1]) : null,
      purpose,
      contractNumber: /\(([A-Z0-9]{2,}[A-Z0-9-]{6,})\)/.exec(text)?.[1] ?? null,
      // "Missile Range" (test ranges, range-instrumentation ships) is not a munition.
      munitions: MUNITIONS_RE.test(`${purpose} ${text.slice(0, 600)}`.replace(/missile (test )?rang\w*/gi, '')),
      // Judge the wording around the amount (multiple-award paragraphs start with long company lists).
      ceiling: /\b(maximum|not[- ]to[- ]exceed|ceiling|indefinite-delivery\/indefinite-quantity)\b/i.test(
        amountMatch ? text.slice(Math.max(0, (amountMatch.index ?? 0) - 120), (amountMatch.index ?? 0) + amountMatch[0].length + 200) : text.slice(0, 400),
      ),
      fmsCountries,
      text,
    });
  }
  return awards;
}

export function isNotable(a: Award): boolean {
  const amount = a.amountUsd ?? 0;
  return amount >= LARGE_AWARD_USD || (a.munitions && amount >= MUNITIONS_AWARD_USD) || a.fmsCountries.some((c) => PARTNERS.has(c));
}

const usd = (n: number | null) => (n === null ? 'undisclosed amount' : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : `$${Math.round(n / 1e6)}M`);
const titleCase = (t: string) => t.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bU\.s\./g, 'U.S.');

export function awardEvents(day: string, url: string, awards: Award[], nowIso: string): IntelligenceEvent[] {
  return awards.filter(isNotable).map((a) => {
    const partners = a.fmsCountries.filter((c) => PARTNERS.has(c));
    const regionIds = partners.length ? [...new Set(partners.flatMap(regionsForCountry))] : ['united-states'];
    const id = contentHash(DOD_CONTRACTS_SOURCE_ID, day, a.contractNumber ?? '', a.contractor, a.amountUsd ?? 0);
    const at = `${day}T21:00:00.000Z`;
    const tags = [a.munitions ? 'munitions' : null, partners.length ? `FMS: ${partners.join(', ')}` : null].filter(Boolean).join('; ');
    return {
      id,
      contentHash: id,
      dataOrigin: 'live' as const,
      sourceId: DOD_CONTRACTS_SOURCE_ID,
      sourceName: 'U.S. Department of War (DoD) — Contracts',
      sourceClass: 'official' as const,
      sourceUrl: url,
      title: truncate(`DoD contract: ${usd(a.amountUsd)}${a.ceiling ? ' ceiling' : ''} to ${a.contractor}${a.purpose ? ` for ${a.purpose}` : ''} (${a.service ? `${titleCase(a.service)}, ` : ''}${day})${tags ? ` [${tags}]` : ''}`, LIMITS.title),
      summary: truncate(a.text, LIMITS.summary),
      category: 'military' as const,
      regionIds,
      countryCodes: partners.length ? partners : ['US'],
      publishedAt: at,
      occurredAt: at,
      collectedAt: nowIso,
      credibility: 'official' as const,
      verificationStatus: 'unreviewed' as const,
      locationPrecision: 'country' as const,
      metadata: {
        subtype: 'dod-contract',
        amountUsd: a.amountUsd,
        ceiling: a.ceiling,
        munitions: a.munitions,
        fmsCountries: a.fmsCountries,
        service: a.service,
        contractNumber: a.contractNumber,
      },
    };
  });
}

export interface DodContractsState {
  validators?: Validators;
  processed: string[];
}

/**
 * DoD daily contract announcements (every award of $7.5 million or more). Reads the RSS every
 * run (conditional) and each new day's page once; records only notable awards: $1 billion or
 * more, munitions of $100 million or more, and Foreign Military Sales to watch-region partners.
 */
export const dodContracts: SourceAdapter<DodContractsState> = {
  sourceId: DOD_CONTRACTS_SOURCE_ID,
  async collect(ctx: AdapterContext<DodContractsState>): Promise<AdapterResult<DodContractsState>> {
    const prev = ctx.state;
    const res = await ctx.fetch(DOD_CONTRACTS_FEED, prev?.validators);
    if (res.kind === 'not-modified') return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: prev! };
    const nowIso = new Date(ctx.now).toISOString();
    const processed = new Set(prev?.processed ?? []);
    const items = parseFeed(res.body)
      .map((i) => ({ url: safeUrl(cleanText(i.link)), published: parseFeedDate(i.published), title: cleanText(i.title) }))
      .filter((i): i is { url: string; published: string; title: string } => !!i.url && !!i.published && /^Contracts for/i.test(i.title));
    // First run: the last 5 business days; later: any day not yet read.
    const todo = (prev ? items.filter((i) => !processed.has(i.url)) : items.slice(0, 5)).slice(0, 5);
    const events: IntelligenceEvent[] = [];
    let awardsSeen = 0;
    for (const item of todo) {
      const page = await ctx.fetch(item.url, undefined, HTML, { maxBytes: 4 * 1024 * 1024, timeoutMs: 45_000 });
      if (page.kind !== 'ok') continue;
      const awards = parseContractsDay(page.body);
      awardsSeen += awards.length;
      const day = new Date(Date.parse(item.published) - 5 * 3_600_000).toISOString().slice(0, 10); // US Eastern date
      events.push(...awardEvents(day, item.url, awards, nowIso));
      processed.add(item.url);
    }
    return { events, rejected: [], itemsSeen: awardsSeen, notModified: false, state: { validators: res.validators, processed: [...processed].slice(-40) } };
  },
};
