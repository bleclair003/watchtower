import type { IntelligenceEvent } from './types.ts';
import { compileWatchlist, type WatchItem } from './watchlist.ts';
import { isPlaceName } from './geo/gazetteer.ts';
import { isUsPlaceName } from './geo/usPlaces.ts';
import { isNews } from './changes.ts';

/**
 * Phase 15 item 4: people and groups.
 *
 *  - Known actors: a curated list (names and spellings only — no titles, which go out of date),
 *    counted in record titles and summaries per region over time.
 *  - New names: candidate proper names in sentence-case headlines that WATCHTOWER has never seen
 *    before. Heuristic: capitalised word runs, minus places, institutions and known actors.
 */

export type ActorKind = 'group' | 'person' | 'force';
export interface Actor {
  id: string;
  name: string;
  kind: ActorKind;
  regionIds: string[];
  aliases: string[];
}

const a = (id: string, name: string, kind: ActorKind, regionIds: string[], aliases: string[] = []): Actor => ({ id, name, kind, regionIds, aliases });
const ME = ['middle-east'];
const RS = ['red-sea'];
const EE = ['eastern-europe'];
const TW = ['taiwan-strait'];
const KO = ['korean-peninsula'];
const SC = ['south-china-sea'];
const US = ['united-states'];

/** Edit this list to change who is tracked. Short all-capital aliases (IRGC, PLA) match only in capitals. */
export const ACTORS: Actor[] = [
  // Middle East
  a('hamas', 'Hamas', 'group', ME, ['Qassam Brigades', 'al-Qassam']),
  a('hezbollah', 'Hezbollah', 'group', ME, ['Hizbollah', 'Hizbullah']),
  a('irgc', 'IRGC', 'force', ME, ['Revolutionary Guard', 'Revolutionary Guards', 'Quds Force']),
  a('islamic-jihad', 'Islamic Jihad', 'group', ME, ['PIJ']),
  a('isis', 'Islamic State', 'group', [...ME, ...RS], ['ISIS', 'ISIL', 'Daesh']),
  a('kataib-hezbollah', 'Kataib Hezbollah', 'group', ME, ['Kata’ib Hezbollah', 'Islamic Resistance in Iraq']),
  a('idf', 'IDF', 'force', ME, ['Israel Defense Forces', 'Israeli military', 'Israeli army']),
  a('netanyahu', 'Netanyahu', 'person', ME),
  a('khamenei', 'Khamenei', 'person', ME),
  a('pezeshkian', 'Pezeshkian', 'person', ME),
  a('araghchi', 'Araghchi', 'person', ME),
  a('qassem', 'Naim Qassem', 'person', ME),
  a('sharaa', 'al-Sharaa', 'person', ME, ['Ahmed al-Sharaa', 'Jolani']),
  a('mbs', 'Mohammed bin Salman', 'person', ME, ['MBS']),
  // Red Sea and Horn of Africa
  a('houthis', 'Houthis', 'group', [...RS, ...ME], ['Houthi', 'Ansar Allah', 'Ansarallah']),
  a('al-shabaab', 'al-Shabaab', 'group', RS, ['al Shabaab', 'Shabab']),
  a('aqap', 'AQAP', 'group', RS, ['al-Qaeda in the Arabian Peninsula']),
  // Eastern Europe
  a('putin', 'Putin', 'person', EE),
  a('zelensky', 'Zelensky', 'person', EE, ['Zelenskyy', 'Zelenskiy']),
  a('lukashenko', 'Lukashenko', 'person', EE),
  a('belousov', 'Belousov', 'person', EE),
  a('gerasimov', 'Gerasimov', 'person', EE),
  a('syrskyi', 'Syrskyi', 'person', EE, ['Syrsky']),
  a('wagner', 'Wagner', 'group', EE, ['Africa Corps', 'Wagner Group']),
  a('kadyrov', 'Kadyrov', 'person', EE),
  a('nato', 'NATO', 'force', EE),
  // Taiwan Strait and South China Sea
  a('pla', 'PLA', 'force', [...TW, ...SC], ["People's Liberation Army", 'People’s Liberation Army', 'Eastern Theater Command']),
  a('china-coast-guard', 'China Coast Guard', 'force', [...TW, ...SC], ['Chinese coast guard']),
  a('xi', 'Xi Jinping', 'person', [...TW, ...SC]),
  a('lai', 'Lai Ching-te', 'person', TW, ['William Lai']),
  a('kmt', 'Kuomintang', 'group', TW, ['KMT']),
  a('philippine-coast-guard', 'Philippine Coast Guard', 'force', SC, ['PCG']),
  a('marcos', 'Marcos', 'person', SC),
  // Korean Peninsula
  a('kim-jong-un', 'Kim Jong Un', 'person', KO, ['Kim Jong-un']),
  a('kim-yo-jong', 'Kim Yo Jong', 'person', KO, ['Kim Yo-jong']),
  a('lee-jae-myung', 'Lee Jae-myung', 'person', KO, ['Lee Jae Myung']),
  // United States
  a('trump', 'Trump', 'person', US),
  a('hegseth', 'Hegseth', 'person', US),
  a('rubio', 'Rubio', 'person', US),
  a('vance', 'Vance', 'person', US),
  a('centcom', 'CENTCOM', 'force', [...US, ...ME, ...RS], ['Central Command']),
  a('indopacom', 'INDOPACOM', 'force', [...US, ...TW, ...SC, ...KO], ['Indo-Pacific Command']),
];

