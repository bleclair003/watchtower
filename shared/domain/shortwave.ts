/**
 * Phase 29: shortwave broadcast schedules (EiBi) and local radio stations (Radio Browser) per watch region.
 *
 * WATCHTOWER only links: it never plays, records, transcribes or re-streams audio. Schedule rows come from
 * the EiBi list as published; a row being "on now" means only that the schedule says so.
 */

// ── Shortwave schedules (EiBi) ─────────────────────────────────────────────

/** One scheduled transmission; rows that differ only by frequency are merged. */
export interface SwBroadcast {
  kHz: number[];
  /** "HHMM" UTC; end may be "2400". */
  start: string;
  end: string;
  /** EiBi day field as published ("" = daily, "Mo-Fr", "1245", "irr", ...). */
  days: string;
  /** ITU code of the station's home country. */
  itu: string;
  station: string;
  /** EiBi language code ("-CW", "-TY" etc. for non-voice). */
  lang: string;
  /** EiBi target area: an ITU country code or a region ("ME", "EEu", ...). */
  target: string;
  /** Transmitter site code ("/RUS-s" = relayed from another country). */
  site: string;
  /** Utility (non-broadcast) station: military, numbers, markers, weather. */
  utility: boolean;
  /** Valid only between these "DDMM" dates (EiBi persistence 6). */
  dates?: [string, string];
}

export interface ShortwaveSnapshot {
  fetchedAt: string;
  /** EiBi season, e.g. "B26" (winter 2026/27). */
  season: string;
  sourceUrl: string;
  broadcasts: SwBroadcast[];
  /** Names for the language and country codes used above, from the EiBi README. */
  languages: Record<string, string>;
  countries: Record<string, string>;
  simulated?: boolean;
}

export const EIBI_BASE = 'http://www.eibispace.de/dx/';

/** Which EiBi codes count for each watch region: broadcasts aimed at it, and stations based in it. */
export const REGION_SHORTWAVE: Record<string, { targets: string[]; homes: string[] }> = {
  'middle-east': {
    targets: ['ME', 'ISR', 'PSE', 'LBN', 'SYR', 'JOR', 'IRQ', 'IRN', 'ARS', 'KWT', 'BHR', 'QAT', 'UAE', 'OMA'],
    homes: ['ISR', 'PSE', 'LBN', 'SYR', 'JOR', 'IRQ', 'IRN', 'ARS', 'KWT', 'BHR', 'QAT', 'UAE', 'OMA'],
  },
  'eastern-europe': {
    targets: ['EEu', 'UKR', 'RUS', 'BLR', 'MDA', 'CIS', 'POL', 'LTU', 'LVA', 'EST', 'ROU'],
    homes: ['UKR', 'RUS', 'BLR', 'MDA', 'POL', 'LTU', 'LVA', 'EST', 'ROU'],
  },
  'taiwan-strait': { targets: ['TWN'], homes: ['TWN'] },
  'korean-peninsula': { targets: ['KRE', 'KOR'], homes: ['KRE', 'KOR'] },
  'south-china-sea': { targets: ['PHL', 'VTN', 'MLA', 'BRU'], homes: ['PHL', 'VTN', 'MLA', 'BRU'] },
  'red-sea': { targets: ['YEM', 'ERI', 'DJI', 'SOM', 'ETH', 'SDN', 'EAf'], homes: ['YEM', 'ERI', 'DJI', 'SOM', 'ETH', 'SDN'] },
  'united-states': { targets: ['USA', 'NAm', 'ENA', 'CNA', 'WNA'], homes: ['USA'] },
};

const ALL_TARGETS = new Set(Object.values(REGION_SHORTWAVE).flatMap((r) => r.targets));
const ALL_HOMES = new Set(Object.values(REGION_SHORTWAVE).flatMap((r) => r.homes));

