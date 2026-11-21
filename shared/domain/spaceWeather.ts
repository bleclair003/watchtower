/**
 * Space weather (Phase 19): coronal mass ejections (CMEs) and geomagnetic storms.
 *  - NASA DONKI (Space Weather Database Of Notifications, Knowledge, Information): CME measurements and
 *    WSA-Enlil model runs with predicted Earth arrival times and Kp ranges; observed geomagnetic storms.
 *  - NOAA Space Weather Prediction Center: the official R (radio blackout), S (solar radiation storm) and
 *    G (geomagnetic storm) scales now and for three days, the planetary K-index, and watches, warnings
 *    and alerts.
 * Why it matters here: strong storms degrade GPS, HF radio and satellite operations and stress power grids.
 * All US government data (public domain).
 */

export interface CmeArrival {
  /** DONKI CME id, e.g. "2026-11-19T15:36:00-CME-001" (or the simulation id when the CME is not named). */
  cmeId: string;
  /** When the CME left the Sun. */
  start: string | null;
  /** km/s, from the most accurate analysis. */
  speed: number | null;
  /** Predicted shock arrival at Earth (ISO). */
  arrival: string;
  /** Model expects only a glancing blow (edge of the CME). */
  glancing: boolean;
  /** Model Kp range for the 90° and 180° clock angles (the usual low/high pair), if given. */
  kpLow: number | null;
  kpHigh: number | null;
  modelRunAt: string | null;
  url: string;
}

export interface ScaleDay {
  date: string;
  /** Radio blackout probabilities (%) for minor (R1–R2) and major (R3+). */
  rMinor: number | null;
  rMajor: number | null;
  /** Solar radiation storm (S1+) probability (%). */
  s: number | null;
  /** Predicted geomagnetic storm level (0–5). */
  g: number | null;
}

export interface SwpcMessage {
  code: string;
  serial: string;
  issued: string;
  /** First line of the message, e.g. "WATCH: Geomagnetic Storm Category G2 Predicted". */
  headline: string;
  /** Scale named in the message (e.g. "G2", "R3", "S1"), if any. */
  scale: string | null;
  mentionsCme: boolean;
}

export interface SpaceWeatherSnapshot {
  fetchedAt: string;
  /** Current NOAA scales (0–5). */
  now: { r: number; s: number; g: number } | null;
  /** NOAA three-day outlook. */
  forecast: ScaleDay[];
  kp: { latest: number; at: string; max24h: number } | null;
  /** CMEs with a predicted Earth arrival from 12 hours ago onwards (latest model run per CME). */
  arrivals: CmeArrival[];
  /** CMEs measured in the last 7 days, and the fastest. */
  cmes7d: number;
  fastest7d: number | null;
  /** Observed geomagnetic storms (Kp ≥ 5) in the last 14 days: start and max Kp. */
  storms: { start: string; maxKp: number; url: string }[];
  /** Notable NOAA messages in the last 72 hours (newest first). */
  messages: SwpcMessage[];
  simulated?: boolean;
}

/** Kp → G scale: Kp 5 = G1 … Kp 9 = G5. */
export const gFromKp = (kp: number) => (kp >= 9 ? 5 : kp >= 8 ? 4 : kp >= 7 ? 3 : kp >= 6 ? 2 : kp >= 5 ? 1 : 0);

/** Parses a NOAA SWPC message: code, serial, headline and the scale it names. */
export function parseSwpcMessage(m: { product_id?: unknown; issue_datetime?: unknown; message?: unknown }): SwpcMessage | null {
  const text = typeof m.message === 'string' ? m.message : '';
  const code = text.match(/Space Weather Message Code:\s*(\S+)/)?.[1] ?? String(m.product_id ?? '');
  const serial = text.match(/Serial Number:\s*(\d+)/)?.[1] ?? '';
  const issuedRaw = typeof m.issue_datetime === 'string' ? m.issue_datetime : '';
  const issued = Number.isNaN(Date.parse(`${issuedRaw.replace(' ', 'T')}Z`)) ? null : new Date(Date.parse(`${issuedRaw.replace(' ', 'T')}Z`)).toISOString();
  const headline = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => /^(WATCH|WARNING|ALERT|SUMMARY|EXTENDED WARNING|CANCEL)/i.test(l));
  if (!code || !issued || !headline) return null;
  const scale = (text.match(/\b(?:Category|Scale)\s+([GRS][1-5])\b/i)?.[1] ?? text.match(/NOAA Scale:\s*([GRS][1-5])/i)?.[1] ?? null)?.toUpperCase() ?? null;
  return { code, serial, issued, headline, scale, mentionsCme: /\bCME\b|coronal mass ejection/i.test(text) };
}

/** Worth a record: a G2+/R3+/S2+ watch, warning or alert, any CME watch, or a geomagnetic K-index of 6+. */
export function isNotableMessage(m: SwpcMessage): boolean {
  if (/^CANCEL/i.test(m.headline)) return false;
  const n = m.scale ? Number(m.scale[1]) : 0;
  if (m.scale?.[0] === 'G' && n >= 2) return true;
  if (m.scale?.[0] === 'R' && n >= 3) return true;
  if (m.scale?.[0] === 'S' && n >= 2) return true;
  if (/K-index of ([6-9])/i.test(m.headline)) return true;
  return m.mentionsCme && /^WATCH/i.test(m.headline);
}

export const SPACE_WX_PAGE = 'https://www.swpc.noaa.gov/';
