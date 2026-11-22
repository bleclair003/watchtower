/**
 * Ukraine front (Phase 21): what can be tracked without front-line geodata.
 *  - The General Staff of the Armed Forces of Ukraine's operational update, as reported in English by
 *    Ukrinform (Ukraine's state news agency): combat engagements in total and per sector, air and drone
 *    strikes, shelling, the settlements named in each sector, and the sectors with no Russian offensive
 *    action. These are one side's figures and are labelled as such.
 *  - Territorial claims in news headlines: "Russia says it captured X" (Russian claims) and "Ukraine
 *    retakes X" (Ukrainian claims), from the news feeds WATCHTOWER already reads.
 * Front lines and areas of control need a licensed source (DeepStateMap API key requested 2026-11-22).
 */
import type { IntelligenceEvent } from './types.ts';

/** Sectors as the General Staff names them (aliases map older and alternative names). */
export const SECTORS: { id: string; name: string; aliases: string[] }[] = [
  { id: 'north-slobozhanshchyna', name: 'Northern Slobozhanshchyna & Kursk', aliases: ['Northern Slobozhanshchyna', 'North Slobozhanshchyna', 'Kursk'] },
  { id: 'south-slobozhanshchyna', name: 'Southern Slobozhanshchyna', aliases: ['Southern Slobozhanshchyna', 'South Slobozhanshchyna', 'Kharkiv', 'Vovchansk'] },
  { id: 'kupiansk', name: 'Kupiansk', aliases: ['Kupiansk'] },
  { id: 'lyman', name: 'Lyman', aliases: ['Lyman'] },
  { id: 'sloviansk', name: 'Sloviansk', aliases: ['Sloviansk', 'Siversk'] },
  { id: 'kramatorsk', name: 'Kramatorsk', aliases: ['Kramatorsk'] },
  { id: 'kostiantynivka', name: 'Kostiantynivka', aliases: ['Kostiantynivka', 'Toretsk'] },
  { id: 'pokrovsk', name: 'Pokrovsk', aliases: ['Pokrovsk'] },
  { id: 'novopavlivka', name: 'Novopavlivka', aliases: ['Novopavlivka'] },
  { id: 'oleksandrivka', name: 'Oleksandrivka', aliases: ['Oleksandrivka'] },
  { id: 'huliaipole', name: 'Huliaipole', aliases: ['Huliaipole', 'Vremivka'] },
  { id: 'orikhiv', name: 'Orikhiv', aliases: ['Orikhiv'] },
  { id: 'dnipro', name: 'Dnipro River', aliases: ['Dnipro River', 'Prydniprovske', 'Kherson'] },
];

export interface FrontReport {
  /** The day covered (YYYY-MM-DD): the previous day for a morning "past day" update. */
  day: string;
  /** "as of" time of the update (ISO), and whether it covers the whole day. */
  asOf: string;
  fullDay: boolean;
  total: number | null;
  airstrikes: number | null;
  guidedBombs: number | null;
  kamikazeDrones: number | null;
  shelling: number | null;
  /** Sector id → engagements or attacks named for it. */
  sectors: Record<string, number>;
  /** Sectors with no Russian offensive action that day. */
  quiet: string[];
  /** Sector id → settlements named for it (as written). */
  places: Record<string, string[]>;
  url: string;
}

export interface TerritorialClaim {
  at: string;
  /** Who claims the gain. */
  side: 'russia' | 'ukraine';
  place: string;
  title: string;
  url: string;
  source: string;
}

export interface UkraineFrontSnapshot {
  /** Full-day reports, newest first (up to 30). */
  reports: FrontReport[];
  /** The current day so far (evening update), if newer than the latest full day. */
  today: FrontReport | null;
  /** Territorial claims in headlines, newest first (14 days). */
  claims: TerritorialClaim[];
  simulated?: boolean;
}

const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
};
const NUM = `(\\d[\\d,]*|${Object.keys(WORDS).join('|')})`;
const toNum = (s: string) => (/^\d/.test(s) ? Number(s.replace(/,/g, '')) : (WORDS[s.toLowerCase()] ?? NaN));
const first = (text: string, re: RegExp) => {
  const m = text.match(re);
  return m ? toNum(m[1]) : null;
};

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Words that are capitalised but are not settlement names. */
const NOT_PLACE = new Set(['Russian', 'Russians', 'Ukrainian', 'Ukraine', 'Ukrinform', 'General', 'Staff', 'Defense', 'Defence', 'Forces', 'The', 'In', 'According', 'One', 'Three', 'Since', 'Air', 'Assault', 'Kursk', 'Oblast', 'Region', 'There', 'They', 'Photo', 'Read', 'Northern', 'Southern', 'Slobozhanshchyna', 'Dnipro', 'River']);

/**
 * Parses a General Staff operational update (English text as published by Ukrinform). Pure.
 * Per-sector counts are read from sentences that name a sector: the numbers before "attacks",
 * "assaults", "attempts", "engagements" or "clashes". Shelling counts ("attacks on positions and
 * settlements") are in sentences without a sector name and are not counted per sector.
 */