/** EiBi file for the season in force at `now`, then the one before (new files can appear late). */
export function eibiSeasonFiles(now: number): { season: string; file: string }[] {
  const d = new Date(now);
  const y = d.getUTCFullYear();
  const lastSunday = (month: number) => {
    const t = new Date(Date.UTC(y, month + 1, 0, 1));
    t.setUTCDate(t.getUTCDate() - t.getUTCDay());
    return t.getTime();
  };
  const summerStart = lastSunday(2);
  const summerEnd = lastSunday(9);
  const yy = (n: number) => String(n % 100).padStart(2, '0');
  let cur: string;
  let prev: string;
  if (now >= summerStart && now < summerEnd) {
    cur = `A${yy(y)}`;
    prev = `B${yy(y - 1)}`;
  } else if (now >= summerEnd) {
    cur = `B${yy(y)}`;
    prev = `A${yy(y)}`;
  } else {
    cur = `B${yy(y - 1)}`;
    prev = `A${yy(y - 1)}`;
  }
  return [cur, prev].map((season) => ({ season, file: `sked-${season.toLowerCase()}.csv` }));
}

const SKIP_DAYS = new Set(['alt', 'harm', 'imod']);

/** Parses the EiBi CSV, keeping rows aimed at or based in a watch region. Pure. */
export function parseEibiCsv(body: string): SwBroadcast[] {
  const merged = new Map<string, SwBroadcast>();
  for (const line of body.split(/\r?\n/).slice(1)) {
    const c = line.split(';');
    if (c.length < 9) continue;
    const kHz = Number(c[0]);
    const time = /^(\d{4})-(\d{4})$/.exec(c[1].trim());
    if (!Number.isFinite(kHz) || kHz <= 0 || !time) continue;
    const days = c[2].trim();
    if (SKIP_DAYS.has(days)) continue;
    const itu = c[3].trim();
    const target = c[6].trim();
    if (!ALL_TARGETS.has(target) && !ALL_HOMES.has(itu)) continue;
    const p = Number(c[8].trim());
    if (!Number.isFinite(p) || p % 10 === 8) continue;
    const station = c[4].trim().replace(/�/g, '?');
    if (!station) continue;
    const b: SwBroadcast = {
      kHz: [kHz],
      start: time[1],
      end: time[2],
      days,
      itu,
      station,
      lang: c[5].trim(),
      target,
      site: c[7].trim(),
      utility: p >= 90 || c[5].trim().startsWith('-'),
    };
    if (p % 10 === 6 && /^\d{4}$/.test(c[9]?.trim() ?? '') && /^\d{4}$/.test(c[10]?.trim().slice(0, 4) ?? '')) {
      b.dates = [c[9].trim(), c[10].trim().slice(0, 4)];
    }
    const key = [b.start, b.end, b.days, b.itu, b.station, b.lang, b.target, b.site, b.dates?.join('-') ?? ''].join('|');
    const had = merged.get(key);
    if (had) {
      if (!had.kHz.includes(kHz)) had.kHz.push(kHz);
    } else merged.set(key, b);
  }
  const out = [...merged.values()];
  for (const b of out) b.kHz.sort((a, z) => a - z);
  return out;
}

/** Reads "CODE  Name" lines of one README section (language or country codes). Pure. */
export function parseEibiCodes(readme: string, section: 'languages' | 'countries'): Record<string, string> {
  const lines = readme.split(/\r?\n/);
  const startRe = section === 'languages' ? /^\s*I\) Language codes\./ : /^\s*II\) Country codes\./;
  const endRe = section === 'languages' ? /^\s*II\) Country codes\./ : /^\s*III\) Target-area codes\./;
  let on = false;
  const out: Record<string, string> = {};
  for (const l of lines) {
    if (startRe.test(l)) {
      on = true;
      continue;
    }
    if (on && endRe.test(l)) break;
    if (!on) continue;
    const m = /^ {3}(-?[A-Za-z0-9]{1,4})\s{1,}(\S.*?)\s*(?:\[[a-z]{3}\])?\s*$/.exec(l);
    if (!m) continue;
    const name = m[2].replace(/\s*\*$/, '').replace(/\s*\([\d.,]+m?\)/g, '').replace(/�/g, '?').trim();
    if (name) out[m[1]] = name.slice(0, 80);
  }
  return out;
}

