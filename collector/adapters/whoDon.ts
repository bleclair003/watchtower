import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { regionsForCountry } from '../../shared/domain/regions.ts';
import { matchGazetteer } from '../../shared/domain/geo/gazetteer.ts';
import { contentHash } from '../lib/hash.ts';
import { LIMITS, cleanText, htmlToText, truncate } from '../lib/text.ts';
import { unCountry } from './unsc.ts';
import type { AdapterContext, AdapterResult, SourceAdapter } from './types.ts';

export const WHO_DON_SOURCE_ID = 'who-don';
const FIELDS = 'Id,Title,OverrideTitle,UseOverrideTitle,PublicationDateAndTime,ItemDefaultUrl,DonId,Summary';
export const WHO_DON_URL = `https://www.who.int/api/news/diseaseoutbreaknews?sf_culture=en&$orderby=PublicationDateAndTime%20desc&$top=25&$select=${FIELDS}`;
const ITEM_BASE = 'https://www.who.int/emergencies/disease-outbreak-news/item';
export const WHO_EVERY_HOURS = 3;
const LOOKBACK_DAYS = 45;

/** Pathogens with high case fatality or pandemic potential, and clusters of unknown cause. */
export const HIGH_CONSEQUENCE =
  /\b(Ebola|Bundibugyo|Marburg|Lassa|Crimean-Congo|Nipah|MERS|Middle East respiratory|SARS|avian influenza|A\(H5|A\(H7|A\(H9|novel influenza|plague|smallpox|anthrax|undetermined etiology|unknown (cause|etiology)|Hantavirus)\b/i;

export interface DonItem {
  Id: string;
  Title?: string;
  OverrideTitle?: string | null;
  UseOverrideTitle?: boolean;
  PublicationDateAndTime?: string;
  ItemDefaultUrl?: string;
  DonId?: string | null;
  Summary?: string | null;
}

/** "Ebola disease … - Democratic Republic of the Congo, Kenya and Nigeria" → disease, places, ISO codes. */
export function splitDonTitle(title: string): { disease: string; place: string; countries: string[] } {
  const t = cleanText(title);
  const m = /^(.*?)\s*(?:\s[-–—]\s?|[-–—]\s|,\s(?=[A-Z][a-z]+(?:\s|$)))\s*(.+)$/.exec(t);
  const disease = m ? m[1].trim() : t;
  const place = m ? m[2].trim() : '';
  const parts = place
    .split(/,|&|\band\b/)
    .map((p) => p.replace(/^\s*(the|Kingdom of)\s+/i, '').trim())
    .filter(Boolean);
  const countries = new Set<string>();
  for (const p of parts) {
    const c = unCountry(p) ?? matchGazetteer(p).countryCodes[0] ?? null;
    if (c) countries.add(c);
  }
  return { disease, place, countries: [...countries] };
}

export function donEvents(items: DonItem[], nowMs: number): IntelligenceEvent[] {
  const nowIso = new Date(nowMs).toISOString();
  const since = new Date(nowMs - LOOKBACK_DAYS * 86_400_000).toISOString();
  return items.flatMap((d) => {
    const title = cleanText((d.UseOverrideTitle && d.OverrideTitle) || d.Title || '');
    const at = d.PublicationDateAndTime;
    if (!title || !at || !/^\d{4}-\d{2}-\d{2}T/.test(at) || at < since || !d.ItemDefaultUrl) return [];
    const { disease, place, countries } = splitDonTitle(title);
    const high = HIGH_CONSEQUENCE.test(title);
    const id = contentHash(WHO_DON_SOURCE_ID, d.DonId ?? d.Id);
    const published = new Date(Date.parse(at)).toISOString();
    return [{
      id,
      contentHash: id,
      dataOrigin: 'live' as const,
      sourceId: WHO_DON_SOURCE_ID,
      sourceName: 'World Health Organization — Disease Outbreak News',
      sourceClass: 'official' as const,
      sourceUrl: `${ITEM_BASE}${d.ItemDefaultUrl.startsWith('/') ? '' : '/'}${d.ItemDefaultUrl}`,
      title: truncate(`WHO outbreak report${high ? ' (high-consequence pathogen)' : ''}: ${disease}${place ? ` — ${place}` : ''}`, LIMITS.title),
      summary: truncate(`${htmlToText(d.Summary ?? '')}${d.DonId ? ` (${d.DonId})` : ''}`, LIMITS.summary) || undefined,
      category: 'disaster' as const,
      regionIds: [...new Set(countries.flatMap(regionsForCountry))],
      countryCodes: countries,
      publishedAt: published,
      occurredAt: null,
      collectedAt: nowIso,
      credibility: 'official' as const,
      verificationStatus: 'unreviewed' as const,
      locationPrecision: countries.length ? ('country' as const) : ('none' as const),
      metadata: { subtype: 'who-don', donId: d.DonId ?? null, disease, highConsequence: high },
    }];
  });
}

export interface WhoDonState {
  lastFetchedAt: string;
}

/** WHO Disease Outbreak News (official, free API), every 3 hours; 45 days back-filled. */
export const whoDiseaseOutbreakNews: SourceAdapter<WhoDonState> = {
  sourceId: WHO_DON_SOURCE_ID,
  async collect(ctx: AdapterContext<WhoDonState>): Promise<AdapterResult<WhoDonState>> {
    if (ctx.state && ctx.now - Date.parse(ctx.state.lastFetchedAt) < WHO_EVERY_HOURS * 3_600_000) {
      return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: ctx.state };
    }
    const res = await ctx.fetch(WHO_DON_URL, undefined, { Accept: 'application/json' });
    if (res.kind !== 'ok') throw new Error('WHO: unexpected 304');
    const body = JSON.parse(res.body) as { value?: DonItem[] };
    if (!Array.isArray(body.value)) throw new Error('WHO Disease Outbreak News: unexpected response');
    return { events: donEvents(body.value, ctx.now), rejected: [], itemsSeen: body.value.length, notModified: false, state: { lastFetchedAt: new Date(ctx.now).toISOString() } };
  },
};
