/**
 * Navigational warnings (Phase 25): NGA Maritime Safety Information broadcast warnings — NAVAREA IV and
 * XII and the worldwide HYDROLANT / HYDROPAC series. Ships are warned of missile and rocket firings, live
 * gunnery, military exercises, cable work and faults, piracy and GPS interference, usually days ahead and
 * with the exact area. U.S. government work (public domain).
 *
 * Pure parsing and classification; the collector is collector/adapters/ngaMsi.ts.
 */
import { regionsForPoint } from './regions.ts';

export type NavWarningKind = 'missile' | 'firing' | 'exercise' | 'gnss' | 'piracy' | 'mine' | 'cable' | 'other';

export const NAV_KIND_LABEL: Record<NavWarningKind, string> = {
  missile: 'missile or rocket firing',
  firing: 'live firing or hazardous operations',
  exercise: 'military exercise',
  gnss: 'GPS / GNSS interference',
  piracy: 'piracy or attack on shipping',
  mine: 'mines or explosive hazard',
  cable: 'undersea cable work or fault',
  other: 'other',
};

/** Raw record from the NGA API (fields as published; anything may be missing). */
export interface NgaWarningRaw {
  msgYear?: number | string;
  msgNumber?: number | string;
  navArea?: string;
  subregion?: string;
  text?: string;
  status?: string;
  issueDate?: string;
  authority?: string;
  cancelDate?: string | null;
}

export interface NavWarning {
  /** e.g. "HYDROPAC 1234/26" or "NAVAREA IV 567/26". */
  key: string;
  series: string;
  number: number;
  year: number;
  issuedAt: string | null;
  kind: NavWarningKind;
  /** First 600 characters of the warning text. */
  text: string;
  /** Up to 40 points from the text (lat, lon), in order. */
  points: [number, number][];
  /** Mean of the points, or null when the text gives none. */
  lat: number | null;
  lon: number | null;
  regionIds: string[];
}

export interface NavWarningSnapshot {
  /** Active warnings of the notable kinds (not 'other'). */
  warnings: NavWarning[];
  /** All active warnings read, of any kind. */
  activeTotal: number;
  fetchedAt: string;
  /** v0.66.1: "in force as of" time of the NGA list read (the daily files say it; the API does not). */
  asOf?: string | null;
  /** v0.66.1: where the list came from: the MSI API, or the daily in-force files NGA posts while the portal is down. */
  via?: 'api' | 'daily-files';
  simulated?: boolean;
}

const SERIES: Record<string, string> = { '4': 'NAVAREA IV', '12': 'NAVAREA XII', A: 'HYDROLANT', P: 'HYDROPAC', IV: 'NAVAREA IV', XII: 'NAVAREA XII', ARC: 'HYDROARC' };
export const seriesName = (navArea: string | undefined) => SERIES[String(navArea ?? '').toUpperCase()] ?? `NAVAREA ${navArea ?? '?'}`;

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
/** "081653Z MAY 2024" (day, hour, minute, Zulu, month, year) → ISO, or null. */
export function parseIssueDate(s: string | undefined): string | null {
  const m = String(s ?? '').trim().toUpperCase().match(/^(\d{2})(\d{2})(\d{2})Z\s+([A-Z]{3})\s+(\d{4})$/);
  if (!m) return null;
  const mon = MONTHS.indexOf(m[4]);
  if (mon < 0) return null;
  const t = Date.UTC(+m[5], mon, +m[1], +m[2], +m[3]);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * Positions written as degrees-minutes, e.g. "24-54.89N 052-21.66E" or "24-54N 052-21E". Returns
 * [lat, lon] pairs in order (at most 40).
 */
export function parsePositions(text: string): [number, number][] {
  const out: [number, number][] = [];
  const re = /(\d{1,2})-(\d{1,2}(?:\.\d+)?)\s*([NS])[\s,]+(\d{1,3})-(\d{1,2}(?:\.\d+)?)\s*([EW])/g;
  for (const m of text.toUpperCase().matchAll(re)) {
    const lat = (+m[1] + +m[2] / 60) * (m[3] === 'S' ? -1 : 1);
    const lon = (+m[4] + +m[5] / 60) * (m[6] === 'W' ? -1 : 1);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && +m[2] < 60 && +m[5] < 60) out.push([Math.round(lat * 1e4) / 1e4, Math.round(lon * 1e4) / 1e4]);
    if (out.length >= 40) break;
  }
  return out;
}

