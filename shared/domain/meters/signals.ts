import type { IntelligenceEvent } from '../types.ts';
import { isNews } from '../changes.ts';
import { meta } from './util.ts';

/**
 * Named signals shared by several meters. Each is a plain predicate over one record, using the
 * metadata the adapters store (see docs/SOURCE_REGISTRY.md).
 */

export { isNews };

/**
 * Headline words for kinetic activity: an act (strike, shelling, attack, interception, shoot-down),
 * not a topic ("missile shortages", "counter-drone tools", "drone industry").
 */
const STRIKE_TERMS =
  /\b(air ?strikes?|strikes? (on|against|at|in|hit\w*|kill\w*)|struck|shell(ing|ed)|bombard\w*|attacks? (on|against|kill\w*)|attacked|(missile|rocket|drone)s? (attacks?|strikes?|barrage|fire|hit\w*|launch\w*)|launch(es|ed)? (missiles?|rockets?|drones?)|fires? (missiles?|rockets?)|intercept(s|ed)|shot down|shoots? down|(downs|downed) (a |an )?(\w+ )?(drones?|jets?|planes?|aircraft|missiles?)|clashes|offensive|incursion|repel(s|led)|hostilities|(Ukraine|Russia|Israel|Iran|US|U\.S\.|Houthis?|Hezbollah|Hamas|China|Pakistan|India|coalition|NATO) (strikes|hits|bombs|shells)|(bridge|base|port|airfield|refinery|depot|plant) strikes)\b/;
const STRIKE_TERMS_CI = new RegExp(STRIKE_TERMS.source.replace('(Ukraine|Russia|Israel|Iran|US|U\\.S\\.|Houthis?|Hezbollah|Hamas|China|Pakistan|India|coalition|NATO) (strikes|hits|bombs|shells)|', ''), 'i');
/** News headline about kinetic activity (strikes, shelling, attacks, interceptions). */
export const isStrikeNews = (e: IntelligenceEvent) => isNews(e) && (STRIKE_TERMS_CI.test(e.title) || STRIKE_TERMS.test(e.title));
/** Military or diplomatic news (the "rhetoric" rung). */
export const isPoliticalNews = (e: IntelligenceEvent) => isNews(e) && (e.category === 'military' || e.category === 'diplomatic');

export const NOTABLE_AIR = ['tanker', 'airlift', 'isr', 'bomber'];
export const isNotableAircraft = (e: IntelligenceEvent) => e.sourceId === 'adsb-military' && NOTABLE_AIR.includes(String(meta(e, 'aircraftClass')));
export const aircraftClass = (e: IntelligenceEvent) => String(meta(e, 'aircraftClass') ?? 'other');

export const isEmbassyPosture = (e: IntelligenceEvent) => e.sourceId === 'state-travel-advisories' && meta(e, 'subtype') === 'embassy-posture';
/** Ordered or authorized departure, or suspended operations (not their lifting). */
export const isDrawdown = (e: IntelligenceEvent) => isEmbassyPosture(e) && ['ordered-departure', 'authorized-departure', 'operations-suspended'].includes(String(meta(e, 'postureChange')));
export const isAdvisoryRaise = (e: IntelligenceEvent) => e.sourceId === 'state-travel-advisories' && meta(e, 'change') === 'raised';
export const advisoryLevel = (e: IntelligenceEvent) => (e.sourceId === 'state-travel-advisories' ? (meta<number>(e, 'advisoryLevel') ?? null) : null);
export const isFcdoUpdate = (e: IntelligenceEvent) => e.sourceId === 'uk-fcdo-travel';
export const isFcdoSecurityUpdate = (e: IntelligenceEvent) => isFcdoUpdate(e) && /tension|security|terror|conflict|military|evacuat|leave|depart|missile|drone|airspace/i.test(String(meta(e, 'changeNote') ?? e.title));

export const isFleetMove = (e: IntelligenceEvent) => e.sourceId === 'usni-fleet-tracker' && meta(e, 'change') === 'moved';
export const isSecurityTfr = (e: IntelligenceEvent) => e.sourceId === 'faa-tfr' && meta(e, 'tfrType') === 'SECURITY';
export const isFmsContract = (e: IntelligenceEvent) => e.sourceId === 'dod-contracts' && (meta<string[]>(e, 'fmsCountries') ?? []).length > 0;

export const isUnscMeeting = (e: IntelligenceEvent) => e.sourceId === 'un-security-council' && meta(e, 'subtype') === 'unsc-meeting';
export const isUnscDivided = (e: IntelligenceEvent) => e.sourceId === 'un-security-council' && meta(e, 'subtype') === 'unsc-resolution' && meta(e, 'divided') === true;
export const isUnscFailedDraft = (e: IntelligenceEvent) => e.sourceId === 'un-security-council' && meta(e, 'subtype') === 'unsc-failed-draft';

export const isDprkLaunch = (e: IntelligenceEvent) => e.sourceId === 'yonhap-dprk-launches' && meta(e, 'subtype') === 'dprk-missile-launch';
export const isDprkNuclearTest = (e: IntelligenceEvent) => e.sourceId === 'yonhap-dprk-launches' && meta(e, 'subtype') === 'dprk-nuclear-test';
export const isMilitaryLaunch = (e: IntelligenceEvent) => e.sourceId === 'military-launches';

/** Internet outage attributed to a government order or military action. */
export const isDirectedOutage = (e: IntelligenceEvent) =>
  e.sourceId === 'cloudflare-radar-outages' && ['GOVERNMENT_DIRECTED', 'MILITARY_ACTION'].includes(String(meta(e, 'outageCause')));
export const isGovernmentShutdown = (e: IntelligenceEvent) => e.sourceId === 'cloudflare-radar-outages' && meta(e, 'outageCause') === 'GOVERNMENT_DIRECTED';
/** Any outage still ongoing when collected (IODA) or without an end time (Cloudflare). */
export const isOngoingOutage = (e: IntelligenceEvent) =>
  (e.sourceId === 'ioda-outages' && meta(e, 'ongoingAtCollection') === true) || (e.sourceId === 'cloudflare-radar-outages' && !meta(e, 'endedAt'));

export const isCurrencyStress = (e: IntelligenceEvent) => e.sourceId === 'fx-rates';
export const isOilRise = (e: IntelligenceEvent) => e.sourceId === 'oil-prices' && meta(e, 'direction') === 'up';
export const isChokepointAlert = (e: IntelligenceEvent) => e.sourceId === 'imf-portwatch-chokepoints';

export const isSanctionsDesignation = (e: IntelligenceEvent) => ['ofac-sdn', 'eu-sanctions', 'uk-sanctions'].includes(e.sourceId) && meta(e, 'subtype') === 'sanctions-designations';

export const isWhoReport = (e: IntelligenceEvent) => e.sourceId === 'who-don';
export const isSevereDisasterAlert = (e: IntelligenceEvent) => e.sourceId === 'gdacs' && ['Orange', 'Red'].includes(String(meta(e, 'alertLevel')));
export const isFireCluster = (e: IntelligenceEvent) => e.sourceId === 'nasa-firms';

export const isRansomwareKev = (e: IntelligenceEvent) => e.sourceId === 'cisa-kev' && meta(e, 'knownRansomwareUse') === true;
export const isKev = (e: IntelligenceEvent) => e.sourceId === 'cisa-kev';
export const isCisaAlert = (e: IntelligenceEvent) => e.sourceId === 'cisa-advisories' && meta(e, 'routine') !== true;