const asWatchItem = (x: Actor): WatchItem => ({ id: x.id, term: x.name, kind: x.kind === 'person' ? 'person' : 'unit', aliases: x.aliases, alert: false, severity: 'INFORMATION', createdAt: '' });
/** Matcher over the actor list (same whole-word rules as the watchlist). */
export function actorMatcher(list: Actor[] = ACTORS): (e: IntelligenceEvent) => Actor[] {
  const match = compileWatchlist(list.map(asWatchItem));
  const byId = new Map(list.map((x) => [x.id, x]));
  return (e) => match(e).map((h) => byId.get(h.item.id)!);
}

// ---------------------------------------------------------------- new names

/** Sources whose headlines are in sentence case (checked 2026-11-21): capitals there mark names. */
export const SENTENCE_CASE_SOURCES = ['bbc-world', 'aljazeera', 'un-news', 'npr-national', 'defense-news', 'military-times'];

const COMMON =
  /^(a|an|the|and|or|but|as|at|by|for|from|in|into|of|on|onto|over|to|with|without|after|before|amid|against|during|under|up|down|out|about|says|said|say|how|why|what|when|where|who|which|will|would|could|should|can|may|might|must|is|are|was|were|be|been|has|have|had|new|top|live|watch|analysis|explainer|exclusive|breaking|update|updates|opinion|inside|meet|first|last|more|most|after|this|that|these|those|its|his|her|their|our|we|you|they|it|he|she|no|not|yes|all|some|one|two|three|four|five|six|seven|eight|nine|ten|dozens|hundreds|thousands|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|mr|mrs|ms|dr|sir|president|prime|minister|foreign|defence|defense|secretary|chief|general|gen|admiral|leader|king|queen|prince|pope|senator|sen|rep|governor|mayor|judge|court|army|navy|police|government|ministry|parliament|state|states|united|nations|union|council|security|assembly|house|senate|congress|white|national|international|world|global|north|south|east|west|central|western|eastern|northern|southern|republic|democratic|party|bank|fund|group|company|inc|ltd|day|week|year|years|month|cup|league|award|awards|summit|talks|deal|war|peace|crisis|attack|strike|ceasefire|news|report|reports|bill|act|law|plan|policy|election|elections|vote|votes|campaign|official|officials|former|ex|acting|deputy|vice|un|eu|us|uk|nato|ai|cop|weekly|daily|full|episode|podcast|video|coast|guard|corps|marine|marines|line|bridge|curtain|iron|yellow|red|green|blue|black|person|managing|brief|progress|civilian|civilians|atrocious|historic|muslims|muslim|shia|sunni|christian|christians|jewish|arab|arabs|sikh|based|forces|force|troops|military|ministry|agency|office|service|services|committee|commission|programme|program|forum|center|centre|institute|university|school|hospital|airport|port|station|base|camp|fort|street|road|square|city|county|province|region|district|island|islands|sea|ocean|river|valley|mountain|mountains|strait|gulf|bay|canal|corridor|zone|front)$/i;
