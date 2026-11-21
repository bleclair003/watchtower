/**
 * Phase 15 item 3: language temperature. Open word lists, scored over news headlines.
 *
 * Edit the lists below to adjust the meter: each entry is a regular expression (matched as whole
 * words, any case) and a weight. A headline's score is (escalation weights) − (de-escalation
 * weights), capped at ±2. A region's temperature is the mean headline score × 50, from −100
 * (calming language) to +100 (escalating language); headlines with no listed words count as 0.
 *
 * Reversals: a de-escalation word next to a failure word ("ceasefire collapses", "talks stall",
 * "truce violated") counts as escalation instead.
 *
 * Limits: headlines only, English only, no sense of who says what. "Warns" from a weather service
 * and from a defence minister look the same; the topic filter (news about watch regions, opinion
 * columns excluded) does most of the work of keeping the input relevant.
 */

export interface Term {
  /** Shown in the meter's evidence. */
  label: string;
  re: RegExp;
  weight: number;
}

const t = (label: string, pattern: string, weight = 1): Term => ({ label, re: new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, 'iu'), weight });

export const ESCALATION: Term[] = [
  t('airstrike', 'air ?strikes?|airstrikes?', 2),
  t('invasion', 'invasion|invades?|invaded|invading', 2),
  t('mobilisation', 'mobili[sz]ation|mobili[sz]es?|mobili[sz]ed', 2),
  t('martial law', 'martial law', 2),
  t('nuclear threat', 'nuclear (?:threat|warning|strike|attack)s?', 2),
  t('strike', 'strikes?|struck|striking', 1),
  // "attack" as an adjective (attack drones, attack helicopters) is equipment, not an act.
  t('attack', 'attacks?(?! (?:drones?|helicopters?|submarines?|aircraft|jets?|craft))|attacked|attacking', 1),
  // Weapons named on their own are often topics ("missile shortages"); the act words above carry the weight.
  t('missile', 'missiles?|rockets?|ballistic', 0.5),
  t('drone', 'drones?', 0.5),
  t('shelling', 'shell(?:ing|ed)|shells (?:city|town|village|positions)|bombard(?:ment|s|ed|ing)?|bomb(?:ing|ed)', 1),
  t('weapon hits', '(?:missiles?|rockets?|drones?|shells?) (?:hit|hits|struck|slam(?:s|med)? into)', 1),
  t('offensive', 'offensives?|counter-?offensive', 1),
  t('escalation', 'escalat(?:e|es|ed|ing|ion)', 1),
  t('retaliation', 'retaliat(?:e|es|ed|ion|ory)|revenge|vows? to respond', 1),
  t('clashes', 'clash(?:es|ed)?|firefights?|skirmish(?:es)?', 1),
  t('killed', 'killed|kills|dead|deaths|casualties|wounded', 0.5),
  t('blockade', 'blockades?|blockaded|seiz(?:e|es|ed|ure)|hijack(?:ed|ing)?', 1),
  t('shot down', 'shoots? down|shot down|downs|downed|intercept(?:s|ed|ion|ions)?', 1),
  t('troops', 'troops|deploy(?:s|ed|ing)? (?:troops|forces|soldiers|warships?|carriers?|missiles?|bombers?)|reinforcements', 0.5),
  t('threat', 'threat(?:s|en|ens|ened)?|ultimatum|red lines?', 0.5),
  t('warning', 'warns?|warned|warning', 0.5),
  t('evacuation', 'evacuat(?:e|es|ed|ion|ions)|flee(?:s|ing)?', 0.5),
  t('condemn', 'condemn(?:s|ed|ation)?|denounc(?:e|es|ed)', 0.5),
  t('emergency', 'state of emergency|emergency session|emergency meeting', 0.5),
];

export const DEESCALATION: Term[] = [
  t('ceasefire', 'cease-?fires?|truces?|armistice', 2),
  t('peace deal', 'peace (?:deal|agreement|accord|plan|treaty|process)s?', 2),
  t('talks', 'talks|negotiat(?:e|es|ed|ing|ion|ions|ors?)|dialogue', 1),
  t('agreement', 'agreements?|deals?|accords?', 0.5),
  t('de-escalation', 'de-?escalat(?:e|es|ed|ing|ion)', 1),
  t('mediation', 'mediat(?:e|es|ed|ion|ors?)|diplomac(?:y|tic)|envoys?', 0.5),
  // A retreat in battle is not de-escalation, so it is not listed.
  t('withdrawal', 'withdraw(?:s|al|als|n)? (?:troops|forces|from)|troop withdrawal|pull(?:s|ed)? (?:back|out) (?:troops|forces|from)', 1),
  t('release', 'releas(?:e|es|ed) (?:of )?(?:\d+ )?(?:hostages?|prisoners?|detainees?|captives?|POWs?)|prisoner (?:swap|exchange)s?|hostage deal|freed', 1),
  t('humanitarian', 'humanitarian (?:corridor|pause|aid)|aid (?:convoys?|deliver(?:y|ies))', 0.5),
  t('reopening', 'reopen(?:s|ed|ing)?|resum(?:e|es|ed|ption)', 0.5),
  t('summit', 'summits?', 0.5),
  t('restraint', 'restraint|calm|easing|eases?', 0.5),
];

/** A de-escalation word near one of these counts as escalation ("ceasefire collapses"). */
export const REVERSAL = /(?<![\p{L}\p{N}])(?:collaps(?:e|es|ed|ing)|fail(?:s|ed|ure)?|stall(?:s|ed)?|break(?:s|down)?|broke(?:n)?|violat(?:e|es|ed|ion|ions)|reject(?:s|ed)?|suspend(?:s|ed)?|halt(?:s|ed)?|scrap(?:s|ped)?|abandon(?:s|ed)?|end(?:s|ed)? (?:the )?(?:truce|ceasefire|talks)|walk(?:s|ed)? out|deadlock(?:ed)?|impasse|no deal|without (?:a )?deal)(?![\p{L}\p{N}])/iu;

export interface HeadlineScore {
  score: number;
  escalation: string[];
  deescalation: string[];
  reversed: boolean;
}

export function scoreHeadline(title: string): HeadlineScore {
  const esc = ESCALATION.filter((x) => x.re.test(title));
  let de = DEESCALATION.filter((x) => x.re.test(title));
  const reversed = de.length > 0 && REVERSAL.test(title);
  const escalation = esc.map((x) => x.label);
  let up = esc.reduce((s, x) => s + x.weight, 0);
  if (reversed) {
    escalation.push(...de.map((x) => `${x.label} (failing)`));
    up += 1;
    de = [];
  }
  const down = de.reduce((s, x) => s + x.weight, 0);
  return { score: Math.max(-2, Math.min(2, up - down)), escalation, deescalation: de.map((x) => x.label), reversed };
}

/** Mean headline score × 50: −100 calming … +100 escalating (0 = neutral or no listed words). */
export const temperature = (scores: number[]) => (scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 50) : 0);
