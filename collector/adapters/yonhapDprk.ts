import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { parseFeed, type FeedItem } from '../lib/feed.ts';
import { parseFeedDate } from '../lib/dates.ts';
import { contentHash } from '../lib/hash.ts';
import { LIMITS, cleanText, safeUrl, truncate } from '../lib/text.ts';
import type { AdapterContext, AdapterResult, SourceAdapter } from './types.ts';

export const YONHAP_DPRK_SOURCE_ID = 'yonhap-dprk-launches';
export const YONHAP_FEED = 'https://en.yna.co.kr/RSS/news.xml';
const KEEP_DAYS = 45;

/** Yonhap marks story versions with (URGENT), (LEAD), (2nd LD) … */
const VERSION_TAG = /^\s*\((?:URGENT|LEAD|\d+(?:st|nd|rd|th) LD|News Focus|Yonhap Interview|EDITORIAL|AMERICAS)\)\s*/i;
const NORTH_KOREA = /\b(?:N\.\s?Korea|North Korea|Pyongyang)(?:'s)?\b/i;
const LAUNCH = /\b(?:fires?|fired|launch(?:es|ed)?|test-fires?|test-fired)\b[^:]*\b(?:missiles?|rockets?|projectiles?|ICBMs?|SLBMs?|satellite|space launch vehicle)\b/i;
const NUCLEAR_TEST = /\b(?:conducts?|conducted|carries out|carried out)\b[^:]*\bnuclear test\b/i;
/** Forecasts, warnings and analysis are not launches. */
const NOT_AN_EVENT = /\b(?:may|could|might|likely|possible|possibly|prepar\w*|ahead of|warns?|vows?|threatens?|signs of|plans?|expected|would)\b|\?/i;

export type DprkEventKind = 'launch' | 'nuclear-test';

export interface DprkHeadline {
  kind: DprkEventKind;
  title: string;
  url: string;
  publishedAt: string;
  /** Korea date of publication (launches are dated by the Korean day). */
  kstDate: string;
}

/** Headlines reporting that North Korea fired something or conducted a nuclear test. */
export function dprkHeadlines(items: FeedItem[]): DprkHeadline[] {
  return items.flatMap((it) => {
    const title = cleanText(it.title).replace(VERSION_TAG, '');
    if (!NORTH_KOREA.test(title) || NOT_AN_EVENT.test(title)) return [];
    const kind: DprkEventKind | null = NUCLEAR_TEST.test(title) ? 'nuclear-test' : LAUNCH.test(title) ? 'launch' : null;
    const url = safeUrl(it.link);
    const publishedAt = parseFeedDate(it.published);
    if (!kind || !url || !publishedAt) return [];
    const kstDate = new Date(Date.parse(publishedAt) + 9 * 3_600_000).toISOString().slice(0, 10);
    return [{ kind, title, url, publishedAt, kstDate }];
  });
}

/** One record per kind and Korea day, listing the headlines (all versions of the story). */
export function dprkEvents(headlines: DprkHeadline[], nowIso: string): IntelligenceEvent[] {
  const groups = new Map<string, DprkHeadline[]>();
  for (const h of headlines) groups.set(`${h.kind}|${h.kstDate}`, [...(groups.get(`${h.kind}|${h.kstDate}`) ?? []), h]);
  return [...groups].map(([key, hs]) => {
    const [kind, day] = key.split('|') as [DprkEventKind, string];
    const sorted = [...hs].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
    const titles = [...new Set(sorted.map((h) => h.title))];
    const first = sorted[0];
    const latest = sorted[sorted.length - 1];
    const id = contentHash(YONHAP_DPRK_SOURCE_ID, kind, day);
    return {
      id,
      contentHash: id,
      dataOrigin: 'live' as const,
      sourceId: YONHAP_DPRK_SOURCE_ID,
      sourceName: 'Yonhap News Agency — North Korea launches',
      sourceClass: 'media' as const,
      sourceUrl: first.url,
      title: truncate(`${kind === 'nuclear-test' ? 'North Korea nuclear test reported' : 'North Korea launch reported'} (${day}, Korea time): ${titles[0]}`, LIMITS.title),
      summary: truncate(
        `Yonhap headlines that day: ${titles.slice(0, 4).join(' | ')}${titles.length > 4 ? ` (+${titles.length - 4} more)` : ''}. ` +
          'Yonhap usually cites South Korea’s Joint Chiefs of Staff (JCS); early reports are revised as details come in.',
        LIMITS.summary,
      ),
      category: 'military' as const,
      regionIds: ['korean-peninsula'],
      countryCodes: ['KP'],
      publishedAt: first.publishedAt,
      occurredAt: `${day}T00:00:00.000Z`,
      collectedAt: nowIso,
      credibility: 'single-source' as const,
      verificationStatus: 'unreviewed' as const,
      locationPrecision: 'country' as const,
      metadata: {
        subtype: kind === 'nuclear-test' ? 'dprk-nuclear-test' : 'dprk-missile-launch',
        headlines: titles.length,
        kstDate: day,
        revisionKey: `${titles.length}|${latest.url}`,
      },
    };
  });
}

export interface YonhapDprkState {
  validators?: { etag?: string | null; lastModified?: string | null };
}

/**
 * North Korean launches and nuclear tests from Yonhap's English all-news feed (about 2 days of
 * items, read every run). Revisable: a day's record is rewritten as new versions of the story arrive.
 */
export const yonhapDprkLaunches: SourceAdapter<YonhapDprkState> = {
  sourceId: YONHAP_DPRK_SOURCE_ID,
  revisable: true,
  async collect(ctx: AdapterContext<YonhapDprkState>): Promise<AdapterResult<YonhapDprkState>> {
    const res = await ctx.fetch(YONHAP_FEED, ctx.state?.validators);
    if (res.kind === 'not-modified') return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: ctx.state ?? {} };
    const items = parseFeed(res.body);
    const since = new Date(ctx.now - KEEP_DAYS * 86_400_000).toISOString();
    const headlines = dprkHeadlines(items).filter((h) => h.publishedAt >= since);
    return { events: dprkEvents(headlines, new Date(ctx.now).toISOString()), rejected: [], itemsSeen: items.length, notModified: false, state: { validators: res.validators } };
  },
};