const PARTICLE = /^(al|el|bin|bint|ibn|abu|de|da|di|du|van|von|der|la|le)$/i;
const cleanToken = (w: string) => w.replace(/^[‘'"“(\[]+|[’'"”)\],.:;!?]+$/g, '').replace(/[’']s$/i, '');
const isCap = (w: string) => /^\p{Lu}[\p{L}’'-]*$/u.test(w) && !/^\p{Lu}+$/u.test(w.replace(/[-’']/g, '')) || /^\p{Lu}\p{Ll}/u.test(w);

/** Candidate names (2–4 words) in a sentence-case headline. */
export function extractNames(title: string): string[] {
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    // Trim common words from both ends ("Top US Democrat" → nothing; "Steve Rosenberg" stays).
    while (run.length && (COMMON.test(run[0]) || PARTICLE.test(run[0]))) run.shift();
    while (run.length && (COMMON.test(run[run.length - 1]) || PARTICLE.test(run[run.length - 1]))) run.pop();
    const capitals = run.filter((w) => !PARTICLE.test(w));
    if (run.length >= 2 && run.length <= 4 && capitals.length >= 2 && !capitals.some((w) => COMMON.test(w) || /\d/.test(w))) {
      const name = run.join(' ');
      // Places and phrases made only of place words ("South Korea", "West Bank", "Gaza City") are not names.
      // People and groups rarely carry place words; phrases that do ("Crimean Bridge", "Kerch Bridge") are left out.
      if (!isPlaceName(name) && !isUsPlaceName(name) && !capitals.some((w) => isPlaceName(w) || isUsPlaceName(w))) out.push(name);
    }
    run = [];
  };
  for (const raw of title.split(/\s+/)) {
    const w = cleanToken(raw);
    // Punctuation and possessives end a name ("Ukraine: Civilian …", "India’s Manipur").
    const ends = /[:;,|–—]$|[’']s[,:;]?$/i.test(raw) || /^[‘'"“(]/.test(raw);
    if (/^[‘'"“(]/.test(raw)) flush();
    if (w && isCap(w) && /\p{L}/u.test(w)) run.push(w);
    else if (w && run.length && PARTICLE.test(w.split('-')[0])) run.push(w);
    else flush();
    if (ends) flush();
  }
  flush();
  return [...new Set(out)];
}

export const normName = (n: string) => n.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();

/** Whether a candidate is a known actor (so not "new"). */
export function isKnownActor(name: string, match = actorMatcher()): boolean {
  return match({ title: name, summary: '' } as IntelligenceEvent).length > 0;
}

export const isNameSource = (e: IntelligenceEvent) => SENTENCE_CASE_SOURCES.includes(e.sourceId) && isNews(e);

// ---------------------------------------------------------------- snapshot

export interface ActorStat {
  id: string;
  name: string;
  kind: ActorKind;
  regionIds: string[];
  last24h: number;
  last72h: number;
  last7d: number;
  /** Mean mentions per 72 h over earlier history, or null while building (14 days). */
  usual72h: number | null;
  rising: boolean;
  /** Mentions per UTC day, oldest first, last 14 days. */
  daily: number[];
}

export interface NewName {
  name: string;
  firstSeen: string;
  mentions: number;
  publishers: number;
  regionIds: string[];
  sample: { title: string; url: string };
}

export interface ActorsSnapshot {
  computedAt: string;
  /** When new-name tracking began (names seen before then are never "new"). */
  trackingSince: string;
  actors: ActorStat[];
  newNames: NewName[];
  simulated?: boolean;
}
