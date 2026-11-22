import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { mergeReports, parseGeneralStaff, sectorName, type FrontReport } from '../../shared/domain/ukraineFront.ts';
import { makeFeedAdapter } from './feedAdapter.ts';
import { contentHash } from '../lib/hash.ts';
import { LIMITS, decodeEntities, truncate } from '../lib/text.ts';
import { FIRST_RUN_LOOKBACK_DAYS, type AdapterContext, type AdapterResult, type SourceAdapter } from './types.ts';

/**
 * Ukraine front (Phase 21): the General Staff of the Armed Forces of Ukraine's operational updates as
 * published in English by Ukrinform, and Ukrinform's war news. Ukrinform's robots.txt allows this;
 * WATCHTOWER keeps the figures and settlement names (facts) and links to the article, not its text.
 */

export const UKRINFORM_WAR_RSS = 'https://www.ukrinform.net/rss/rubric-ato';
export const UKRINFORM_WAR_PAGE = (n: number) => `https://www.ukrinform.net/rubric-ato?page=${n}`;
export const GS_SOURCE_ID = 'ua-general-staff';
/** First runs read older listing pages (about a day each) to fill two weeks of daily reports. */
export const BACKFILL_PAGES = 18;
const PAGES_PER_RUN = 3;
const ARTICLES_PER_RUN = 8;

export const ukrinformWar = makeFeedAdapter({
  sourceId: 'ukrinform-war',
  feeds: [{ url: UKRINFORM_WAR_RSS }],
  publisher: 'Ukrinform',
  category: 'classify',
  credibility: 'single-source',
  baseUrl: 'https://www.ukrinform.net/',
  extraRegions: ['eastern-europe'],
});

export interface GeneralStaffState {
  reports: FrontReport[];
  /** Article URLs already read (newest 200). */
  seen: string[];
  /** Next listing page to read while back-filling; 0 when done. */
  backfillPage: number;
  /** Days already recorded (newest 60). */
  recorded: string[];
  /** Update links found but not read yet (read a few per run). */
  queue?: string[];
}

/** The article's own text: the paragraphs between the article heading and the "analytics" block. */
export function articleText(html: string): { title: string; text: string; publishedAt: string | null } {
  const title = decodeEntities(html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] ?? '');
  const i = html.indexOf('class="newsText"');
  const j = html.indexOf('class="analiticBody"', i);
  const seg = i >= 0 ? html.slice(i, j > i ? j : undefined) : '';
  const text = [...seg.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => decodeEntities(m[1].replace(/<[^>]+>/g, ' '))).join(' ');
  const pub = html.match(/"datePublished":\s*"(\d{4}-\d{2}-\d{2}T[^"]+)"/)?.[1] ?? null;
  return { title, text, publishedAt: pub && !Number.isNaN(Date.parse(pub)) ? new Date(Date.parse(pub)).toISOString() : null };
}

const isWarUpdate = (url: string, title = '') => /\/rubric-ato\/\d+-war-update/.test(url) || /^War update\b/i.test(title);
const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** One record per full day: the totals and the busiest sectors. */
export function reportRecord(r: FrontReport, nowIso: string): IntelligenceEvent {
  const id = contentHash(GS_SOURCE_ID, r.day);
  const top = Object.entries(r.sectors)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([s, n]) => `${sectorName(s)} ${n}`);
  const figures = [
    r.airstrikes !== null ? `${r.airstrikes} airstrikes` : null,
    r.guidedBombs !== null ? `${r.guidedBombs} guided bombs` : null,
    r.kamikazeDrones !== null ? `${r.kamikazeDrones.toLocaleString('en-US')} kamikaze drones` : null,
    r.shelling !== null ? `${r.shelling.toLocaleString('en-US')} shelling attacks` : null,
  ].filter(Boolean);
  return {
    id,
    contentHash: id,
    dataOrigin: 'live',
    sourceId: GS_SOURCE_ID,
    sourceName: 'General Staff of the Armed Forces of Ukraine (via Ukrinform)',
    sourceClass: 'official',
    sourceUrl: r.url,
    title: truncate(`Ukraine General Staff, ${fmtDay(r.day)}: ${r.total ?? '?'} combat engagements${top.length ? ` — most in ${top.join(', ')}` : ''}`, LIMITS.title),
    summary: truncate(
      `Ukraine's General Staff reported ${r.total ?? 'an unstated number of'} combat engagements on ${fmtDay(r.day)}${figures.length ? `, with ${figures.join(', ')} by Russian forces` : ''}.` +
        `${r.quiet.length ? ` No Russian offensive action in: ${r.quiet.map(sectorName).join(', ')}.` : ''} These are Ukraine's own figures (one side), read from Ukrinform's English report; per-sector counts are parsed from the text and approximate.`,
      LIMITS.summary,
    ),
    category: 'military',
    regionIds: ['eastern-europe'],
    countryCodes: ['UA'],
    publishedAt: `${r.day}T23:59:00.000Z`,
    occurredAt: `${r.day}T12:00:00.000Z`,
    collectedAt: nowIso,
    credibility: 'official',
    verificationStatus: 'unreviewed',
    locationPrecision: 'country',
    metadata: { subtype: 'front-report', day: r.day, total: r.total, sectors: r.sectors, quiet: r.quiet, claimSide: 'ukraine', geoBasis: 'source-country' },
  };
}