export function parseGeneralStaff(text: string, url: string, publishedAt: string | null = null, headline = ''): FrontReport | null {
  const t = text.replace(/\s+/g, ' ');
  // "as of 22:00 on November 21, 2026" or "as of 08:00 on Saturday, November 21" (year from the publish date).
  const asOfM = t.match(/as of (\d{1,2}):(\d{2}) on (?:[A-Z][a-z]+day,? )?([A-Z][a-z]+) (\d{1,2})(?:,? (\d{4}))?/);
  let asOfMs: number;
  let fullDay: boolean;
  let day: string;
  if (asOfM) {
    const month = MONTHS.indexOf(asOfM[3].toLowerCase());
    if (month < 0) return null;
    const year = asOfM[5] ? +asOfM[5] : publishedAt ? new Date(publishedAt).getUTCFullYear() : new Date().getUTCFullYear();
    const hour = +asOfM[1];
    asOfMs = Date.UTC(year, month, +asOfM[4], hour, +asOfM[2]) - 2 * 3_600_000; // Kyiv time (UTC+2; +3 in summer is close enough here)
    // A morning update covers the whole previous day; a later one, the day so far.
    fullDay = hour < 12;
    day = new Date(Date.UTC(year, month, +asOfM[4]) - (fullDay ? 86_400_000 : 0)).toISOString().slice(0, 10);
  } else {
    // No "as of" time: an update "over the past day" covers the day before publication (Kyiv date).
    if (!publishedAt || Number.isNaN(Date.parse(publishedAt))) return null;
    asOfMs = Date.parse(publishedAt);
    fullDay = /over (?:the )?past day|past 24 hours/i.test(`${headline} ${t}`);
    const kyiv = asOfMs + 2 * 3_600_000;
    day = new Date(Math.floor(kyiv / 86_400_000) * 86_400_000 - (fullDay ? 86_400_000 : 0)).toISOString().slice(0, 10);
  }

  const sectors: Record<string, number> = {};
  const quiet = new Set<string>();
  const places: Record<string, string[]> = {};
  const addPlaces = (key: string, sentence: string) => {
    const names = [...sentence.matchAll(/\b(?:near|toward|towards|of|in the vicinity of|around)\s+((?:[A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+)?)(?:\s*,\s*(?:and\s+)?[A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+)?)*(?:\s*,?\s*and\s+[A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+)?)?)/g)]
      .flatMap((m) => m[1].split(/\s*,\s*|\s+and\s+/))
      .map((p) => p.replace(/^and\s+/, '').trim())
      .filter((p) => p && !p.split(/\s+/).some((w) => NOT_PLACE.has(w)) && !SECTORS.some((s) => s.aliases.includes(p) && new RegExp(`${p} (?:sector|direction)`).test(sentence)));
    if (names.length) places[key] = [...new Set([...(places[key] ?? []), ...names])].slice(0, 12);
  };
  // Settlements named in the sentence right after a sector's sentence belong to that sector.
  let lastSector: string | null = null;
  // Day totals come only from sentences that name no sector (a sector's own shelling count is not the total).
  const general: string[] = [];
  for (const sentence of t.split(/(?<=[.!?])\s+(?=[A-Z“"])/)) {
    const named = SECTORS.filter((s) => s.aliases.some((a) => new RegExp(`\\b${a}\\b[^.]{0,40}\\b(?:sector|sectors|direction|directions|axis)\\b|\\b(?:sector|sectors|direction|directions|axis)\\b[^.]{0,20}\\b${a}\\b`).test(sentence)));
    if (!named.length) {
      general.push(sentence);
      if (lastSector && /\b(?:near|toward|towards)\b/.test(sentence) && !/Ukrinform|losses|killed|wounded/i.test(sentence)) addPlaces(lastSector, sentence);
      lastSector = null;
      continue;
    }
    lastSector = named.length === 1 ? named[0].id : null;
    if (/no (?:offensive (?:operations|actions)|combat engagements|significant changes|active (?:offensive )?operations)/i.test(sentence)) {
      for (const s of named) quiet.add(s.id);
      lastSector = null;
      continue;
    }
    let n = 0;
    for (const m of sentence.matchAll(new RegExp(`\\b${NUM}\\s+(?:[a-zA-Z]+\\s+){0,2}?(?:attacks?|assaults?|attempts?|(?:combat )?engagements?|clashes|offensive actions)\\b(?!\\s+on\\s+(?:Ukrainian\\s+)?positions\\s+and\\s+settlements)`, 'gi'))) {
      const v = toNum(m[1]);
      if (Number.isFinite(v)) n += v;
    }
    // "attacked Ukrainian positions nine times" (not shelling).
    for (const m of sentence.matchAll(new RegExp(`\\b(?:attacked|assaulted|stormed)\\b[^.,]{0,50}?\\b${NUM}\\s+times\\b`, 'gi'))) {
      const v = toNum(m[1]);
      if (Number.isFinite(v)) n += v;
    }
    // A sentence naming several sectors (e.g. "Northern Slobozhanshchyna and Kursk sectors") counts once.
    const key = named[0].id;
    if (n > 0) sectors[key] = (sectors[key] ?? 0) + n;
    addPlaces(key, sentence);
  }
  for (const id of Object.keys(sectors)) quiet.delete(id);
  const g = general.join(' ');

  return {
    day,
    asOf: new Date(asOfMs).toISOString(),
    fullDay,
    total: first(headline, new RegExp(`${NUM}\\s+(?:combat engagements|combat clashes|clashes|engagements|attacks)\\b`, 'i')) ?? first(g, new RegExp(`${NUM}\\s+(?:combat engagements|combat clashes|clashes|engagements)\\b`, 'i')),
    airstrikes: first(g, new RegExp(`${NUM}\\s+(?:air ?strikes|airstrikes)`, 'i')),
    guidedBombs: first(g, new RegExp(`${NUM}\\s+guided (?:aerial )?bombs`, 'i')),
    kamikazeDrones: first(g, new RegExp(`${NUM}\\s+kamikaze drones`, 'i')),
    shelling: first(g, new RegExp(`${NUM}\\s+shelling attacks`, 'i')) ?? first(g, new RegExp(`shelled[^.]{0,80}?${NUM}\\s+times`, 'i')),
    sectors,
    quiet: [...quiet],
    places,
    url,
  };
}

/** Keeps the latest version per day (a full-day report beats a partial one), newest first. */
export function mergeReports(existing: FrontReport[], incoming: FrontReport[], keepDays = 45, now = Date.now()): FrontReport[] {
  const byDay = new Map<string, FrontReport>();
  for (const r of [...existing, ...incoming]) {
    const prev = byDay.get(r.day);
    if (!prev || (r.fullDay && !prev.fullDay) || (r.fullDay === prev.fullDay && r.asOf > prev.asOf)) byDay.set(r.day, r);
  }
  const cutoff = new Date(now - keepDays * 86_400_000).toISOString().slice(0, 10);
  return [...byDay.values()].filter((r) => r.day >= cutoff).sort((a, b) => b.day.localeCompare(a.day));
}

// ---------------------------------------------------------------- claims in headlines

const PLACE = `([A-Z][a-zA-Z'’-]+(?:[- ][A-Z][a-zA-Z'’-]+)?)`;
const SETTLEMENT = `(?:the )?(?:(?:village|town|city|settlement|hamlet) (?:of )?)?`;
const RU_CLAIM = new RegExp(
  `\\b(?:Russia|Russian (?:forces|troops|army|military|defen[cs]e ministry)|Moscow|Kremlin)(?: says| claims)?(?: (?:it|they))?(?: (?:has|have))? (?:captured|captures|capture|takes|take|took|taken|seized|seizes|seize|liberated|liberates|liberate|(?:take|takes|took|taken) control of|entered|enters|enter|(?:claims?|announces?) (?:the )?(?:capture|seizure|liberation) of) ${SETTLEMENT}${PLACE}`,
);
const UA_CLAIM = new RegExp(
  `\\b(?:Ukraine|Ukrainian (?:forces|troops|army|military)|Kyiv|Zelensky)(?: says| claims)?(?: (?:it|they))?(?: (?:has|have))? (?:recaptured|recaptures|recapture|retook|retakes|retake|retaken|liberated|liberates|liberate|regained|regains|regain|pushed Russian forces out of|cleared|clear) ${SETTLEMENT}${PLACE}`,
);
const NOT_A_PLACE = /^(?:Ukraine|Russia|Crimea|Donbas|Kyiv|Moscow|Control|Positions?|More|Another|Two|Three|Several|Village|Town)$/;

/** A territorial claim in a headline, or null. */
export function headlineClaim(title: string): { side: 'russia' | 'ukraine'; place: string } | null {
  for (const [side, re] of [['russia', RU_CLAIM], ['ukraine', UA_CLAIM]] as const) {
    const m = title.match(re);
    if (m && !NOT_A_PLACE.test(m[1])) return { side, place: m[1].replace(/['’]s$/, '') };
  }
  return null;
}

/** Claims from news records about Eastern Europe in the last 14 days, newest first, one per side and place per day. */
export function claimsFrom(events: IntelligenceEvent[], now: number): TerritorialClaim[] {
  const seen = new Set<string>();
  const out: TerritorialClaim[] = [];
  for (const e of [...events].sort((a, b) => (b.publishedAt ?? b.collectedAt).localeCompare(a.publishedAt ?? a.collectedAt))) {
    const at = e.publishedAt ?? e.collectedAt;
    if (!e.regionIds.includes('eastern-europe') || Date.parse(at) < now - 14 * 86_400_000) continue;
    const c = headlineClaim(e.title);
    if (!c) continue;
    const key = `${c.side}|${c.place}|${at.slice(0, 10)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ at, side: c.side, place: c.place, title: e.title, url: e.sourceUrl, source: e.sourceName });
  }
  return out.slice(0, 40);
}

export const sectorName = (id: string) => SECTORS.find((s) => s.id === id)?.name ?? id;
