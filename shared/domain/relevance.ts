import type { EventCategory, IntelligenceEvent } from './types.ts';

/**
 * Relevance of general-news items to WATCHTOWER's purpose (geopolitics, security, disasters).
 *
 * News feeds mix in sport, entertainment, celebrity, arts, science and lifestyle pieces.
 * Those are marked OFF-TOPIC and hidden by default (never deleted; a toggle shows them).
 *
 * Rules, in order:
 *  1. Only media items can be off-topic. Official and structured sources are always relevant.
 *  2. Anything classified military, diplomatic, unrest, disaster, cyber, maritime or aviation is
 *     always relevant, whatever its other words.
 *  2b. Anything tagged to a watch region, or whose headline has a security word (assassinate,
 *     attack, kill, spy, bomb, war …), is always relevant. Found on live data: "Denmark accuses
 *     Russia of plotting to assassinate US-Ukrainian rapper" was hidden for "rapper" without this.
 *  3. The outlet's own section says sport (/sport/, /sports/) → off-topic.
 *  4. The headline contains an off-topic keyword → off-topic. The keyword is reported.
 * Keyword matching misses some items (a celebrity named without a keyword) and can, rarely,
 * hide a relevant one; the toggle shows everything, with the reason on each hidden item.
 */

const ALWAYS_RELEVANT: EventCategory[] = ['military', 'diplomatic', 'unrest', 'disaster', 'cyber', 'maritime', 'aviation'];

const OFF_TOPIC_TERMS: [string, string[]][] = [
  [
    'sport',
    [
      'football', 'soccer', 'premier league', 'champions league', 'relegation', 'world cup', 'cricket', 'tennis', 'wimbledon',
      'olympic', 'olympics', 'golf', 'rugby', 'nba', 'nfl', 'formula 1', 'formula one', 'grand prix', 'boxing', 'ufc', 'marathon',
      'striker', 'goalkeeper', 'transfer window', 'man united', 'manchester united', 'liverpool fc', 'arsenal', 'chelsea fc',
    ],
  ],
  [
    'entertainment',
    [
      'film', 'films', 'movie', 'movies', 'actor', 'actress', 'singer', 'rapper', 'album', 'oscar', 'oscars', 'grammy', 'grammys',
      'celebrity', 'celebrities', 'nepo baby', 'box office', 'netflix', 'hollywood', 'bollywood', 'tv series', 'reality show', 'pop star',
    ],
  ],
  ['arts', ['painting', 'auction', 'museum', 'art gallery', 'artwork', 'fashion', 'designer']],
  ['science', ['spacecraft', 'space mission', 'asteroid', 'comet', 'telescope', 'planet', 'dinosaur', 'fossil', 'astronaut']],
  ['lifestyle', ['recipe', 'diet', 'pets', 'pet', 'sodas', 'cola', 'restaurant', 'chef', 'wellness']],
  ['health', ['cancer', 'tumour', 'tumours', 'tumor', 'tumors', 'dementia', 'obesity']],
];

const SECURITY_WORDS = [
  'assassinate', 'assassinated', 'assassination', 'attack', 'attacks', 'attacked', 'kill', 'kills', 'killed', 'killing',
  'murder', 'murdered', 'plot', 'plotting', 'spy', 'spying', 'espionage', 'bomb', 'bombing', 'explosion', 'shooting', 'shot',
  'war', 'terror', 'terrorist', 'terrorism', 'hostage', 'kidnapped', 'sanctions', 'coup', 'troops', 'missile', 'drone',
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const COMPILED = OFF_TOPIC_TERMS.flatMap(([kind, words]) =>
  words.map((w) => ({ kind, w, re: new RegExp(`(?<![\\p{L}\\p{N}])${escape(w)}(?![\\p{L}\\p{N}])`, 'iu') })),
);

const SECURITY_RE = new RegExp(`(?<![\\p{L}\\p{N}])(${SECURITY_WORDS.map(escape).join('|')})(?![\\p{L}\\p{N}])`, 'iu');

/** Why an item is off-topic, or null if it is relevant. Pure and deterministic. */
export function offTopicReason(e: Pick<IntelligenceEvent, 'sourceClass' | 'category' | 'sourceUrl' | 'title' | 'regionIds'>): string | null {
  if (e.sourceClass !== 'media') return null;
  if (ALWAYS_RELEVANT.includes(e.category)) return null;
  if (e.regionIds.length > 0) return null;
  if (SECURITY_RE.test(e.title)) return null;
  try {
    const path = new URL(e.sourceUrl).pathname;
    if (/^\/sports?\//.test(path)) return 'Filed under sport by the outlet';
  } catch {
    // no usable URL: fall through to keywords
  }
  const hit = COMPILED.find((c) => c.re.test(e.title));
  return hit ? `${hit.kind[0].toUpperCase()}${hit.kind.slice(1)} keyword in headline: "${hit.w}"` : null;
}

export const isOffTopic = (e: IntelligenceEvent) => offTopicReason(e) !== null;
