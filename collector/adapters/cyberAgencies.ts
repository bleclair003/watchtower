import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { makeFeedAdapter } from './feedAdapter.ts';
import { contentHash } from '../lib/hash.ts';
import { LIMITS, cleanText, truncate } from '../lib/text.ts';
import { FIRST_RUN_LOOKBACK_DAYS, STEADY_LOOKBACK_DAYS, type AdapterContext, type AdapterResult, type SourceAdapter } from './types.ts';
import type { CisaKevState } from './cisaKev.ts';

/**
 * National cyber agencies (Phase 20). All official, category cyber, tagged to the global cyber watch
 * (CERT-UA also to Eastern Europe).
 */

export const ncscUk = makeFeedAdapter({
  sourceId: 'ncsc-uk',
  feeds: [{ url: 'https://www.ncsc.gov.uk/api/1/services/v1/news-rss-feed.xml' }, { url: 'https://www.ncsc.gov.uk/api/1/services/v1/report-rss-feed.xml' }],
  publisher: 'UK NCSC',
  category: 'cyber',
  credibility: 'official',
  us: 'by-place',
  baseUrl: 'https://www.ncsc.gov.uk/',
  extraRegions: ['global-cyber'],
});

export const cccsCanada = makeFeedAdapter({
  sourceId: 'cccs-canada',
  feeds: [{ url: 'https://www.cyber.gc.ca/api/cccs/rss/v1/get?feed=alerts_advisories&lang=en' }],
  publisher: 'Canadian Centre for Cyber Security',
  category: 'cyber',
  credibility: 'official',
  us: 'by-place',
  baseUrl: 'https://www.cyber.gc.ca/',
  extraRegions: ['global-cyber'],
  // Routine vendor-patch advisories (AVyy-nnn) are left out; alerts (ALyy-nnn) and bulletins are kept.
  skip: (_item, title) => (/\(AV\d{2}-\d+\)/.test(title) ? 'routine vendor-patch advisory' : null),
});

export const jpcert = makeFeedAdapter({
  sourceId: 'jpcert',
  feeds: [{ url: 'https://www.jpcert.or.jp/english/rss/jpcert-en.rdf' }],
  publisher: 'JPCERT/CC',
  category: 'cyber',
  credibility: 'official',
  us: 'by-place',
  baseUrl: 'https://www.jpcert.or.jp/english/',
  extraRegions: ['global-cyber'],
});

// ---------------------------------------------------------------- CERT-UA

export const CERT_UA_LIST = 'https://cert.gov.ua/api/articles/all?page=1';
export const certUaArticleEn = (id: string) => `https://cert.gov.ua/api/articles/byId?id=${encodeURIComponent(id)}&lang=en`;

export interface CertUaState {
  /** English titles already fetched, by English article id. */
  titles: Record<string, string>;
  firstRunAt: string;
}

const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? '';
const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** Articles from the list: Ukrainian id/title, English id, date ("15.04.2026"). */
export function parseCertUaList(xml: string): { id: string; title: string; engId: string | null; date: string | null }[] {
  const out: { id: string; title: string; engId: string | null; date: string | null }[] = [];
  for (const m of xml.matchAll(/<items><id>(\d+)<\/id>([\s\S]*?)<\/items>(?=<items>|<\/items>)/g)) {
    const body = m[2];
    const d = tag(body, 'date').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    const engId = tag(body, 'engId');
    out.push({ id: m[1], title: cleanText(decode(tag(body, 'title'))), engId: /^\d+$/.test(engId) && tag(body, 'engStatus') === '1' ? engId : null, date: d ? `${d[3]}-${d[2]}-${d[1]}` : null });
  }
  return out;
}

