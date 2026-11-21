import type { Credibility, EventCategory, IntelligenceEvent, LocationPrecision } from '../../shared/domain/types.ts';
import { getSource } from '../../shared/domain/sources.ts';
import { headlineGeo, type UsMode } from '../../shared/domain/geo/domestic.ts';
import { parseFeed, type FeedItem } from '../lib/feed.ts';
import { parseFeedDate } from '../lib/dates.ts';
import { contentHash } from '../lib/hash.ts';
import { classifyTopic } from '../lib/topic.ts';
import { LIMITS, cleanText, htmlToText, safeUrl, truncate } from '../lib/text.ts';
import type { Validators } from '../lib/http.ts';
import { FIRST_RUN_LOOKBACK_DAYS, STEADY_LOOKBACK_DAYS, type AdapterContext, type AdapterResult, type SourceAdapter } from './types.ts';

const DAY = 86_400_000;

export interface FeedAdapterConfig {
  sourceId: string;
  /** Feeds to read. Several feeds of one publisher are merged and de-duplicated by link. */
  feeds: { url: string; label?: string }[];
  /** Short publisher label used in sourceName, e.g. "BBC News". */
  publisher: string;
  /** Fixed category, or 'classify' to use the keyword topic classifier on the headline. */
  category: EventCategory | 'classify';
  credibility: Credibility;
  /** How items count as inside the United States (default 'by-place'). */
  us?: UsMode;
  /** Base for relative links. */
  baseUrl: string;
  /** Publisher-specific date parser (default: RFC 822 / ISO via parseFeedDate). */
  parseDate?: (raw: string) => string | null;
  /** Regions added to every item (e.g. 'global-cyber' for national cyber agencies). */
  extraRegions?: string[];
  /** Optional item filter (return a reason string to skip, or null to keep). */
  skip?: (item: FeedItem, title: string) => string | null;
}

export interface FeedAdapterState {
  validators: Record<string, Validators>;
  firstRunAt: string;
}

/**
 * Generic RSS / Atom adapter.
 *
 * - Geography comes only from explicit mentions in the HEADLINE (gazetteer): country or
 *   region precision, never coordinates. The matched terms are kept in metadata.
 * - Ids hash the item link, so re-publication of the same article is not a new record.
 * - First run imports FIRST_RUN_LOOKBACK_DAYS; later runs ignore anything older than
 *   STEADY_LOOKBACK_DAYS (protects against feeds that reset to old items).
 */
export function makeFeedAdapter(cfg: FeedAdapterConfig): SourceAdapter<FeedAdapterState> {
  return {
    sourceId: cfg.sourceId,
    async collect(ctx: AdapterContext<FeedAdapterState>): Promise<AdapterResult<FeedAdapterState>> {
      const def = getSource(cfg.sourceId);
      if (!def) throw new Error(`Source ${cfg.sourceId} missing from registry`);
      const prev = ctx.state;
      const validators: Record<string, Validators> = { ...(prev?.validators ?? {}) };
      const nowIso = new Date(ctx.now).toISOString();
      const lookback = ctx.now - (prev ? STEADY_LOOKBACK_DAYS : FIRST_RUN_LOOKBACK_DAYS) * DAY;

      const items: { item: FeedItem; feed: string | undefined }[] = [];
      let allNotModified = true;
      for (const f of cfg.feeds) {
        const res = await ctx.fetch(f.url, validators[f.url]);
        if (res.kind === 'not-modified') continue;
        allNotModified = false;
        validators[f.url] = res.validators;
        for (const item of parseFeed(res.body)) items.push({ item, feed: f.label });
      }
      const state: FeedAdapterState = { validators, firstRunAt: prev?.firstRunAt ?? nowIso };
      if (allNotModified && prev) return { events: [], rejected: [], itemsSeen: 0, notModified: true, state };

      const events: IntelligenceEvent[] = [];
      const rejected: AdapterResult<FeedAdapterState>['rejected'] = [];
      const seen = new Set<string>();

      for (const { item, feed } of items) {
        const title = cleanText(item.title);
        const url = safeUrl(item.link, cfg.baseUrl);
        if (!url || !title) {
          rejected.push({ ref: truncate(title || '(untitled)', 80), reason: !url ? 'invalid link' : 'empty title' });
          continue;
        }
        // Tracking parameters differ between feeds of one publisher; the path identifies the article.
        const key = url.split(/[?#]/)[0];
        if (seen.has(key)) continue;
        seen.add(key);

        const publishedAt = (cfg.parseDate ?? parseFeedDate)(item.published);
        if (publishedAt && Date.parse(publishedAt) < lookback) continue;
        if (!publishedAt && prev) continue; // undated items only on first run would be guesswork; skip later
        const skipReason = cfg.skip?.(item, title);
        if (skipReason) continue;

        const geo = headlineGeo(title, cfg.us);
        const regionIds = [...new Set([...geo.regionIds, ...(cfg.extraRegions ?? [])])];
        const precision: LocationPrecision = geo.countryCodes.length ? 'country' : regionIds.length ? 'region' : 'none';
        const topic = cfg.category === 'classify' ? classifyTopic(title) : { category: cfg.category, term: null };

        const id = contentHash(cfg.sourceId, key);
        events.push({
          id,
          contentHash: id,
          dataOrigin: 'live',
          sourceId: cfg.sourceId,
          sourceName: `${cfg.publisher} — ${def.name}`,
          sourceClass: def.sourceClass,
          sourceUrl: url,
          title: truncate(title, LIMITS.title),
          summary: truncate(htmlToText(item.description), LIMITS.summary) || undefined,
          category: topic.category,
          regionIds,
          countryCodes: geo.countryCodes,
          publishedAt,
          occurredAt: null,
          collectedAt: nowIso,
          credibility: cfg.credibility,
          verificationStatus: 'unreviewed',
          locationPrecision: precision,
          metadata: {
            geoBasis: geo.terms.length ? 'text-mention' : geo.usBasis === 'source' ? 'source-default' : 'none',
            geoTerms: geo.terms,
            ...(geo.usDomestic ? { usDomestic: geo.usBasis, usStates: geo.usStates } : {}),
            ...(cfg.category === 'classify' ? { topicBasis: topic.term ? 'keyword' : 'none', topicTerm: topic.term } : {}),
            ...(feed ? { feed } : {}),
          },
        });
      }

      return { events, rejected, itemsSeen: items.length, notModified: false, state };
    },
  };
}
