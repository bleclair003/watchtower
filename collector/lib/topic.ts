import type { EventCategory } from '../../shared/domain/types.ts';

/**
 * Keyword topic classifier for general-news headlines.
 *
 * Deliberately simple and auditable: the first category (in priority order) with a
 * matching keyword wins, and the matched keyword is recorded in `metadata.topicTerm`.
 * A headline with no match is `general`. This classifies what a headline is ABOUT;
 * it says nothing about whether the report is true.
 */
const RULES: [EventCategory, string[]][] = [
  ['cyber', ['cyber', 'cyberattack', 'hack', 'hacked', 'hackers', 'ransomware', 'malware', 'data breach', 'ddos']],
  [
    'military',
    [
      'missile', 'missiles', 'drone', 'drones', 'airstrike', 'airstrikes', 'air strike', 'strike', 'strikes', 'troops', 'soldiers',
      'army', 'military', 'shelling', 'artillery', 'offensive', 'frontline', 'front line', 'war', 'warplane', 'fighter jet',
      'warship', 'navy', 'naval', 'nuclear test', 'ceasefire', 'truce', 'invasion', 'militants', 'insurgents', 'killed in attack',
      'bombing', 'rocket', 'rockets', 'mobilisation', 'mobilization', 'conscription', 'defence minister', 'defense minister',
    ],
  ],
  ['maritime', ['ship', 'ships', 'shipping', 'vessel', 'tanker', 'cargo ship', 'coast guard', 'port', 'strait', 'maritime', 'piracy', 'pirates']],
  ['aviation', ['airspace', 'flight', 'flights', 'airline', 'airport', 'plane crash', 'aircraft']],
  ['unrest', ['protest', 'protests', 'protesters', 'riot', 'riots', 'military coup', 'coup attempt', 'attempted coup', 'coup d', 'unrest', 'crackdown', 'curfew', 'state of emergency', 'clashes']],
  [
    'disaster',
    ['earthquake', 'quake', 'tsunami', 'flood', 'floods', 'flooding', 'cyclone', 'typhoon', 'hurricane', 'wildfire', 'famine', 'cholera', 'outbreak', 'landslide', 'volcano', 'eruption', 'humanitarian'],
  ],
  [
    'diplomatic',
    [
      'talks', 'summit', 'sanctions', 'sanction', 'diplomat', 'diplomats', 'diplomatic', 'ambassador', 'embassy', 'foreign minister',
      'envoy', 'treaty', 'peace deal', 'peace plan', 'negotiations', 'un security council', 'security council', 'nato', 'g7', 'g20', 'visit',
    ],
  ],
  ['economic', ['tariff', 'tariffs', 'trade war', 'oil price', 'oil prices', 'inflation', 'economy', 'recession', 'currency', 'central bank', 'exports', 'imports']],
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const COMPILED = RULES.map(([cat, words]) => ({
  cat,
  words: words.map((w) => ({ w, re: new RegExp(`(?<![\\p{L}\\p{N}])${escape(w)}(?![\\p{L}\\p{N}])`, 'iu') })),
}));

export function classifyTopic(text: string): { category: EventCategory; term: string | null } {
  for (const { cat, words } of COMPILED) {
    const hit = words.find(({ re }) => re.test(text));
    if (hit) return { category: cat, term: hit.w };
  }
  return { category: 'general', term: null };
}
