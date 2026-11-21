import type { IntelligenceEvent } from '../types.ts';
import type { DashboardSnapshot } from '../snapshot.ts';
import { WATCH_REGIONS, getRegion } from '../regions.ts';
import { getIndicator } from '../indicators/catalog.ts';
import { scoreDelta24h } from '../indicators/rai.ts';
import { computeHealth } from '../health.ts';
import { getSource } from '../sources.ts';
import { isOffTopic, isOpinion } from '../relevance.ts';
import { buildStories } from '../stories/stories.ts';

/**
 * Daily brief: a short, deterministic summary of the last 24 hours, built only from the
 * dashboard snapshot (no extra reads). Every line comes from a recorded item, and items link to
 * their source. It says nothing the data does not say, and states when a section is empty.
 */

export interface BriefLine {
  text: string;
  url?: string;
}

export interface BriefSection {
  title: string;
  lines: BriefLine[];
  /** Shown when there are no lines. */
  empty: string;
  /** Lines omitted to keep the brief short. */
  more: number;
}

export interface Brief {
  /** UTC date the brief is for (YYYY-MM-DD). */
  date: string;
  from: string;
  to: string;
  sections: BriefSection[];
  /** Count of relevant news items in the period (stories and single reports). */
  relevantNews: number;
}

const H = 3_600_000;
const t = (e: IntelligenceEvent) => Date.parse(e.publishedAt ?? e.collectedAt);
const short = (r: string) => getRegion(r)?.shortCode ?? r;
/** Single reports: conflict and crisis first. */
const CATEGORY_RANK: Record<string, number> = { military: 0, unrest: 1, disaster: 2, maritime: 3, aviation: 3, cyber: 3, diplomatic: 4, economic: 5 };
const catRank = (e: IntelligenceEvent) => CATEGORY_RANK[e.category] ?? 6;

function section(title: string, all: BriefLine[], max: number, empty: string): BriefSection {
  return { title, lines: all.slice(0, max), empty, more: Math.max(0, all.length - max) };
}

/** Official warnings worth a line: level changes, attributed shutdowns, high alerts, unusual seismic events, significant cyber. */
export function isNotableWarning(e: IntelligenceEvent): boolean {
  const m = e.metadata ?? {};
  switch (e.sourceId) {
    case 'state-travel-advisories':
      return m.change === 'raised' || m.change === 'new' || m.change === 'lowered';
    case 'gdacs':
      return m.alertLevel === 'Orange' || m.alertLevel === 'Red';
    case 'cloudflare-radar-outages':
      return m.outageCause === 'GOVERNMENT_DIRECTED' || m.outageCause === 'MILITARY_ACTION';
    case 'usgs-earthquakes':
      return m.seismicType !== 'earthquake' || (typeof m.magnitude === 'number' && m.magnitude >= 6.5);
    case 'cisa-advisories':
      return m.routine !== true;
    case 'cisa-kev':
      return m.knownRansomwareUse === true;
    case 'dhs-ntas':
      return true;
    case 'fema-declarations':
      return m.declarationType === 'DR';
    case 'nws-alerts':
      return true;
    default:
      return false;
  }
}

