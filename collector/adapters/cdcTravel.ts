import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { regionsForCountry } from '../../shared/domain/regions.ts';
import { matchGazetteer } from '../../shared/domain/geo/gazetteer.ts';
import { CDC_SOURCE_ID, parseCdcTitle } from '../../shared/domain/travelAdvice.ts';
import { parseFeed } from '../lib/feed.ts';
import { parseFeedDate } from '../lib/dates.ts';
import { contentHash } from '../lib/hash.ts';
import type { Validators } from '../lib/http.ts';
import { LIMITS, cleanText, htmlToText, safeUrl, truncate } from '../lib/text.ts';
import { FIRST_RUN_LOOKBACK_DAYS, STEADY_LOOKBACK_DAYS, type AdapterContext, type AdapterResult, type SourceAdapter } from './types.ts';

/**
 * US CDC travel health notices (v0.83.0): Level 1 (practice usual precautions) to Level 4 (avoid all
 * travel), each naming a disease and the places. US government work (public domain). The CDC asks
 * crawlers to wait 20 s between requests; WATCHTOWER makes one request per read and reads at most every
 * 3 hours.
 */

export const CDC_FEED_URL = 'https://wwwnc.cdc.gov/travel/rss/notices.xml';
export const CDC_MIN_INTERVAL_MS = 3 * 3_600_000;
const DAY = 86_400_000;
export const CDC_LEVEL_LABEL = ['', 'Practice usual precautions', 'Practice enhanced precautions', 'Reconsider nonessential travel', 'Avoid nonessential travel'] as const;

export interface CdcState {
  validators?: Validators;
  fetchedAt: string;
  firstRunAt: string;
}

export const cdcTravel: SourceAdapter<CdcState> = {
  sourceId: CDC_SOURCE_ID,
  async collect(ctx: AdapterContext<CdcState>): Promise<AdapterResult<CdcState>> {
    const prev = ctx.state;
    const nowIso = new Date(ctx.now).toISOString();
    if (prev?.fetchedAt && ctx.now - Date.parse(prev.fetchedAt) < CDC_MIN_INTERVAL_MS) {
      return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: prev, note: 'read less than 3 h ago' };
    }
    const res = await ctx.fetch(CDC_FEED_URL, prev?.validators);
    if (res.kind === 'not-modified') return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: { ...prev!, fetchedAt: nowIso } };
    const items = parseFeed(res.body);
    const lookback = ctx.now - (prev ? STEADY_LOOKBACK_DAYS : FIRST_RUN_LOOKBACK_DAYS) * DAY;
    const events: IntelligenceEvent[] = [];
    const rejected: AdapterResult<CdcState>['rejected'] = [];
    for (const item of items) {
      const title = cleanText(item.title);
      const parsed = parseCdcTitle(title);
      const url = safeUrl(item.link, 'https://wwwnc.cdc.gov/');
      const publishedAt = parseFeedDate(item.published);
      if (!parsed || !url || !publishedAt) {
        rejected.push({ ref: truncate(title || '(untitled)', 80), reason: 'unrecognised notice title, link or date' });
        continue;
      }
      if (Date.parse(publishedAt) < lookback) continue;
      const where = title.replace(/^.*?\s+in\s+(?=[A-Z])/, '');
      const countries = /\bglobal\b/i.test(parsed.disease) || /^global\b/i.test(title.replace(/^Level\s+\d\s*[-–—]\s*/i, '')) ? [] : matchGazetteer(where).countryCodes;
      const id = contentHash(CDC_SOURCE_ID, url, publishedAt);
      events.push({
        id,
        contentHash: id,
        dataOrigin: 'live',
        sourceId: CDC_SOURCE_ID,
        sourceName: 'US CDC — travel health notices',
        sourceClass: 'official',
        sourceUrl: url,
        title: truncate(`CDC Level ${parsed.level} (${CDC_LEVEL_LABEL[parsed.level].toLowerCase()}): ${parsed.disease}${parsed.places.length ? ` in ${parsed.places.join(', ')}` : ''}`, LIMITS.title),
        summary: truncate(htmlToText(item.description), LIMITS.summary) || undefined,
        category: 'disaster',
        regionIds: [...new Set(countries.flatMap(regionsForCountry))],
        countryCodes: countries,
        publishedAt,
        occurredAt: null,
        collectedAt: nowIso,
        credibility: 'official',
        verificationStatus: 'unreviewed',
        locationPrecision: countries.length ? 'country' : 'none',
        metadata: { subtype: 'cdc-notice', advisoryLevel: parsed.level, disease: parsed.disease, places: parsed.places, geoBasis: countries.length ? 'named-country' : 'none' },
      });
    }
    return { events, rejected, itemsSeen: items.length, notModified: false, state: { validators: res.validators, fetchedAt: nowIso, firstRunAt: prev?.firstRunAt ?? nowIso } };
  },
};
