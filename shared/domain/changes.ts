import type { IntelligenceEvent } from './types.ts';
import type { IndicatorEvaluation, IndicatorState, RegionScore, ScoreHistoryPoint } from './indicators/types.ts';
import { getIndicator } from './indicators/catalog.ts';
import { scoreDelta24h } from './indicators/rai.ts';
import { isOffTopic, isOpinion } from './relevance.ts';
import { buildStories } from './stories/stories.ts';

/**
 * "What changed": a per-region diff against about 24 hours ago, built only from data already
 * loaded (no extra reads). Indicator state changes, RAI change, stories whose first report is new,
 * and notable official warnings.
 */

const H = 3_600_000;
const t = (e: IntelligenceEvent) => Date.parse(e.publishedAt ?? e.collectedAt);

/** Official outlets whose news posts count as news alongside media. */
export const OFFICIAL_NEWS_SOURCES = ['un-news', 'war-gov-news', 'uk-mod', 'iaea-news', 'af-news', 'marines-news'];
export const isNews = (e: IntelligenceEvent) => (e.sourceClass === 'media' || OFFICIAL_NEWS_SOURCES.includes(e.sourceId)) && !isOffTopic(e) && !isOpinion(e);

/** Official warnings worth a line: level changes, attributed shutdowns, high alerts, unusual seismic events, significant cyber, embassy drawdowns. */
export function isNotableWarning(e: IntelligenceEvent): boolean {
  const m = e.metadata ?? {};
  switch (e.sourceId) {
    case 'state-travel-advisories':
      return m.change === 'raised' || m.change === 'new' || m.change === 'lowered' || m.postureChange != null;
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

const RANK: Record<IndicatorState, number> = { NORMAL: 0, ELEVATED: 1, TRIGGERED: 2, UNKNOWN: -1, DATA_UNAVAILABLE: -1, DISABLED: -1 };
const isActive = (s: IndicatorState) => s === 'ELEVATED' || s === 'TRIGGERED';

export interface IndicatorChange {
  indicatorId: string;
  regionId: string;
  name: string;
  /** null = first evaluation; undefined = not recorded (evaluations before v0.32.0). */
  from: IndicatorState | null | undefined;
  to: IndicatorState;
  at: string;
  direction: 'up' | 'down' | 'other';
}

const DIR_ORDER = { up: 0, down: 1, other: 2 } as const;

/**
 * Indicators whose state changed in the last 24 hours (experimental ones left out). A change into
 * NORMAL, UNKNOWN or DATA_UNAVAILABLE is shown only when the earlier state is known, so newly
 * added indicators and pre-v0.32 data never appear as false "returned to normal" lines.
 */
export function indicatorChanges(evaluations: IndicatorEvaluation[], now: number, regionId?: string): IndicatorChange[] {
  const from = now - 24 * H;
  return evaluations
    .filter((e) => (!regionId || e.regionId === regionId) && Date.parse(e.stateSince) >= from && Date.parse(e.stateSince) <= now + H)
    .flatMap((e): IndicatorChange[] => {
      const def = getIndicator(e.indicatorId);
      if (!def || def.experimental) return [];
      const prev = e.previousState;
      if (prev === e.state) return [];
      if (!isActive(e.state) && (prev === undefined || prev === null)) return [];
      const direction: IndicatorChange['direction'] =
        prev === undefined || prev === null ? 'up' : RANK[e.state] < 0 || RANK[prev] < 0 ? 'other' : RANK[e.state] > RANK[prev] ? 'up' : 'down';
      return [{ indicatorId: e.indicatorId, regionId: e.regionId, name: def.name, from: prev, to: e.state, at: e.stateSince, direction }];
    })
    .sort((a, b) => DIR_ORDER[a.direction] - DIR_ORDER[b.direction] || b.at.localeCompare(a.at));
}

export interface NewStory {
  title: string;
  url: string;
  reports: number;
  publishers: number;
  official: boolean;
  firstAt: string;
}

export interface RegionChanges {
  regionId: string;
  rai: { score: number | null; delta: number | null };
  indicators: IndicatorChange[];
  /** Stories (one or more reports) whose first report is from the last 24 hours. Multi-publisher first. */
  newStories: NewStory[];
  warnings: IntelligenceEvent[];
  /** Region records in the last 24 h and the 24 h before. */
  records: { last24h: number; previous24h: number };
}

export interface ChangesInput {
  events: IntelligenceEvent[];
  indicatorEvaluations: IndicatorEvaluation[];
  regionScores: RegionScore[];
  scoreHistory: ScoreHistoryPoint[];
}

export function regionChanges(data: ChangesInput, regionId: string, now: number): RegionChanges {
  const from = now - 24 * H;
  const inRegion = data.events.filter((e) => e.regionIds.includes(regionId) && t(e) <= now + H);
  const last = inRegion.filter((e) => t(e) >= from);
  const score = data.regionScores.find((s) => s.regionId === regionId)?.score ?? null;

  // Stories over 48 h so a story that began yesterday is not mistaken for a new one.
  const news = inRegion.filter((e) => t(e) >= now - 48 * H && isNews(e));
  const byId = new Map(news.map((e) => [e.id, e]));
  const newStories = buildStories(news)
    .filter((s) => Date.parse(s.firstAt) >= from)
    .map((s): NewStory => {
      const lead = byId.get(s.leadId)!;
      return { title: lead.title, url: lead.sourceUrl, reports: s.memberIds.length, publishers: s.publishers.length, official: s.corroboration === 'official', firstAt: s.firstAt };
    })
    .sort((a, b) => b.publishers - a.publishers || b.reports - a.reports || b.firstAt.localeCompare(a.firstAt));

  return {
    regionId,
    rai: { score, delta: scoreDelta24h(data.scoreHistory, regionId, score, now) },
    indicators: indicatorChanges(data.indicatorEvaluations, now, regionId),
    newStories,
    warnings: last.filter(isNotableWarning).sort((a, b) => t(b) - t(a)),
    records: { last24h: last.length, previous24h: inRegion.filter((e) => t(e) >= from - 24 * H && t(e) < from).length },
  };
}

/** "ELEVATED → TRIGGERED"; "now ELEVATED" when the earlier state was not recorded; "first evaluation · ELEVATED". */
export function describeChange(c: IndicatorChange): string {
  if (c.from === undefined) return `now ${c.to}`;
  if (c.from === null) return `first evaluation · ${c.to}`;
  return `${c.from} → ${c.to}`;
}