export function buildBrief(snapshot: DashboardSnapshot, now: number): Brief {
  const from = now - 24 * H;
  const recent = snapshot.events.filter((e) => t(e) >= from && t(e) <= now + H);

  // 1. Regional Activity Index
  const scores = snapshot.regionScores ?? [];
  const rai: BriefLine[] = WATCH_REGIONS.map((r) => {
    const s = scores.find((x) => x.regionId === r.id);
    if (!s || s.score === null) return { text: `${r.name}: not evaluable` };
    const d = scoreDelta24h(snapshot.scoreHistory ?? [], r.id, s.score, now);
    const delta = d === null ? 'no 24 h comparison' : d === 0 ? 'unchanged' : `${d > 0 ? '▲ +' : '▼ '}${d} in 24 h`;
    return { text: `${r.name}: ${s.score} ${s.band ?? ''} (${delta})` };
  });

  // 2. Active indicators
  const active = (snapshot.indicatorEvaluations ?? [])
    .filter((e) => e.state === 'TRIGGERED' || e.state === 'ELEVATED')
    .filter((e) => !getIndicator(e.indicatorId)?.experimental)
    .sort((a, b) => (a.state === b.state ? a.indicatorId.localeCompare(b.indicatorId) : a.state === 'TRIGGERED' ? -1 : 1))
    .map((e) => ({ text: `${e.state} · ${getIndicator(e.indicatorId)?.name ?? e.indicatorId} (${e.matchedCount} matching)` }));

  // 3. Official warnings: notable items, plus one summary line for UK travel-advice updates in watch regions.
  const warnings: BriefLine[] = recent
    .filter(isNotableWarning)
    .sort((a, b) => t(b) - t(a))
    .map((e) => ({ text: `${e.title}${e.regionIds.length ? ` [${e.regionIds.map(short).join('/')}]` : ''}`, url: e.sourceUrl }));
  const fcdo = recent.filter((e) => e.sourceId === 'uk-fcdo-travel' && e.regionIds.length);
  if (fcdo.length) {
    const names = [...new Set(fcdo.map((e) => String(e.metadata?.fcdoCountry ?? e.countryCodes[0] ?? '?')))];
    warnings.push({ text: `UK travel advice updated for ${fcdo.length} watch-region page(s): ${names.slice(0, 8).join(', ')}${names.length > 8 ? '…' : ''}`, url: 'https://www.gov.uk/foreign-travel-advice' });
  }

  // 4. Top stories: relevant headline news, grouped; multi-publisher and official first.
  const news = recent.filter((e) => e.sourceClass === 'media' || ['un-news', 'war-gov-news', 'uk-mod', 'iaea-news', 'af-news', 'marines-news'].includes(e.sourceId)).filter((e) => !isOffTopic(e) && !isOpinion(e));
  const byId = new Map(news.map((e) => [e.id, e]));
  const rank = { official: 0, 'multi-source': 1, 'single-source': 2 } as const;
  const stories = buildStories(news).sort(
    (a, b) => rank[a.corroboration] - rank[b.corroboration] || b.publishers.length - a.publishers.length || b.memberIds.length - a.memberIds.length || b.lastAt.localeCompare(a.lastAt),
  );
  const storyLines: BriefLine[] = stories.map((s) => {
    const lead = byId.get(s.leadId)!;
    const who = s.publishers.map((p) => p.publisher.replace(/ English$/, '')).join(', ');
    return { text: `${lead.title} — ${s.memberIds.length} reports (${who})${s.corroboration === 'official' ? ' · includes official' : ''}`, url: lead.sourceUrl };
  });
  const inStories = new Set(stories.flatMap((s) => s.memberIds));
  // Single reports tied to a watch region fill the list after the stories.
  for (const e of news.filter((x) => !inStories.has(x.id) && x.regionIds.length).sort((a, b) => catRank(a) - catRank(b) || t(b) - t(a))) {
    storyLines.push({ text: `${e.title} [${e.regionIds.map(short).join('/')}] — ${getSource(e.sourceId)?.organization ?? e.sourceName}`, url: e.sourceUrl });
  }

  // 5. Collector health
  const health: BriefLine[] = [];
  for (const s of snapshot.sourceStatus) {
    const h = computeHealth(s, getSource(s.sourceId)?.pollIntervalMinutes ?? null, now);
    if (h !== 'ONLINE') health.push({ text: `${getSource(s.sourceId)?.name ?? s.sourceId}: ${h}${s.lastError ? ` (${s.lastError.slice(0, 80)})` : ''}` });
  }
  if (snapshot.lastRun?.errors.length) health.push({ text: `Last run reported ${snapshot.lastRun.errors.length} error(s)` });

  return {
    date: new Date(now).toISOString().slice(0, 10),
    from: new Date(from).toISOString(),
    to: new Date(now).toISOString(),
    relevantNews: news.length,
    sections: [
      section('Regional Activity Index', rai, 7, 'No scores.'),
      section('Active indicators', active, 8, 'None: all indicators normal or not evaluable.'),
      section('Official warnings (24 h)', warnings, 8, 'No level changes, attributed shutdowns, orange/red disaster alerts or unusual seismic events.'),
      section('Top stories (24 h)', storyLines, 6, 'No relevant multi-report stories or watch-region news.'),
      section('Collector health', health, 6, `All ${snapshot.sourceStatus.length} sources online.`),
    ],
  };
}
