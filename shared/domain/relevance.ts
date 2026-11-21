import type { EventCategory, IntelligenceEvent } from './types.ts';

/**
 * Relevance of news items to WATCHTOWER's purpose.
 *
 * A NEWS item (sourceClass 'media') is shown only when its headline is about a relevant topic:
 * security and conflict, diplomacy, politics and government, elections, law and rights at
 * national or international level, migration and humanitarian crises, disasters and health
 * emergencies, energy, trade and the macro-economy. Everything else (sport, entertainment,
 * celebrity, lifestyle, local crime, company news …) is OFF-TOPIC: hidden by default, never
 * deleted, and shown with its reason when the feed toggle is on.
 *
 * Rules, in order:
 *  1. Official and structured sources are always relevant (they are chosen for relevance).
 *  2. A news item already classified military, diplomatic, unrest, disaster, cyber, maritime,
 *     aviation or economic is relevant.
 *  3. Otherwise it is relevant only if its headline contains a relevant-topic word (listed below);
 *     the matched word is reported.
 *  4. Anything else is off-topic. The outlet's own sport section, or a sport/entertainment word,
 *     is reported as the reason when present; otherwise "no relevant topic in the headline".
 *
 * Watch regions do NOT decide relevance: world news outside the watch regions is kept when the
 * topic is relevant. Keyword matching can miss a relevant item worded unusually; the toggle
 * shows everything.
 */

const RELEVANT_CATEGORIES: EventCategory[] = ['military', 'diplomatic', 'unrest', 'disaster', 'cyber', 'maritime', 'aviation', 'economic'];

const RELEVANT_TOPICS: [string, string[]][] = [
  [
    'security',
    [
      'assassinate', 'assassinated', 'assassination', 'attack', 'attacks', 'attacked', 'kill', 'kills', 'killed', 'killing',
      'murder', 'murdered', 'massacre', 'plot', 'plotting', 'spy', 'spying', 'espionage', 'bomb', 'bombing', 'explosion', 'shooting',
      'war', 'conflict', 'terror', 'terrorist', 'terrorism', 'extremist', 'militia', 'rebel', 'rebels', 'insurgent', 'hostage',
      'kidnapped', 'abducted', 'besieged', 'siege', 'armed', 'weapons', 'nuclear', 'intelligence', 'cartel', 'gang', 'gangs',
      // Combat verbs. Found on live data: "Russia targets Kyiv crossings days after Ukraine hits Crimean Bridge" was missed.
      'target', 'targets', 'targeted', 'targeting', 'hits', 'strike', 'strikes', 'struck', 'raid', 'raids', 'shelling', 'shelled',
      'invasion', 'invade', 'offensive', 'frontline', 'front line', 'ceasefire', 'truce', 'troops', 'soldiers', 'army', 'military',
      'missile', 'missiles', 'drone', 'drones', 'airstrike', 'airstrikes', 'navy', 'warship', 'sabotage', 'occupied', 'occupation',
    ],
  ],
  [
    'heads of state',
    [
      'putin', 'zelensky', 'zelenskyy', 'trump', 'xi jinping', 'xi', 'netanyahu', 'khamenei', 'erdogan', 'erdoğan', 'modi',
      'kim jong un', 'lukashenko', 'macron', 'starmer', 'merz', 'guterres', 'sharif', 'lai ching-te', 'pezeshkian',
    ],
  ],
  [
    'politics',
    [
      'election', 'elections', 'vote', 'voters', 'referendum', 'president', 'presidential', 'prime minister', 'pm', 'parliament',
      'congress', 'senate', 'government', 'minister', 'ministry', 'cabinet', 'opposition', 'regime', 'coalition', 'leader',
      'leaders', 'party', 'midterm', 'midterms', 'impeachment', 'policy', 'brexit', 'eu', 'nato', 'un', 'g7', 'g20', 'kremlin',
      'white house', 'state department', 'foreign', 'sovereignty', 'annex', 'annexation', 'independence',
    ],
  ],
  [
    'law and rights',
    [
      'genocide', 'war crimes', 'human rights', 'rights', 'icc', 'icj', 'tribunal', 'top court', 'supreme court', 'constitution',
      'crackdown', 'censorship', 'detained', 'detention', 'political prisoner', 'death sentence', 'sentenced to death', 'executions',
      'persecution', 'religious', 'minority', 'shia', 'sunni', 'separatist',
    ],
  ],
  [
    'humanitarian',
    [
      'refugee', 'refugees', 'migrant', 'migrants', 'migration', 'asylum', 'border', 'borders', 'displaced', 'humanitarian', 'aid',
      'famine', 'hunger', 'starvation', 'ebola', 'cholera', 'outbreak', 'epidemic', 'pandemic', 'crisis',
    ],
  ],
  [
    'economy',
    [
      'economy', 'economic', 'inflation', 'recession', 'tariff', 'tariffs', 'trade', 'exports', 'imports', 'sanctions', 'oil',
      'gas', 'energy', 'pipeline', 'currency', 'central bank', 'interest rates', 'debt', 'imf', 'world bank', 'markets', 'credit rating',
      'supply chain', 'chips', 'semiconductor', 'data centres', 'data centers',
    ],
  ],
  ['disaster', ['earthquake', 'flood', 'floods', 'wildfire', 'cyclone', 'typhoon', 'hurricane', 'tsunami', 'drought', 'disaster', 'fire']],
];

