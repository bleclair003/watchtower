import { WATCH_REGIONS } from '../regions.ts';
import type { RegionScore } from '../indicators/types.ts';
import type { LeadLagResult, LeadLagRow, Meter, MeterKind } from './types.ts';
import { DAY, H } from './util.ts';

/** Packed point: `id=value;id=value` (values rounded to 0.1). Kept as one string so Firestore indexes one field, not hundreds. */
export function packValues(values: Record<string, number | null>): string {
  return Object.entries(values)
    .filter(([, v]) => v !== null && Number.isFinite(v))
    .map(([k, v]) => `${k}=${Math.round(v! * 10) / 10}`)
    .join(';');
}

export function unpackValues(packed: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of packed.split(';')) {
    const i = part.lastIndexOf('=');
    if (i > 0) {
      const v = Number(part.slice(i + 1));
      if (Number.isFinite(v)) out[part.slice(0, i)] = v;
    }
  }
  return out;
}

export interface HistoryPoint {
  at: string;
  packed: string;
}

export const SHORT_HISTORY_POINTS = 48;
/** Long history: one point every 3 hours for 120 days (collector-only, for the lead/lag lab). */
export const LONG_HISTORY_SPACING_H = 3;
export const LONG_HISTORY_DAYS = 120;

export function pointFor(meters: Meter[], scores: RegionScore[], nowIso: string): HistoryPoint {
  const values: Record<string, number | null> = Object.fromEntries(meters.map((m) => [m.id, m.value]));
  for (const s of scores) values[`rai.${s.regionId}`] = s.score;
  return { at: nowIso, packed: packValues(values) };
}

export function appendShort(history: HistoryPoint[], p: HistoryPoint): HistoryPoint[] {
  return [...history, p].slice(-SHORT_HISTORY_POINTS);
}

/** Adds a point if the last is at least 3 hours old; drops points older than 120 days. */
export function appendLong(history: HistoryPoint[], p: HistoryPoint): HistoryPoint[] {
  const last = history[history.length - 1];
  const next = !last || Date.parse(p.at) - Date.parse(last.at) >= LONG_HISTORY_SPACING_H * H - 5 * 60_000 ? [...history, p] : history;
  const cutoff = Date.parse(p.at) - LONG_HISTORY_DAYS * DAY;
  return next.filter((x) => Date.parse(x.at) >= cutoff);
}

export const MIN_RISES = 5;
const RISE_POINTS = 10;

/**
 * Lead/lag lab: for each region, find RAI rises (+10 or more within 24 hours); for each meter kind,
 * check whether its value for that region (or its global value) rose in the 72 hours before the
 * rise, rose only in the 24 hours after, or stayed flat. Tallies only: with fewer than 5 rises the
 * result says so and draws no conclusion.
 */
export function leadLag(history: HistoryPoint[], now: number): LeadLagResult {
  const pts = history.map((p) => ({ t: Date.parse(p.at), v: unpackValues(p.packed) })).sort((a, b) => a.t - b.t);
  const historyDays = pts.length ? Math.round(((now - pts[0].t) / DAY) * 10) / 10 : 0;
  const rises: { region: string; t: number }[] = [];
  for (const r of WATCH_REGIONS) {
    let lastRise = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i].v[`rai.${r.id}`];
      if (cur === undefined || pts[i].t - lastRise < DAY) continue;
      const base = pts.filter((p) => p.t >= pts[i].t - DAY && p.t < pts[i].t).map((p) => p.v[`rai.${r.id}`]).filter((x): x is number => x !== undefined);
      if (base.length && cur - Math.min(...base) >= RISE_POINTS) {
        rises.push({ region: r.id, t: pts[i].t });
        lastRise = pts[i].t;
      }
    }
  }
  const kinds = new Set<MeterKind>();
  for (const p of pts) for (const k of Object.keys(p.v)) if (!k.startsWith('rai.')) kinds.add(k.split('.')[0] as MeterKind);
  const valueAt = (key: string, t: number) => {
    let v: number | undefined;
    for (const p of pts) {
      if (p.t > t) break;
      if (p.v[key] !== undefined) v = p.v[key];
    }
    return v;
  };
  const maxIn = (key: string, from: number, to: number) => {
    const xs = pts.filter((p) => p.t > from && p.t <= to && p.v[key] !== undefined).map((p) => p.v[key]);
    return xs.length ? Math.max(...xs) : undefined;
  };
  const rows: LeadLagRow[] = [...kinds].sort().map((kind) => {
    const row: LeadLagRow = { meterKind: kind, rises: 0, led: 0, followed: 0, flat: 0 };
    for (const rise of rises) {
      const key = pts.some((p) => p.v[`${kind}.${rise.region}`] !== undefined) ? `${kind}.${rise.region}` : pts.some((p) => p.v[kind] !== undefined) ? kind : null;
      if (!key) continue;
      const before = valueAt(key, rise.t - 72 * H);
      const peakBefore = maxIn(key, rise.t - 72 * H, rise.t);
      const atRise = valueAt(key, rise.t);
      const peakAfter = maxIn(key, rise.t, rise.t + 24 * H);
      if (before === undefined && atRise === undefined) continue;
      row.rises++;
      if (before !== undefined && peakBefore !== undefined && peakBefore > before) row.led++;
      else if (atRise !== undefined && peakAfter !== undefined && peakAfter > atRise) row.followed++;
      else row.flat++;
    }
    return row;
  });
  return {
    computedAt: new Date(now).toISOString(),
    historyDays,
    minRises: MIN_RISES,
    rows: rows.filter((r) => r.rises > 0 || rises.length === 0),
    note:
      rises.length < MIN_RISES
        ? `${rises.length} RAI rise(s) in ${historyDays} days of meter history: too few to say which meters lead. Tallies will mean something after ${MIN_RISES} or more rises.`
        : `${rises.length} RAI rises in ${historyDays} days. A meter that "led" rose in the 72 hours before a rise; this shows association in WATCHTOWER's own data, not cause.`,
  };
}
