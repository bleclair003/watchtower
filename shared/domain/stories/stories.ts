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
 *
 * Same origin (v0.72.0): publishers whose reports credit the same news agency (Reuters, AP, AFP,
 * TASS …) or whose texts are near-identical count as ONE independent origin, so a wire story
 * reprinted by two outlets is not corroboration. `corroboratedAt` is when a second independent
 * origin first reported it.
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
  /** Independent origins: publishers, merged when they credit the same agency or carry near-identical text. */
  independentOrigins: number;
  /** Why publishers were merged, e.g. ["Reuters"] or ["near-identical text"]. */
  sharedOrigins: string[];
  /** When a second independent origin first reported it (UTC ISO), or null. */
  corroboratedAt: string | null;
}

/** News agencies whose credit in a report marks it as that agency's copy. */
export const AGENCIES: [name: string, pattern: RegExp][] = [
  ['Reuters', /\bReuters\b/],
  ['AP', /Associated Press|\(AP\)|\bAP (?:news agency|reported|reports|said)\b/],
  ['AFP', /\bAFP\b|Agence France-Presse/],
  ['Xinhua', /\bXinhua\b/],
  ['TASS', /\bTASS\b/],
  ['RIA Novosti', /\bRIA Novosti\b/],
  ['Interfax', /\bInterfax\b/],
  ['IRNA', /\bIRNA\b/],
  ['Tasnim', /\bTasnim\b/],
  ['Yonhap', /\bYonhap\b/],
  ['KCNA', /\bKCNA\b/],
  ['Anadolu', /\bAnadolu\b/],
  ['WAFA', /\bWAFA\b/],
  ['SANA', /\bSANA\b/],
];

/** Agencies a report credits, from its headline and summary. */
export function creditedAgencies(e: Pick<IntelligenceEvent, 'title' | 'summary'>): string[] {
  const text = `${e.title} ${e.summary ?? ''}`;
  return AGENCIES.filter(([, re]) => re.test(text)).map(([n]) => n);
}

/** Near-identical: at least 8 distinctive words each and 80% of them shared. */
export const NEAR_IDENTICAL = 0.8;
function nearIdentical(a: IntelligenceEvent, b: IntelligenceEvent): boolean {
  const ta = new Set(storyTerms(`${a.title} ${a.summary ?? ''}`).keys());
  const tb = new Set(storyTerms(`${b.title} ${b.summary ?? ''}`).keys());
  if (ta.size < 8 || tb.size < 8) return false;
  const shared = [...ta].filter((t) => tb.has(t)).length;
  return shared / (ta.size + tb.size - shared) >= NEAR_IDENTICAL;
}

/**
 * Independent origins among a story's reports, oldest first: publishers are merged when their reports
 * credit the same agency or are near-identical. Returns the count, the merge reasons, and when the count
 * first reached two.
 */
export function originsOf(reportsOldestFirst: IntelligenceEvent[]): { count: number; reasons: string[]; corroboratedAt: string | null } {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    while (parent.get(x) !== x) x = parent.get(x)!;
    return x;
  };
  const reasons = new Set<string>();
  const seen: IntelligenceEvent[] = [];
  let corroboratedAt: string | null = null;
  const groups = () => new Set([...parent.keys()].map(find)).size;
  for (const e of reportsOldestFirst) {
    const pub = publisherOf(e);
    if (!parent.has(pub)) parent.set(pub, pub);
    const agencies = creditedAgencies(e);
    for (const o of seen) {
      const other = publisherOf(o);
      if (other === pub) continue;
      const common = creditedAgencies(o).find((a) => agencies.includes(a));
      const same = common ?? (nearIdentical(e, o) ? 'near-identical text' : null);
      if (same && find(other) !== find(pub)) {
        parent.set(find(pub), find(other));
        reasons.add(same);
      }
    }
    seen.push(e);
    if (!corroboratedAt && groups() >= 2) corroboratedAt = new Date(timeOf(e)).toISOString();
  }
  return { count: groups(), reasons: [...reasons], corroboratedAt };
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
  // Words are computed once per report: the gazetteer scan behind placeStems is the expensive part,
  // and recomputing it for every comparison made grouping grow with the square of the input.
  const termsCache = new Map<IntelligenceEvent, Map<string, string>>();
  const placesCache = new Map<IntelligenceEvent, Set<string>>();
  const termsOf = (x: IntelligenceEvent) => termsCache.get(x) ?? (termsCache.set(x, storyTerms(x.title)), termsCache.get(x)!);
  const placesOf = (x: IntelligenceEvent) => placesCache.get(x) ?? (placesCache.set(x, placeStems(x.title)), placesCache.get(x)!);
  // Stories whose latest report is older than the window can never grow again (input is in time order).
  let open: Building[] = [];

  for (const e of candidates) {
    const terms = termsOf(e);
    const places = placesOf(e);
    open = open.filter((b) => timeOf(e) - timeOf(b.members[b.members.length - 1]) <= windowMs);
    let best: { b: Building; shared: string[] } | null = null;
    for (const b of open) {
      if (!b.members.every((m) => countriesCompatible(m, e))) continue;
      // Compare with the first report and the latest one, so a story can evolve without chaining far.
      const viaSeed = match(b.seedTerms, terms, new Set([...places, ...placesOf(b.seed)]));
      const latest = b.members[b.members.length - 1];
      const viaLatest = latest === b.seed ? null : match(termsOf(latest), terms, new Set([...places, ...placesOf(latest)]));
      const shared = viaSeed ?? viaLatest;
      if (shared && (!best || shared.length > best.shared.length)) best = { b, shared };
    }
    if (best) {
      best.b.members.push(e);
      for (const s of best.shared) if (!best.b.shared.has(s)) best.b.shared.set(s, terms.get(s) ?? s);
    } else {
      const nb: Building = { seed: e, seedTerms: terms, members: [e], shared: new Map() };
      building.push(nb);
      open.push(nb);
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
      const origins = originsOf([...members].reverse());
      const corroboration: Corroboration = publishers.some((p) => p.sourceClass === 'official')
        ? 'official'
        : origins.count > 1
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
        independentOrigins: origins.count,
        sharedOrigins: origins.reasons,
        corroboratedAt: origins.corroboratedAt,
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

/**
 * A media report from a headline feed that no independent origin has reported, once the grouping window
 * has passed (after that it can no longer gain one). Official and sensor records are never "unconfirmed".
 */
export function isUnconfirmed(e: IntelligenceEvent, story: Story | null | undefined, now: number): boolean {
  if (!STORY_SOURCES.has(e.sourceId) || e.sourceClass !== 'media') return false;
  if (story && story.corroboration !== 'single-source') return false;
  return now - timeOf(e) > WINDOW_HOURS * 3_600_000;
}

/** Story of each report (every member, not only the lead). */
export const storyIndex = (stories: Story[]) => {
  const m = new Map<string, Story>();
  for (const s of stories) for (const id of s.memberIds) m.set(id, s);
  return m;
};

export const CORROBORATION_LABEL: Record<Corroboration, string> = {
  'single-source': 'Single source (one publisher, or outlets carrying the same agency copy)',
  'multi-source': 'Reported by independent publishers (not proof: outlets may share an agency source)',
  official: 'Includes official reporting (an official publisher reported it)',
};
