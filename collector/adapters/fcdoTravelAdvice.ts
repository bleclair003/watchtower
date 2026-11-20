import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { getSource } from '../../shared/domain/sources.ts';
import { regionsForCountry } from '../../shared/domain/regions.ts';
import { countryByName } from '../../shared/domain/geo/gazetteer.ts';
import { parseFeed } from '../lib/feed.ts';
import { parseFeedDate } from '../lib/dates.ts';
import { contentHash } from '../lib/hash.ts';
import { LIMITS, cleanText, htmlToText, safeUrl, truncate } from '../lib/text.ts';
import type { Validators } from '../lib/http.ts';
import { FIRST_RUN_LOOKBACK_DAYS, STEADY_LOOKBACK_DAYS, type AdapterContext, type AdapterResult, type SourceAdapter } from './types.ts';

const SOURCE_ID = 'uk-fcdo-travel';
const DAY = 86_400_000;

/** FCDO page names that differ from the gazetteer's names. */
const FCDO_NAMES: Record<string, string> = {
  usa: 'US',
  'the occupied palestinian territories': 'PS',
  'occupied palestinian territories': 'PS',
  'the gambia': 'GM',
  'congo': 'CG',
  'myanmar (burma)': 'MM',
  'south korea': 'KR',
  'north korea': 'KP',
  'st kitts and nevis': 'KN',
  'st lucia': 'LC',
  'st vincent and the grenadines': 'VC',
  'czech republic': 'CZ',
  'the bahamas': 'BS',
  'timor-leste': 'TL',
};

export interface FcdoState {
  validators: Validators;
  firstRunAt: string;
}

/**
 * UK Foreign, Commonwealth & Development Office travel advice: an update feed.
 *
 * Each entry is one country page that was updated, with FCDO's own one-line change
 * note ("Updated information about regional tensions"). The country comes from the
 * page title. FCDO does not publish numeric levels in this feed, so no level is inferred.
 */
export const fcdoTravelAdvice: SourceAdapter<FcdoState> = {
  sourceId: SOURCE_ID,
  async collect(ctx: AdapterContext<FcdoState>): Promise<AdapterResult<FcdoState>> {
    const def = getSource(SOURCE_ID)!;
    const res = await ctx.fetch(def.endpoint!, ctx.state?.validators);
    if (res.kind === 'not-modified') return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: ctx.state! };

    const items = parseFeed(res.body);
    const nowIso = new Date(ctx.now).toISOString();
    const lookback = ctx.now - (ctx.state ? STEADY_LOOKBACK_DAYS : FIRST_RUN_LOOKBACK_DAYS) * DAY;
    const events: IntelligenceEvent[] = [];
    const rejected: AdapterResult<FcdoState>['rejected'] = [];

    for (const item of items) {
      const country = cleanText(item.title);
      const url = safeUrl(item.link, 'https://www.gov.uk/');
      const updated = parseFeedDate(item.published);
      if (!country || !url || !updated) {
        rejected.push({ ref: truncate(country || '(untitled)', 80), reason: 'missing title, link or date' });
        continue;
      }
      if (Date.parse(updated) < lookback) continue;
      const iso = FCDO_NAMES[country.toLowerCase()] ?? countryByName(country);
      const change = htmlToText(item.description);
      const id = contentHash(SOURCE_ID, url, updated);
      events.push({
        id,
        contentHash: id,
        dataOrigin: 'live',
        sourceId: SOURCE_ID,
        sourceName: `UK FCDO — ${def.name}`,
        sourceClass: 'official',
        sourceUrl: url,
        title: truncate(`${country} — UK travel advice updated${change ? `: ${change}` : ''}`, LIMITS.title),
        summary: change ? truncate(change, LIMITS.summary) : undefined,
        category: 'diplomatic',
        regionIds: iso ? regionsForCountry(iso) : [],
        countryCodes: iso ? [iso] : [],
        publishedAt: updated,
        occurredAt: null,
        collectedAt: nowIso,
        credibility: 'official',
        verificationStatus: 'unreviewed',
        locationPrecision: iso ? 'country' : 'none',
        metadata: { fcdoCountry: country, changeNote: change || null, geoBasis: iso ? 'source-country' : 'none' },
      });
    }

    return {
      events,
      rejected,
      itemsSeen: items.length,
      notModified: false,
      state: { validators: res.validators, firstRunAt: ctx.state?.firstRunAt ?? nowIso },
    };
  },
};
