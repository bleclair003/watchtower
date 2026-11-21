import type { IntelligenceEvent } from './types.ts';
import { STORY_SOURCES, buildStories } from './stories/stories.ts';
import { isNews } from './changes.ts';
import { isStrikeNews } from './meters/signals.ts';

/**
 * Phase 15 item 5: coverage gaps — stories that only one side reports.
 *
 * Sides (edit to change): Al Jazeera; BBC; US media (NPR, Defense News, Military Times); official
 * sources (UN News, war.gov, UK MOD, IAEA, Air Force, Marines). A possible gap is a story about
 * the region from one side only, while at least one other side was reporting on the region, that
 * either ran 2+ reports on that side or is a strike/attack report.
 *
 * Stories are grouped by shared place and topic words (see stories.ts), so two differently worded
 * reports of the same event can look like a gap: these are possible gaps, not proof of silence.
 */

export const SIDES = [
  { id: 'aljazeera', label: 'Al Jazeera', sources: ['aljazeera'] },
  { id: 'bbc', label: 'BBC', sources: ['bbc-world'] },
  { id: 'us-media', label: 'US media', sources: ['npr-national', 'defense-news', 'military-times'] },
  { id: 'official', label: 'Official', sources: ['un-news', 'war-gov-news', 'uk-mod', 'iaea-news', 'af-news', 'marines-news'] },
] as const;
export type SideId = (typeof SIDES)[number]['id'];
export const sideOf = (sourceId: string): SideId | null => SIDES.find((s) => (s.sources as readonly string[]).includes(sourceId))?.id ?? null;
export const sideLabel = (id: SideId) => SIDES.find((s) => s.id === id)!.label;

/** A side counts as covering the region with at least this many reports about it in the window. */
export const ACTIVE_MIN = 3;
export const COVERAGE_WINDOW_HOURS = 72;

export interface CoverageGap {
  side: SideId;
  title: string;
  url: string;
  at: string;
  reports: number;
  kind: 'story' | 'strike';
  /** Sides that were reporting on the region but not this story. */
  missingFrom: SideId[];
}

export interface Coverage {
  regionId: string;
  windowHours: number;
  sides: { id: SideId; label: string; reports: number; active: boolean }[];
  gaps: CoverageGap[];
  /** Set when only one side reported on the region at all. */
  onlySide: SideId | null;
}

const at = (e: IntelligenceEvent) => Date.parse(e.publishedAt ?? e.collectedAt);

const STOP = new Set('a an the and or but as at by for from in into of on onto over to with after before amid against during under about says said say how why what when where who will would could can may is are was were be been has have had its his her their this that these those it he she they we you new more most first last up down out no not two three four five six seven eight nine ten dozens hundreds report reports news live latest day days week year years'.split(' '));
/** Lower-cased, de-pluralised content words: a crude stem so "missiles" meets "missile" and "hits" meets "hit". */
export function stems(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[’']s\b/g, '')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map((w) => w.replace(/(ies)$/, 'y').replace(/(es|s|ing|ed)$/, '').slice(0, 7)),
  );
}
/** Another side has a report sharing 2+ content stems: treat the story as covered (fewer false gaps). */
const coveredElsewhere = (lead: IntelligenceEvent, others: IntelligenceEvent[]) => {
  const mine = stems(lead.title);
  return others.some((o) => {
    let shared = 0;
    for (const w of stems(o.title)) if (mine.has(w) && ++shared >= 2) return true;
    return false;
  });
};

export function coverageGaps(events: IntelligenceEvent[], regionId: string, now: number, windowHours = COVERAGE_WINDOW_HOURS): Coverage {
  const from = now - windowHours * 3_600_000;
  // Stories are built over a longer span, so a story that began earlier is not split.
  const news = events.filter((e) => e.regionIds.includes(regionId) && STORY_SOURCES.has(e.sourceId) && isNews(e) && at(e) >= from - 24 * 3_600_000 && at(e) <= now + 3_600_000);
  const recent = news.filter((e) => at(e) >= from);
  const sides = SIDES.map((s) => {
    const reports = recent.filter((e) => sideOf(e.sourceId) === s.id).length;
    return { id: s.id as SideId, label: s.label, reports, active: reports >= ACTIVE_MIN };
  });
  const active = sides.filter((s) => s.active).map((s) => s.id);
  const reporting = sides.filter((s) => s.reports > 0).map((s) => s.id);
  const byId = new Map(news.map((e) => [e.id, e]));
  const stories = buildStories(news);
  const grouped = new Set(stories.flatMap((s) => s.memberIds));
  const gaps: CoverageGap[] = [];
  const consider = (members: IntelligenceEvent[], kind: CoverageGap['kind']) => {
    const lead = [...members].sort((a, b) => at(b) - at(a))[0];
    if (at(lead) < from) return;
    const own = [...new Set(members.map((e) => sideOf(e.sourceId)).filter((x): x is SideId => !!x))];
    if (own.length !== 1) return;
    const missingFrom = active.filter((s) => s !== own[0]);
    if (!missingFrom.length) return;
    if (coveredElsewhere(lead, news.filter((e) => sideOf(e.sourceId) !== own[0]))) return;
    gaps.push({ side: own[0], title: lead.title, url: lead.sourceUrl, at: lead.publishedAt ?? lead.collectedAt, reports: members.length, kind, missingFrom });
  };
  for (const s of stories) {
    const members = s.memberIds.map((id) => byId.get(id)!).filter(Boolean);
    if (members.length >= 2) consider(members, 'story');
  }
  for (const e of news) if (!grouped.has(e.id) && isStrikeNews(e)) consider([e], 'strike');
  gaps.sort((a, b) => b.reports - a.reports || b.at.localeCompare(a.at));
  return { regionId, windowHours, sides, gaps: gaps.slice(0, 12), onlySide: reporting.length === 1 ? reporting[0] : null };
}