/** Ukraine's General Staff daily updates (via Ukrinform): per-sector activity, kept 45 days. */
export const uaGeneralStaff: SourceAdapter<GeneralStaffState> = {
  sourceId: GS_SOURCE_ID,
  async collect(ctx: AdapterContext<GeneralStaffState>): Promise<AdapterResult<GeneralStaffState>> {
    const nowIso = new Date(ctx.now).toISOString();
    const prev: GeneralStaffState = ctx.state ?? { reports: [], seen: [], backfillPage: 2, recorded: [] };
    const links: { url: string; title: string }[] = [];
    const rss = await ctx.fetch(UKRINFORM_WAR_RSS);
    if (rss.kind === 'ok') {
      for (const it of rss.body.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
        const title = decodeEntities(it[1].match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1] ?? '').trim();
        const url = it[1].match(/<link>([^<]+)<\/link>/)?.[1]?.trim() ?? '';
        if (url && isWarUpdate(url, title)) links.push({ url, title });
      }
    }
    let backfillPage = prev.backfillPage;
    for (let k = 0; k < PAGES_PER_RUN && backfillPage > 0 && backfillPage <= BACKFILL_PAGES; k++, backfillPage++) {
      const page = await ctx.fetch(UKRINFORM_WAR_PAGE(backfillPage));
      if (page.kind !== 'ok') break;
      for (const m of page.body.matchAll(/href="(\/rubric-ato\/\d+-war-update[^"]+)"/g)) links.push({ url: `https://www.ukrinform.net${m[1]}`, title: '' });
    }
    if (backfillPage > BACKFILL_PAGES) backfillPage = 0;

    const seen = new Set(prev.seen);
    // New links first, then the ones queued from earlier runs (newest article ids first).
    const titles = new Map(links.map((l) => [l.url, l.title]));
    const pending = [...new Set([...links.map((l) => l.url), ...(prev.queue ?? [])])]
      .filter((u) => !seen.has(u))
      .sort((a, b) => Number(b.match(/\/(\d+)-/)?.[1] ?? 0) - Number(a.match(/\/(\d+)-/)?.[1] ?? 0));
    const todo = pending.slice(0, ARTICLES_PER_RUN).map((url) => ({ url, title: titles.get(url) ?? '' }));
    const fresh: FrontReport[] = [];
    for (const l of todo) {
      const res = await ctx.fetch(l.url);
      if (res.kind !== 'ok') continue;
      seen.add(l.url);
      const a = articleText(res.body);
      const r = parseGeneralStaff(a.text, l.url, a.publishedAt, a.title || l.title);
      if (r) fresh.push(r);
    }
    const reports = mergeReports(prev.reports, fresh, 45, ctx.now);
    const recorded = new Set(prev.recorded);
    const lookback = new Date(ctx.now - FIRST_RUN_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
    const events = reports.filter((r) => r.fullDay && r.total !== null && r.day >= lookback && !recorded.has(r.day)).map((r) => reportRecord(r, nowIso));
    for (const e of events) recorded.add(String(e.metadata?.day));
    return {
      events,
      rejected: [],
      itemsSeen: links.length,
      notModified: false,
      state: { reports, seen: [...seen].slice(-200), backfillPage, recorded: [...recorded].sort().slice(-60), queue: pending.filter((u) => !seen.has(u)).slice(0, 60) },
    };
  },
};
