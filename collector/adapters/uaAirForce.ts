import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { interceptRate, mergeAirReports, parseAirReport, type AirReport } from '../../shared/domain/airAttacks.ts';
import { contentHash } from '../lib/hash.ts';
import { LIMITS, decodeEntities, truncate } from '../lib/text.ts';
import { articleText, BACKFILL_PAGES, UKRINFORM_WAR_PAGE, UKRINFORM_WAR_RSS } from './ukraineFront.ts';
import { FIRST_RUN_LOOKBACK_DAYS, type AdapterContext, type AdapterResult, type SourceAdapter } from './types.ts';

/**
 * Overnight air attacks on Ukraine (Phase 22): the Ukrainian Air Force's morning report as published in
 * English by Ukrinform — drones and missiles launched, shot down or suppressed, hit locations. Figures
 * (facts) and a link are kept, not the article text. Back-fills about two weeks on first runs.
 */

export const AF_SOURCE_ID = 'ua-air-force';
const PAGES_PER_RUN = 3;
const ARTICLES_PER_RUN = 8;

export interface AirForceState {
  reports: AirReport[];
  seen: string[];
  backfillPage: number;
  recorded: string[];
  queue?: string[];
}

/** Air-defence reports: "Air defense neutralizes 117 of 148 Russian drones …", "Ukraine's air defenses down 82 missiles …". */
export const isAirReportLink = (url: string, title = '') =>
  // The article name must start with it ("…-strengthen-ukraines-air-defenses" is an aid story, not a report).
  /\/\d+-(?:air-defen[cs]e-(?:neutrali|down|shoot|intercept)|air-defen[cs]es?-down|ukraines-air-defen[cs]es?-(?:neutrali|down|shoot|intercept))/.test(url) || /^(?:Ukraine’s |Ukraine's )?air defen[cs]es? (?:neutrali|down|shoot)/i.test(title);

const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export function airRecord(r: AirReport, nowIso: string): IntelligenceEvent {
  const id = contentHash(AF_SOURCE_ID, r.day);
  const launched = [r.drones !== null ? `${r.drones} drones` : null, r.missiles !== null ? `${r.missiles} missiles` : null].filter(Boolean).join(', ');
  const down = [r.dronesDown !== null ? `${r.dronesDown} drones` : null, r.missilesDown !== null ? `${r.missilesDown} missiles` : null].filter(Boolean).join(', ');
  const rate = interceptRate(r);
  return {
    id,
    contentHash: id,
    dataOrigin: 'live',
    sourceId: AF_SOURCE_ID,
    sourceName: 'Ukrainian Air Force (via Ukrinform)',
    sourceClass: 'official',
    sourceUrl: r.url,
    title: truncate(`Overnight attack on Ukraine (night to ${fmtDay(r.day)}): ${launched || 'launches not stated'}${down ? `; ${down} shot down or suppressed` : ''}`, LIMITS.title),
    summary: truncate(
      `The Ukrainian Air Force reported ${launched || 'an attack'} launched by Russia overnight${r.ballistic ? ` (${r.ballistic} ballistic)` : ''}` +
        `${down ? `, of which ${down} were shot down or suppressed${rate !== null ? ` (${Math.round(rate * 100)}%)` : ''}` : ''}` +
        `${r.hitLocations !== null ? `; hits at ${r.hitLocations} locations` : ''}${r.debrisLocations !== null ? `, debris at ${r.debrisLocations}` : ''}.` +
        " Ukraine's own figures (one side), read from Ukrinform's English report; parsed from text and approximate.",
      LIMITS.summary,
    ),
    category: 'military',
    regionIds: ['eastern-europe'],
    countryCodes: ['UA'],
    publishedAt: `${r.day}T06:00:00.000Z`,
    occurredAt: `${r.day}T00:00:00.000Z`,
    collectedAt: nowIso,
    credibility: 'official',
    verificationStatus: 'unreviewed',
    locationPrecision: 'country',
    metadata: { subtype: 'air-attack', day: r.day, drones: r.drones, missiles: r.missiles, dronesDown: r.dronesDown, missilesDown: r.missilesDown, hitLocations: r.hitLocations, claimSide: 'ukraine', geoBasis: 'source-country' },
  };
}

export const uaAirForce: SourceAdapter<AirForceState> = {
  sourceId: AF_SOURCE_ID,
  async collect(ctx: AdapterContext<AirForceState>): Promise<AdapterResult<AirForceState>> {
    const nowIso = new Date(ctx.now).toISOString();
    const prev: AirForceState = ctx.state ?? { reports: [], seen: [], backfillPage: 2, recorded: [] };
    const links: { url: string; title: string }[] = [];
    const rss = await ctx.fetch(UKRINFORM_WAR_RSS);
    if (rss.kind === 'ok') {
      for (const it of rss.body.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
        const title = decodeEntities(it[1].match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1] ?? '').trim();
        const url = it[1].match(/<link>([^<]+)<\/link>/)?.[1]?.trim() ?? '';
        if (url && isAirReportLink(url, title)) links.push({ url, title });
      }
    }
    let backfillPage = prev.backfillPage;
    for (let k = 0; k < PAGES_PER_RUN && backfillPage > 0 && backfillPage <= BACKFILL_PAGES; k++, backfillPage++) {
      const page = await ctx.fetch(UKRINFORM_WAR_PAGE(backfillPage));
      if (page.kind !== 'ok') break;
      for (const m of page.body.matchAll(/href="(\/rubric-ato\/\d+-[^"]+)"/g)) if (isAirReportLink(m[1])) links.push({ url: `https://www.ukrinform.net${m[1]}`, title: '' });
    }
    if (backfillPage > BACKFILL_PAGES) backfillPage = 0;

    const seen = new Set(prev.seen);
    const titles = new Map(links.map((l) => [l.url, l.title]));
    const pending = [...new Set([...links.map((l) => l.url), ...(prev.queue ?? [])])]
      .filter((u) => !seen.has(u))
      .sort((a, b) => Number(b.match(/\/(\d+)-/)?.[1] ?? 0) - Number(a.match(/\/(\d+)-/)?.[1] ?? 0));
    const fresh: AirReport[] = [];
    for (const url of pending.slice(0, ARTICLES_PER_RUN)) {
      const res = await ctx.fetch(url);
      if (res.kind !== 'ok') continue;
      seen.add(url);
      const a = articleText(res.body);
      const r = parseAirReport(a.text, a.title || titles.get(url) || '', url, a.publishedAt);
      if (r) fresh.push(r);
    }
    const reports = mergeAirReports(prev.reports, fresh, 45, ctx.now);
    const recorded = new Set(prev.recorded);
    const lookback = new Date(ctx.now - FIRST_RUN_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
    // A night is recorded once, when its report is first read (later updates refine the panel, not the record).
    const events = reports.filter((r) => r.day >= lookback && !recorded.has(r.day)).map((r) => airRecord(r, nowIso));
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
