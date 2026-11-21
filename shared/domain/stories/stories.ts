import type { IntelligenceEvent, SourceClass } from '../types.ts';
import { getSource } from '../sources.ts';
import { matchGazetteer } from '../geo/gazetteer.ts';

/**
 * Stories: reports of the same event from different headline feeds, grouped.
 *
 * Deterministic and explainable. Two reports belong to the same story only when ALL hold:
 *  - both come from headline feeds (news and official news pages, not structured data);
 *  - they share at least MIN_SHARED distinctive headline terms, covering at least
 *    MIN_OVERLAP of the shorter headline's terms;
 *  - they were published within WINDOW_HOURS of each other;
 *  - at least one shared term is not a place name (place names alone link unrelated events);
 *  - they do not name different countries (if both name countries, at least one is shared).
 *
 * Leading labels ("Guidance:", "Official Statistics:", "Bowen:") are ignored. A group made only
 * of one official publisher's pages is not a story (those share templates, not events).
 *
 * Corroboration counts distinct PUBLISHERS (organisations), not items: two BBC pieces are
 * one source. "Multi-source" means independent outlets reported it. It does not make the
 * report true, and outlets often draw on the same news agency.
 */

/** Headline feeds whose items can form stories. Structured sources (KEV, USGS, IODA …) cannot. */
export const STORY_SOURCES = new Set([
  'bbc-world', 'aljazeera', 'un-news', 'war-gov-news', 'uk-mod', 'iaea-news',
  'af-news', 'marines-news', 'military-times', 'defense-news', 'npr-national',
]);
export const WINDOW_HOURS = 48;
export const MIN_SHARED = 3;
export const MIN_OVERLAP = 0.5;
const STEM = 6;

const STOP = new Set(
  (
    'the a an of to in on for and or by with from at as is are was were be been this that it its into over after before not do does ' +
    'has have had will would could should can may might says said say tells told amid about against than more most new first last ' +
    'how why what who when where which while just now also still one two three four five six seven eight nine ten us his her their ' +
    'they them him she he our your you we i up out off down back year years day days week weeks month months people man woman ' +
    'news live video watch analysis update updates report reports latest world global'
  ).split(' '),
);

