import { makeFeedAdapter } from './feedAdapter.ts';

/**
 * IAEA pubDate is "YY-MM-DD HH:mm" with no timezone (seen 2026-11-20). Interpreted as UTC;
 * it may be Vienna local time, so it can be up to 2 hours off. Registry notes say so.
 */
export function parseIaeaDate(raw: string): string | null {
  const m = raw.trim().match(/^(\d{2})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const t = Date.UTC(2000 + Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/**
 * Feed-based sources that share the generic RSS/Atom adapter.
 * Official publishers keep a fixed category; general-news publishers use the keyword classifier.
 */

export const warGovNews = makeFeedAdapter({
  sourceId: 'war-gov-news',
  feeds: [{ url: 'https://www.war.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=945&max=10' }],
  publisher: 'U.S. DoD',
  category: 'military',
  credibility: 'official',
  us: 'unless-foreign',
  baseUrl: 'https://www.war.gov/',
});

export const ukMod = makeFeedAdapter({
  sourceId: 'uk-mod',
  feeds: [{ url: 'https://www.gov.uk/government/organisations/ministry-of-defence.atom' }],
  publisher: 'UK MOD',
  category: 'military',
  credibility: 'official',
  baseUrl: 'https://www.gov.uk/',
});

export const iaeaNews = makeFeedAdapter({
  sourceId: 'iaea-news',
  feeds: [{ url: 'https://www.iaea.org/feeds/topnews' }],
  publisher: 'IAEA',
  category: 'official',
  parseDate: (raw) => parseIaeaDate(raw),
  credibility: 'official',
  baseUrl: 'https://www.iaea.org/',
});

export const unNews = makeFeedAdapter({
  sourceId: 'un-news',
  feeds: [{ url: 'https://news.un.org/feed/subscribe/en/news/all/rss.xml' }],
  publisher: 'UN News',
  category: 'classify',
  credibility: 'official',
  baseUrl: 'https://news.un.org/',
});

export const bbcWorld = makeFeedAdapter({
  sourceId: 'bbc-world',
  feeds: [
    { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', label: 'world' },
    { url: 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml', label: 'middle_east' },
    { url: 'https://feeds.bbci.co.uk/news/world/europe/rss.xml', label: 'europe' },
    { url: 'https://feeds.bbci.co.uk/news/world/asia/rss.xml', label: 'asia' },
    { url: 'https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml', label: 'us_and_canada' },
  ],
  publisher: 'BBC News',
  category: 'classify',
  credibility: 'single-source',
  baseUrl: 'https://www.bbc.co.uk/',
  // BBC feeds include video and live pages; keep articles only.
  skip: (item) => (/\/(videos|live|sounds|iplayer)\//.test(item.link) ? 'non-article' : null),
});

export const aljazeera = makeFeedAdapter({
  sourceId: 'aljazeera',
  feeds: [{ url: 'https://www.aljazeera.com/xml/rss/all.xml' }],
  publisher: 'Al Jazeera',
  category: 'classify',
  credibility: 'single-source',
  baseUrl: 'https://www.aljazeera.com/',
  skip: (item) => (/\/(video|program|podcasts|gallery)\//.test(item.link) ? 'non-article' : null),
});

// ---------------------------------------------------------------- US domestic (v0.13)

export const airForceNews = makeFeedAdapter({
  sourceId: 'af-news',
  feeds: [{ url: 'https://www.af.mil/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=1&max=10' }],
  publisher: 'U.S. Air Force',
  category: 'military',
  credibility: 'official',
  baseUrl: 'https://www.af.mil/',
  us: 'unless-foreign',
});

export const marinesNews = makeFeedAdapter({
  sourceId: 'marines-news',
  feeds: [{ url: 'https://www.marines.mil/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=481&max=10' }],
  publisher: 'U.S. Marine Corps',
  category: 'military',
  credibility: 'official',
  baseUrl: 'https://www.marines.mil/',
  us: 'unless-foreign',
});

export const militaryTimes = makeFeedAdapter({
  sourceId: 'military-times',
  feeds: [{ url: 'https://www.militarytimes.com/arc/outboundfeeds/rss/?outputType=xml' }],
  publisher: 'Military Times',
  category: 'classify',
  credibility: 'single-source',
  baseUrl: 'https://www.militarytimes.com/',
  us: 'unless-foreign',
});

export const defenseNews = makeFeedAdapter({
  sourceId: 'defense-news',
  feeds: [{ url: 'https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml' }],
  publisher: 'Defense News',
  category: 'classify',
  credibility: 'single-source',
  baseUrl: 'https://www.defensenews.com/',
  us: 'unless-foreign',
});

export const nprNational = makeFeedAdapter({
  sourceId: 'npr-national',
  feeds: [{ url: 'https://feeds.npr.org/1003/rss.xml' }],
  publisher: 'NPR',
  category: 'classify',
  credibility: 'single-source',
  baseUrl: 'https://www.npr.org/',
  us: 'always',
});