/** CERT-UA (Ukraine's government CERT): public articles; English titles fetched once per new article. */
export const certUa: SourceAdapter<CertUaState> = {
  sourceId: 'cert-ua',
  async collect(ctx: AdapterContext<CertUaState>): Promise<AdapterResult<CertUaState>> {
    const nowIso = new Date(ctx.now).toISOString();
    const res = await ctx.fetch(CERT_UA_LIST);
    if (res.kind !== 'ok') return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: ctx.state! };
    const list = parseCertUaList(res.body);
    if (!list.length && !res.body.includes('items')) throw new Error('CERT-UA: unexpected response');
    const titles = { ...(ctx.state?.titles ?? {}) };
    // English titles for articles from the last 60 days not seen before (the English call carries the whole article).
    for (const a of list.filter((x) => x.engId && !(x.engId in titles) && x.date && Date.parse(`${x.date}T00:00:00Z`) >= ctx.now - 60 * 86_400_000).slice(0, 2)) {
      try {
        const en = await ctx.fetch(certUaArticleEn(a.engId!), undefined, undefined, { maxBytes: 24 * 1024 * 1024, timeoutMs: 45_000 });
        if (en.kind === 'ok') titles[a.engId!] = cleanText(decode(tag(en.body.slice(0, 4000), 'title'))).slice(0, 300);
      } catch {
        // Ukrainian title is used until the English one is fetched.
      }
    }
    const lookback = ctx.now - (ctx.state ? STEADY_LOOKBACK_DAYS : FIRST_RUN_LOOKBACK_DAYS) * 86_400_000;
    const events: IntelligenceEvent[] = list
      .filter((a) => a.date && Date.parse(`${a.date}T00:00:00Z`) >= lookback)
      .map((a) => {
        const id = contentHash('cert-ua', a.id);
        const english = a.engId ? titles[a.engId] : undefined;
        const at = `${a.date}T00:00:00.000Z`;
        return {
          id,
          contentHash: id,
          dataOrigin: 'live',
          sourceId: 'cert-ua',
          sourceName: 'CERT-UA (Ukraine)',
          sourceClass: 'official',
          sourceUrl: `https://cert.gov.ua/article/${a.engId ?? a.id}`,
          title: truncate(`CERT-UA: ${english || a.title}`, LIMITS.title),
          summary: english ? truncate(`Ukrainian title: ${a.title}`, LIMITS.summary) : 'Title in Ukrainian; the link opens the English version when CERT-UA has published one.',
          category: 'cyber',
          regionIds: ['global-cyber', 'eastern-europe'],
          countryCodes: ['UA'],
          publishedAt: at,
          occurredAt: null,
          collectedAt: nowIso,
          credibility: 'official',
          verificationStatus: 'unreviewed',
          locationPrecision: 'country',
          metadata: { certUaId: a.id, englishId: a.engId, englishTitle: !!english, geoBasis: 'source-country' },
        } satisfies IntelligenceEvent;
      });
    return { events, rejected: [], itemsSeen: list.length, notModified: false, state: { titles, firstRunAt: ctx.state?.firstRunAt ?? nowIso } };
  },
};

// ---------------------------------------------------------------- FIRST EPSS

export const EPSS_SOURCE_ID = 'first-epss';
export const EPSS_EVERY_HOURS = 6;

export interface EpssState {
  lastFetchedAt: string;
  /** cve → [probability, percentile] */
  scores: Record<string, [number, number]>;
}

/** EPSS scores for the KEV entries added in the last 30 days (one batch request every 6 hours). */
export const firstEpss: SourceAdapter<EpssState> = {
  sourceId: EPSS_SOURCE_ID,
  async collect(ctx: AdapterContext<EpssState>): Promise<AdapterResult<EpssState>> {
    if (ctx.state && ctx.now - Date.parse(ctx.state.lastFetchedAt) < EPSS_EVERY_HOURS * 3_600_000) {
      return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: ctx.state };
    }
    const kev = ctx.peerState ? await ctx.peerState<CisaKevState>('cisa-kev') : null;
    const cves = [...new Set((kev?.recent ?? []).map((k) => k.cve))].slice(0, 100);
    const nowIso = new Date(ctx.now).toISOString();
    if (!cves.length) return { events: [], rejected: [], itemsSeen: 0, notModified: false, state: { lastFetchedAt: nowIso, scores: {} } };
    const res = await ctx.fetch(`https://api.first.org/data/v1/epss?cve=${cves.join(',')}`, undefined, { Accept: 'application/json' });
    if (res.kind !== 'ok') throw new Error(`EPSS: unexpected ${res.status}`);
    const body = JSON.parse(res.body) as { data?: { cve?: unknown; epss?: unknown; percentile?: unknown }[] };
    const scores: Record<string, [number, number]> = {};
    for (const d of body.data ?? []) {
      const p = Number(d.epss);
      const pc = Number(d.percentile);
      if (typeof d.cve === 'string' && Number.isFinite(p) && Number.isFinite(pc)) scores[d.cve] = [Math.round(p * 10_000) / 10_000, Math.round(pc * 1000) / 1000];
    }
    return { events: [], rejected: [], itemsSeen: Object.keys(scores).length, notModified: false, state: { lastFetchedAt: nowIso, scores } };
  },
};