const OFF_TOPIC_HINTS: [string, string[]][] = [
  ['sport', ['football', 'soccer', 'premier league', 'champions league', 'relegation', 'cricket', 'tennis', 'wimbledon', 'olympic', 'olympics', 'golf', 'rugby', 'nba', 'nfl', 'grand prix']],
  ['entertainment', ['film', 'movie', 'actor', 'actress', 'singer', 'album', 'oscars', 'grammys', 'celebrity', 'nepo baby', 'netflix', 'hollywood']],
  ['arts', ['painting', 'auction', 'museum', 'artwork', 'fashion']],
  ['lifestyle', ['recipe', 'diet', 'pets', 'sodas', 'cola', 'restaurant']],
  ['science', ['spacecraft', 'asteroid', 'telescope', 'planet', 'dinosaur', 'fossil']],
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const word = (w: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(w)}(?![\\p{L}\\p{N}])`, 'iu');
// "PM", "EU", "UN" are matched case-sensitively so "un-" or "eu" inside words never count.
const UPPER_ONLY = new Set(['pm', 'eu', 'un', 'g7', 'g20', 'imf', 'icc', 'icj', 'nato', 'nba', 'nfl']);
const compile = (table: [string, string[]][]) =>
  table.flatMap(([kind, words]) =>
    words.map((w) => ({
      kind,
      w,
      re: UPPER_ONLY.has(w) ? new RegExp(`(?<![\\p{L}\\p{N}])${escape(w.toUpperCase())}(?![\\p{L}\\p{N}])`, 'u') : word(w),
    })),
  );
const RELEVANT = compile(RELEVANT_TOPICS);
const HINTS = compile(OFF_TOPIC_HINTS);

type RelevanceInput = Pick<IntelligenceEvent, 'sourceClass' | 'category' | 'sourceUrl' | 'title'>;

/** The relevant topic word that keeps a news item, or null. */
export function relevantTopic(e: RelevanceInput): string | null {
  if (e.sourceClass !== 'media') return 'official or structured source';
  if (RELEVANT_CATEGORIES.includes(e.category)) return `${e.category} topic`;
  const hit = RELEVANT.find((c) => c.re.test(e.title));
  return hit ? `${hit.kind}: "${hit.w}"` : null;
}

/** Why an item is off-topic, or null if it is relevant. Pure and deterministic. */
export function offTopicReason(e: RelevanceInput): string | null {
  if (relevantTopic(e)) return null;
  try {
    if (/^\/sports?\//.test(new URL(e.sourceUrl).pathname)) return 'Filed under sport by the outlet';
  } catch {
    // no usable URL
  }
  const hint = HINTS.find((c) => c.re.test(e.title));
  return hint ? `${hint.kind[0].toUpperCase()}${hint.kind.slice(1)} ("${hint.w}"); no relevant topic in the headline` : 'No relevant topic in the headline';
}

export const isOffTopic = (e: IntelligenceEvent) => offTopicReason(e) !== null;

/** Opinion and comment columns (by the outlet's own section): an author's view, not a report of events. */
export const isOpinion = (e: Pick<IntelligenceEvent, 'sourceUrl'>) => /\/(opinions?|commentisfree|comment)\//.test(e.sourceUrl);
