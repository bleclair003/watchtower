/**
 * Overnight air attacks on Ukraine (Phase 22): the Ukrainian Air Force's morning report — drones and
 * missiles launched, how many were shot down or suppressed, and where hits landed — as reported in
 * English by Ukrinform. Ukraine's own figures (one side); parsed from text with fixed rules.
 */

export interface AirReport {
  /** The morning the night ended (YYYY-MM-DD, Kyiv date of the report). */
  day: string;
  drones: number | null;
  missiles: number | null;
  ballistic: number | null;
  dronesDown: number | null;
  missilesDown: number | null;
  /** Locations with hits, and with falling debris. */
  hitLocations: number | null;
  debrisLocations: number | null;
  url: string;
}

const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
};
// A count stands alone: "S-400", "Kh-101" or "S8000" are model names, not numbers.
const NUM = `(?<![\\w/-])(\\d[\\d,]*|${Object.keys(WORDS).join('|')})`;
const toNum = (s: string) => (/^\d/.test(s) ? Number(s.replace(/,/g, '')) : (WORDS[s.toLowerCase()] ?? NaN));
const sum = (text: string, re: RegExp) => {
  let n = 0;
  let any = false;
  for (const m of text.matchAll(re)) {
    const v = toNum(m[1]);
    if (Number.isFinite(v)) {
      n += v;
      any = true;
    }
  }
  return any ? n : null;
};

/**
 * Parses an Air Force overnight report. The "attacked Ukraine with …" sentence gives what was launched;
 * the "shot down / suppressed / neutralized" sentence what was stopped; "hits … at N locations" the
 * impacts. The headline ("117 of 148 drones") fills gaps. Returns null when no launch figures are found.
 */
export function parseAirReport(text: string, headline: string, url: string, publishedAt: string | null): AirReport | null {
  if (!publishedAt || Number.isNaN(Date.parse(publishedAt))) return null;
  // Dates and clock times are not counts ("November 20, Russian forces attacked … with three missiles").
  const t = text
    .replace(/\s+/g, ' ')
    .replace(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}(?:,? \d{4})?/g, 'DATE')
    .replace(/\b\d{1,2}:\d{2}\b/g, 'TIME');
  // List items end with ";" (see articleText), so a semicolon before a capital also ends a sentence.
  const sentences = t.split(/(?<=[.!?;])\s+(?=[A-Z“"])/);
  // The launch section: from the "attacked … with / used … to attack" sentence up to the first sentence
  // about repelling or shooting down (weapon lists continue over several sentences).
  const startIdx = sentences.findIndex((s) => /\b(?:attacked|struck|launched|used)\b[^.]*\b(?:with|against|at|to attack)\b/i.test(s));
  const launchSentences: string[] = [];
  if (startIdx >= 0) {
    for (const s of sentences.slice(startIdx, startIdx + 8)) {
      if (launchSentences.length && /\b(?:repelled|shot down|suppressed|neutrali[sz]ed|downing|as of)\b/i.test(s)) break;
      launchSentences.push(s);
    }
  }
  const launch = launchSentences.join(' ');
  const down = sentences.filter((s) => /\b(?:shot down|suppressed|neutrali[sz]ed|downed|destroyed|downing|suppression)\b/i.test(s) && /\b(?:drones|UAVs|missiles|targets)\b/i.test(s)).slice(0, 1).join(' ');
  const drone = `${NUM}\\s+(?:[A-Za-z-]+\\s+){0,3}?(?:drones|UAVs)\\b`;
  // Commas allowed (model lists), brackets not ("(92 of them jet-powered)"); "N of them" is a sub-count.
  const missile = `${NUM}(?!\\s+of\\s+them)\\s+(?:(?!(?:drones|UAVs)\\b)[A-Za-z0-9/,-]+\\s+){0,8}?missiles?\\b`;
  /** Largest drone count: reports give a total and sub-counts ("117 drones, including 63 Shaheds"). */
  const maxOf = (text: string, re: RegExp) => {
    const vals = [...text.matchAll(re)].map((m) => toNum(m[1])).filter(Number.isFinite);
    return vals.length ? Math.max(...vals) : null;
  };
  // Headline "117 of 148 Russian drones" / "down 82 missiles, 380 Russian drones".
  const of = headline.match(new RegExp(`${NUM}\\s+of\\s+${NUM}\\s+(?:[A-Za-z]+\\s+){0,2}?(?:drones|UAVs)`, 'i'));
  const drones = (of ? toNum(of[2]) : null) ?? maxOf(launch, new RegExp(drone, 'gi'));
  const missiles = sum(launch, new RegExp(missile, 'gi'));
  if (drones === null && missiles === null) return null;
  const kyivDay = new Date(Date.parse(publishedAt) + 2 * 3_600_000).toISOString().slice(0, 10);
  const hits = t.match(new RegExp(`(?:hits?|strikes?) (?:were |was )?(?:recorded|registered|reported)? ?(?:at|in) ${NUM} locations`, 'i'));
  // The headline states what was shot down ("Air defense neutralizes 124 Russian drones, two … missiles").
  const headDown = (pattern: string) => {
    if (!/\b(?:neutrali[sz]es?|downs?|shoots? down|destroys?|intercepts?)\b/i.test(headline) || /\bof\s+\d/.test(headline)) return null;
    const m = headline.match(new RegExp(pattern, 'i'));
    return m ? toNum(m[1]) : null;
  };
  const debris = t.match(new RegExp(`debris[^.]{0,60}?(?:at|in) ${NUM} locations`, 'i'));
  return {
    day: kyivDay,
    drones,
    missiles,
    ballistic: sum(launch, new RegExp(`${NUM}(?!\\s+of\\s+them)\\s+(?:[A-Za-z0-9/-]+\\s+){0,3}?ballistic`, 'gi')),
    dronesDown: (of ? toNum(of[1]) : null) ?? headDown(drone) ?? maxOf(down, new RegExp(drone, 'gi')),
    missilesDown: headDown(missile) ?? sum(down, new RegExp(missile, 'gi')),
    hitLocations: hits ? toNum(hits[1]) : null,
    debrisLocations: debris ? toNum(debris[1]) : null,
    url,
  };
}

/** Keeps one report per night (the one with the most launches, i.e. the final count), newest first. */
export function mergeAirReports(existing: AirReport[], incoming: AirReport[], keepDays = 45, now = Date.now()): AirReport[] {
  const byDay = new Map<string, AirReport>();
  const size = (r: AirReport) => (r.drones ?? 0) + (r.missiles ?? 0);
  for (const r of [...existing, ...incoming]) {
    const prev = byDay.get(r.day);
    if (!prev || size(r) > size(prev)) byDay.set(r.day, r);
  }
  const cutoff = new Date(now - keepDays * 86_400_000).toISOString().slice(0, 10);
  return [...byDay.values()].filter((r) => r.day >= cutoff).sort((a, b) => b.day.localeCompare(a.day));
}

/** Share of launched drones and missiles reported shot down or suppressed (0–1), or null. */
export function interceptRate(r: AirReport): number | null {
  const launched = (r.drones ?? 0) + (r.missiles ?? 0);
  const down = (r.dronesDown ?? 0) + (r.missilesDown ?? 0);
  return launched > 0 && (r.dronesDown !== null || r.missilesDown !== null) ? Math.min(1, down / launched) : null;
}