const DAY_CODES = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/** Days of the week (0 = Monday) the EiBi field names, or null when it is not a plain weekday rule. */
export function eibiWeekdays(days: string): number[] | null {
  if (days === '' || days === 'USB' || days === 'LSB') return [0, 1, 2, 3, 4, 5, 6];
  if (/^[1-7]+$/.test(days)) return [...new Set([...days].map((d) => Number(d) - 1))];
  const tokens = days.match(/(Mo|Tu|We|Th|Fr|Sa|Su)|[-,]/g);
  if (!tokens || tokens.join('') !== days) return null;
  const out = new Set<number>();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === ',' || t === '-') continue;
    const a = DAY_CODES.indexOf(t);
    if (tokens[i + 1] === '-' && tokens[i + 2]) {
      const z = DAY_CODES.indexOf(tokens[i + 2]);
      for (let d = a; ; d = (d + 1) % 7) {
        out.add(d);
        if (d === z) break;
      }
      i += 2;
    } else out.add(a);
  }
  return [...out].sort();
}

const mins = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2));

/** 'yes' / 'no' by the schedule at `now`, or 'unknown' for irregular or unusual day rules. */
export function onAirNow(b: SwBroadcast, now: number): 'yes' | 'no' | 'unknown' {
  const d = new Date(now);
  const m = d.getUTCHours() * 60 + d.getUTCMinutes();
  const s = mins(b.start);
  const e = mins(b.end);
  const wrapped = e <= s && !(s === 0 && e === 2400);
  const inTime = s === e ? true : wrapped ? m >= s || m < e : m >= s && m < e;
  if (!inTime) return 'no';
  const week = eibiWeekdays(b.days);
  if (!week) return 'unknown';
  // A transmission that began yesterday evening counts against yesterday's weekday.
  const day = (d.getUTCDay() + 6) % 7;
  const startDay = wrapped && m < e ? (day + 6) % 7 : day;
  return week.includes(startDay) ? 'yes' : 'no';
}

export interface RegionShortwave {
  /** Aimed at the region. */
  to: SwBroadcast[];
  /** Based in the region and aimed elsewhere. */
  from: SwBroadcast[];
}

export function shortwaveForRegion(list: SwBroadcast[], regionId: string): RegionShortwave {
  const r = REGION_SHORTWAVE[regionId];
  if (!r) return { to: [], from: [] };
  const to: SwBroadcast[] = [];
  const from: SwBroadcast[] = [];
  for (const b of list) {
    if (r.targets.includes(b.target)) to.push(b);
    else if (r.homes.includes(b.itu)) from.push(b);
  }
  return { to, from };
}

/** On-air-now rows first (then unknown), ordered by start time; utility stations kept apart by the caller. */
export function sortForNow(list: SwBroadcast[], now: number): (SwBroadcast & { air: 'yes' | 'no' | 'unknown' })[] {
  const rank = { yes: 0, unknown: 1, no: 2 } as const;
  return list
    .map((b) => ({ ...b, air: onAirNow(b, now) }))
    .sort((a, z) => rank[a.air] - rank[z.air] || a.start.localeCompare(z.start) || a.station.localeCompare(z.station));
}

/** Shortwave AM for broadcasts; utility voice is USB unless the row says LSB. */
export function swMode(b: SwBroadcast): 'am' | 'usb' | 'lsb' | 'cw' {
  if (b.lang === '-CW') return 'cw';
  if (b.days === 'LSB') return 'lsb';
  if (b.utility) return 'usb';
  return 'am';
}