/** "Guidance: Military low flying" → "Military low flying". At most four words before the colon. */
export const stripLabel = (title: string) => title.replace(/^\s*[\p{L}][\p{L}'’ -]{0,40}?:\s+(?=\S)/u, (m) => (m.trim().split(/\s+/).length <= 4 ? '' : m));

const stemOf = (raw: string) => (raw.length > STEM ? raw.slice(0, STEM) : raw);

/** Distinctive terms of a headline, crudely stemmed (first 6 letters) so "assassinate" matches "assassination". */
export function storyTerms(title: string): Map<string, string> {
  const out = new Map<string, string>(); // stem → first original word
  for (const raw of stripLabel(title).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw || STOP.has(raw)) continue;
    if (/^\d+$/.test(raw) ? raw.length < 2 : raw.length < 3) continue;
    const stem = stemOf(raw);
    if (!out.has(stem)) out.set(stem, raw);
  }
  return out;
}

const timeOf = (e: IntelligenceEvent) => Date.parse(e.publishedAt ?? e.collectedAt);

export type Corroboration = 'single-source' | 'multi-source' | 'official';

export interface StoryPublisher {
  sourceId: string;
  publisher: string;
  sourceClass: SourceClass;
}

export interface Story {
  /** Stable while the story's first report stays the same. */
  id: string;
  /** Most recent report: shown as the story's headline. */
  leadId: string;
  /** All reports, newest first. */
  memberIds: string[];
  publishers: StoryPublisher[];
  corroboration: Corroboration;
  /** Words shared across reports (why they were grouped). */
  sharedTerms: string[];
  firstAt: string;
  lastAt: string;
}

interface Building {
  seed: IntelligenceEvent;
  seedTerms: Map<string, string>;
  members: IntelligenceEvent[];
  shared: Map<string, string>;
}

/** Stems of the place names (countries, demonyms, cities, seas) in a headline. */
export function placeStems(title: string): Set<string> {
  const words = matchGazetteer(title).terms.flatMap((t) => t.toLowerCase().split(/[^a-z0-9]+/));
  return new Set(words.filter(Boolean).map(stemOf));
}

function match(a: Map<string, string>, b: Map<string, string>, places: Set<string>): string[] | null {
  const shared = [...a.keys()].filter((k) => b.has(k));
  if (shared.length < MIN_SHARED) return null;
  if (shared.length / Math.min(a.size, b.size) < MIN_OVERLAP) return null;
  if (!shared.some((k) => !places.has(k))) return null;
  return shared;
}

const countriesCompatible = (a: IntelligenceEvent, b: IntelligenceEvent) =>
  !a.countryCodes.length || !b.countryCodes.length || a.countryCodes.some((c) => b.countryCodes.includes(c));

const publisherOf = (e: IntelligenceEvent) => getSource(e.sourceId)?.organization ?? e.sourceName.split(' — ')[0];

/** Groups headline-feed reports into stories. Only stories with 2+ reports are returned. */
export function buildStories(events: IntelligenceEvent[]): Story[] {
  const candidates = events.filter((e) => STORY_SOURCES.has(e.sourceId)).sort((a, b) => timeOf(a) - timeOf(b) || a.id.localeCompare(b.id));
  const building: Building[] = [];
  const windowMs = WINDOW_HOURS * 3_600_000;

  for (const e of candidates) {
    const terms = storyTerms(e.title);
    const places = placeStems(e.title);
    let best: { b: Building; shared: string[] } | null = null;
    for (const b of building) {
      if (timeOf(e) - timeOf(b.members[b.members.length - 1]) > windowMs) continue;
      if (!b.members.every((m) => countriesCompatible(m, e))) continue;
      // Compare with the first report and the latest one, so a story can evolve without chaining far.
      const viaSeed = match(b.seedTerms, terms, new Set([...places, ...placeStems(b.seed.title)]));
      const latest = b.members[b.members.length - 1];
      const viaLatest = latest === b.seed ? null : match(storyTerms(latest.title), terms, new Set([...places, ...placeStems(latest.title)]));
      const shared = viaSeed ?? viaLatest;
      if (shared && (!best || shared.length > best.shared.length)) best = { b, shared };
    }
    if (best) {
      best.b.members.push(e);
      for (const s of best.shared) if (!best.b.shared.has(s)) best.b.shared.set(s, terms.get(s) ?? s);
    } else {
      building.push({ seed: e, seedTerms: terms, members: [e], shared: new Map() });
    }
  }

  return building
    .filter((b) => b.members.length > 1)
    .filter((b) => {
      // One official publisher's pages share templates, not events.
      const pubs = new Set(b.members.map(publisherOf));
      return !(pubs.size === 1 && b.members.every((m) => m.sourceClass === 'official'));
    })
    .map((b) => {
      const members = [...b.members].sort((x, y) => timeOf(y) - timeOf(x) || x.id.localeCompare(y.id));
      const pubs = new Map<string, StoryPublisher>();
      for (const m of members) {
        const publisher = publisherOf(m);
        if (!pubs.has(publisher)) pubs.set(publisher, { sourceId: m.sourceId, publisher, sourceClass: m.sourceClass });
      }
      const publishers = [...pubs.values()];
      const corroboration: Corroboration = publishers.some((p) => p.sourceClass === 'official')
        ? 'official'
        : publishers.length > 1
          ? 'multi-source'
          : 'single-source';
      return {
        id: `story-${b.seed.id}`,
        leadId: members[0].id,
        memberIds: members.map((m) => m.id),
        publishers,
        corroboration,
        sharedTerms: [...b.shared.values()].slice(0, 6),
        firstAt: new Date(timeOf(members[members.length - 1])).toISOString(),
        lastAt: new Date(timeOf(members[0])).toISOString(),
      };
    })
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

export interface FeedEntry {
  event: IntelligenceEvent;
  story: Story | null;
}

/**
 * Feed order with stories collapsed: each story appears once, at its lead (newest) report;
 * its other reports are hidden behind it. Everything else is unchanged.
 */
export function groupFeed(events: IntelligenceEvent[], stories: Story[]): FeedEntry[] {
  const storyOf = new Map<string, Story>();
  for (const s of stories) for (const id of s.memberIds) storyOf.set(id, s);
  const out: FeedEntry[] = [];
  for (const e of events) {
    const s = storyOf.get(e.id);
    if (!s) out.push({ event: e, story: null });
    else if (s.leadId === e.id) out.push({ event: e, story: s });
  }
  return out;
}

export const CORROBORATION_LABEL: Record<Corroboration, string> = {
  'single-source': 'Single source (several reports from one publisher)',
  'multi-source': 'Reported by independent publishers (not proof: outlets may share an agency source)',
  official: 'Includes official reporting (an official publisher reported it)',
};