/** Kind from the warning text (first match wins, most specific first). */
export function classifyWarning(text: string): NavWarningKind {
  const t = text.toUpperCase();
  if (/\bMISSILE|ROCKET (LAUNCH|FIRING|OPERATIONS)|SPACE (DEBRIS|VEHICLE)|LAUNCH (OPERATIONS|AREA)|RE-?ENTRY/.test(t)) return 'missile';
  if (/\bGPS\b|\bGNSS\b|NAVIGATION(AL)? SIGNAL|(JAMMING|INTERFERENCE|SPOOFING)/.test(t) && /\bGPS\b|\bGNSS\b|SATELLITE NAVIGATION|POSITIONING/.test(t)) return 'gnss';
  if (/PIRACY|PIRATE|ARMED ROBBERY|HIJACK|SUSPICIOUS APPROACH|ATTACKED|BOARDED|UNMANNED (SURFACE|AERIAL) VEHICLE ATTACK|SECURITY INCIDENT|STRUCK BY (AN? )?(PROJECTILE|MISSILE|DRONE|UNKNOWN)/.test(t)) return 'piracy';
  if (/\bMINES?\b|MINEFIELD|UNEXPLODED|EXPLOSIVE ORDNANCE|\bUXO\b|DERELICT ORDNANCE/.test(t)) return 'mine';
  if (/GUNNERY|LIVE FIRE|FIRING (EXERCISE|PRACTICE|OPERATIONS)|HAZARDOUS OPERATIONS|AIR TO SURFACE|SURFACE TO AIR|ORDNANCE DISPOSAL|DEMOLITION/.test(t)) return 'firing';
  if (/(MILITARY|NAVAL|SUBMARINE|NATO|JOINT) (EXERCISE|OPERATIONS|TRAINING)|EXERCISE AREA|SUBMARINE OPERATIONS/.test(t)) return 'exercise';
  if (/\bCABLE\b/.test(t)) return 'cable';
  return 'other';
}

/** Normalises one raw record; null when it cannot be identified. */
export function readWarning(r: NgaWarningRaw): NavWarning | null {
  const number = Number(r.msgNumber);
  const year = Number(r.msgYear);
  const text = String(r.text ?? '').replace(/\s+/g, ' ').trim();
  if (!Number.isFinite(number) || !Number.isFinite(year) || !text) return null;
  const series = seriesName(r.navArea);
  const points = parsePositions(text);
  const lat = points.length ? Math.round((points.reduce((a, p) => a + p[0], 0) / points.length) * 1e3) / 1e3 : null;
  const lon = points.length ? Math.round((points.reduce((a, p) => a + p[1], 0) / points.length) * 1e3) / 1e3 : null;
  return {
    key: `${series} ${number}/${String(year).slice(-2)}`,
    series,
    number,
    year,
    issuedAt: parseIssueDate(r.issueDate),
    kind: classifyWarning(text),
    text: text.length > 600 ? `${text.slice(0, 597)}…` : text,
    points,
    lat,
    lon,
    // Any point of the area (or its centre) inside a watch region counts: areas often straddle a region's edge.
    regionIds: [...new Set([...(lat !== null && lon !== null ? regionsForPoint(lat, lon) : []), ...points.flatMap(([la, lo]) => regionsForPoint(la, lo))])],
  };
}

/** The API answers with { "broadcast-warn": [...] }; a bare array is accepted too. */
export function warningsFromBody(body: unknown): NgaWarningRaw[] {
  if (Array.isArray(body)) return body as NgaWarningRaw[];
  const list = (body as Record<string, unknown> | null)?.['broadcast-warn'];
  return Array.isArray(list) ? (list as NgaWarningRaw[]) : [];
}

// ── Daily in-force files (v0.66.1) ─────────────────────────────────────────

/** Series heading in the daily files → the API's navArea code. */
const MEMO_SERIES: Record<string, string> = { HYDROLANT: 'A', HYDROPAC: 'P', HYDROARC: 'ARC', 'NAVAREA IV': '4', 'NAVAREA XII': '12' };
const MEMO_DATE = /^(\d{6}Z)\s+([A-Z]{3})\s+(\d{2}|\d{4})\.?$/;
const MEMO_ID = /^(HYDROLANT|HYDROPAC|HYDROARC|NAVAREA IV|NAVAREA XII)\s+(\d{1,5})\/(\d{2})(?:\s*\([A-Z0-9 ,]*\))?\.?$/;
const fullYear = (y: string) => (y.length === 2 ? `20${y}` : y);

/**
 * Reads one of the plain-text "in force" files NGA posts (DailyMemLAN.txt etc.): a heading with the
 * in-force time, then warnings, each a date line ("211454Z NOV 26"), an id line ("HYDROPAC 3431/26") and text.
 */
export function parseDailyMemo(body: string): { asOf: string | null; warnings: NgaWarningRaw[] } {
  const lines = body.replace(/\r/g, '').split('\n').map((l) => l.trim());
  const head = /IN FORCE AS OF\s+(\d{6}Z)\s+([A-Z]{3})\s+(\d{2,4})/.exec(lines.slice(0, 5).join(' ').toUpperCase());
  const asOf = head ? parseIssueDate(`${head[1]} ${head[2]} ${fullYear(head[3])}`) : null;
  const warnings: NgaWarningRaw[] = [];
  let cur: NgaWarningRaw | null = null;
  let text: string[] = [];
  const flush = () => {
    if (cur) warnings.push({ ...cur, text: text.join(' ').trim() });
    cur = null;
    text = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const d = MEMO_DATE.exec(lines[i].toUpperCase());
    const id = d && i + 1 < lines.length ? MEMO_ID.exec(lines[i + 1].toUpperCase()) : null;
    if (d && id) {
      flush();
      cur = { msgYear: fullYear(id[3]), msgNumber: id[2], navArea: MEMO_SERIES[id[1]], issueDate: `${d[1]} ${d[2]} ${fullYear(d[3])}`, status: 'A' };
      i++;
      continue;
    }
    if (cur && lines[i]) text.push(lines[i]);
  }
  flush();
  return { asOf, warnings };
}