// ── Local radio (Radio Browser) ────────────────────────────────────────────

export interface LocalStation {
  uuid: string;
  name: string;
  /** ISO 3166-1 alpha-2. */
  cc: string;
  homepage: string | null;
  stream: string | null;
  state?: string;
  language?: string;
  /** Tagged news or talk by the directory. */
  news: boolean;
  clicks: number;
}

export interface LocalRadioSnapshot {
  fetchedAt: string;
  sourceUrl: string;
  stations: LocalStation[];
  simulated?: boolean;
}

/** Stations kept per country: news and talk first, then the most listened-to. */
export const STATIONS_PER_COUNTRY = 8;

const NEWS_RE = /\b(news|talk|information|info|public radio|government|state radio|noticias|nachrichten|новости|новини|חדשות|أخبار|اخبار)\b/i;

/** A link-safe URL: http(s) only, no embedded credentials. Pure. */
export function cleanLinkUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 500) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

interface RawStation {
  stationuuid?: unknown;
  name?: unknown;
  countrycode?: unknown;
  homepage?: unknown;
  url_resolved?: unknown;
  url?: unknown;
  state?: unknown;
  language?: unknown;
  tags?: unknown;
  clickcount?: unknown;
  lastcheckok?: unknown;
}

const str = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');

/** Picks the stations to keep for one country from a Radio Browser search result. Pure. */
export function pickLocalStations(raw: unknown, cc: string, n = STATIONS_PER_COUNTRY): LocalStation[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: LocalStation[] = [];
  for (const r of raw as RawStation[]) {
    if (!r || typeof r !== 'object' || r.lastcheckok !== 1) continue;
    if (str(r.countrycode, 2).toUpperCase() !== cc) continue;
    const name = str(r.name, 80);
    const uuid = str(r.stationuuid, 40);
    const homepage = cleanLinkUrl(r.homepage);
    const stream = cleanLinkUrl(r.url_resolved) ?? cleanLinkUrl(r.url);
    if (!name || !uuid || (!homepage && !stream)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const tags = str(r.tags, 300);
    const s: LocalStation = {
      uuid,
      name,
      cc,
      homepage,
      stream,
      news: NEWS_RE.test(tags) || NEWS_RE.test(name),
      clicks: typeof r.clickcount === 'number' ? r.clickcount : 0,
    };
    const state = str(r.state, 60);
    const language = str(r.language, 60);
    if (state) s.state = state;
    if (language) s.language = language;
    out.push(s);
  }
  out.sort((a, z) => Number(z.news) - Number(a.news) || z.clicks - a.clicks);
  return out.slice(0, n);
}

export function stationsForCountries(list: LocalStation[], codes: string[]): LocalStation[] {
  return list.filter((s) => codes.includes(s.cc));
}

// ── The radio guide document ───────────────────────────────────────────────

/** Stored as snapshots/radio: loaded only by the radio panels, not with the dashboard. */
export interface RadioGuide {
  generatedAt: string;
  shortwave: ShortwaveSnapshot | null;
  localRadio: LocalRadioSnapshot | null;
}

/** The radio guide is used while under this age; older parts are left out rather than shown as current. */
export const RADIO_GUIDE_MAX_AGE_MS = 14 * 86_400_000;

/** LISTEN links for a record: the top two local stations (news first) in its first country that has any. */
export function localListenLinks(stations: LocalStation[], countryCodes: string[]): { kind: 'local'; label: string; url: string }[] {
  for (const cc of countryCodes) {
    const list = stations.filter((s) => s.cc === cc).slice(0, 2);
    if (list.length) {
      return list.flatMap((s) => {
        const url = s.homepage ?? s.stream;
        return url ? [{ kind: 'local' as const, label: `Local radio (${cc}): ${s.name}${s.news ? ' — news' : ''}`, url }] : [];
      });
    }
  }
  return [];
}
