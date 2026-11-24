import { compare, VERY_UNUSUAL, type Anomaly } from './anomaly.ts';
import { parseCsv } from './conflictEvents.ts';

/**
 * PLA activity around Taiwan (v0.82.0): Taiwan's Ministry of National Defense (MND) publishes a daily count
 * of Chinese military aircraft (and how many crossed the Taiwan Strait median line) and ships detected
 * around Taiwan, 06:00 to 06:00 (UTC+8). The MND site closes itself to automated readers (robots.txt), so
 * WATCHTOWER reads the same figures from Skyfaring's PLA Tracker, which transcribes each release verbatim
 * and publishes the compilation under CC BY 4.0 with a corrections log. It is a secondary source and is
 * labelled as one.
 *
 * Each day is compared with the 60 days before it (28 needed), for aircraft and for ships. 3 or more
 * typical spreads above the usual level is ABOVE USUAL: in the year to November 2026 that was about 40 days,
 * most of them the PLA's routine "joint combat readiness patrols". 6 or more is a SURGE: about 8 days in that
 * year, the large exercises (30–31 December 2025 reached 18 and 10 spreads).
 */

export const TAIWAN_PLA_SOURCE_ID = 'taiwan-pla-activity';
export const PLA_CSV_URL = 'https://pla-tracker.skyfaring.net/data/records.csv';
export const PLA_RECORDS_URL = 'https://pla-tracker.skyfaring.net/en/records';
export const PLA_CREDIT = 'Source: ROC Ministry of National Defense; compilation & charts: Skyfaring’s PLA Tracker (pla-tracker.skyfaring.net), CC BY 4.0';
export const PLA_BASELINE_DAYS = 60;
export const PLA_MIN_DAYS = 28;
export const PLA_ABOVE = VERY_UNUSUAL;
export const PLA_SURGE = 6;
export type PlaLevel = 'normal' | 'above' | 'surge';
export const PLA_LEVEL_LABEL: Record<PlaLevel, string> = { normal: 'usual', above: 'ABOVE USUAL', surge: 'SURGE' };

export interface PlaDay {
  /** YYYY-MM-DD: the MND release date (the 24 hours ending 06:00 UTC+8 that day). */
  date: string;
  aircraft: number | null;
  /** Of which crossed the median line (or its extension). */
  crossed: number | null;
  /** PLA Navy and official ships. */
  ships: number | null;
  /** Manned, UAV, Helicopter, Mixed, Zero, Unknown. */
  type: string;
  /** Balloons, when the release mentions them. */
  balloons: number;
  /** The MND's own wording on crossings and events (Chinese), as transcribed. */
  note: string;
}

const num = (s: string | undefined) => {
  const t = (s ?? '').trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};

/** Parses records.csv (date,aircraft_total,median_line_cross,cross_rate,aircraft_type,ships_total,activity_start,activity_end,special_event). */
export function parsePlaCsv(text: string): PlaDay[] {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  const head = rows.shift()?.map((h) => h.trim().toLowerCase()) ?? [];
  const col = (name: string) => head.indexOf(name);
  const [cDate, cAir, cCross, cType, cShips, cNote] = ['date', 'aircraft_total', 'median_line_cross', 'aircraft_type', 'ships_total', 'special_event'].map(col);
  if (cDate < 0 || cAir < 0 || cShips < 0) throw new Error('PLA Tracker CSV: unexpected columns');
  const byDate = new Map<string, PlaDay>();
  for (const r of rows) {
    const date = (r[cDate] ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const note = (cNote >= 0 ? r[cNote] ?? '' : '').trim().slice(0, 300);
    const balloons = [...note.matchAll(/氣球計?偵獲(\d+)顆/g)].reduce((a, m) => a + Number(m[1]), 0);
    byDate.set(date, {
      date,
      aircraft: num(r[cAir]),
      crossed: cCross >= 0 ? num(r[cCross]) : null,
      ships: num(r[cShips]),
      type: (cType >= 0 ? r[cType] ?? '' : '').trim().slice(0, 20),
      balloons,
      note,
    });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export interface PlaAssessment {
  aircraft: Anomaly;
  ships: Anomaly;
  level: PlaLevel;
}

/** A day against the PLA_BASELINE_DAYS calendar days before it (days the MND did not publish are skipped). */
export function assessDay(days: PlaDay[], date: string): PlaAssessment | null {
  const day = days.find((d) => d.date === date);
  if (!day) return null;
  const from = addDays(date, -PLA_BASELINE_DAYS);
  const prior = days.filter((d) => d.date >= from && d.date < date);
  const series = (k: 'aircraft' | 'ships') => prior.map((d) => d[k]).filter((x): x is number => x !== null);
  const aircraft = compare(day.aircraft ?? NaN, series('aircraft'), { kind: 'count', minSamples: PLA_MIN_DAYS });
  const ships = compare(day.ships ?? NaN, series('ships'), { kind: 'count', minSamples: PLA_MIN_DAYS });
  const top = Math.max(...[aircraft, ships].map((a) => (a.status === 'ok' && Number.isFinite(a.current) ? (a.score ?? 0) : 0)));
  return { aircraft, ships, level: top >= PLA_SURGE ? 'surge' : top >= PLA_ABOVE ? 'above' : 'normal' };
}

export interface TaiwanPlaSnapshot {
  fetchedAt: string;
  /** Last 90 published days: [date, aircraft, crossed, ships] (null when not stated). */
  days: [string, number | null, number | null, number | null][];
  latest: (PlaDay & { aircraftUsual: number | null; aircraftScore: number | null; shipsUsual: number | null; shipsScore: number | null; level: PlaLevel }) | null;
  /** Busiest day in the last 365 days (aircraft), for scale. */
  yearMax: { date: string; aircraft: number } | null;
  firstDate: string | null;
  totalDays: number;
  simulated?: boolean;
}

export function buildPlaSnapshot(days: PlaDay[], fetchedAt: string): TaiwanPlaSnapshot {
  const last = days[days.length - 1] ?? null;
  const a = last ? assessDay(days, last.date) : null;
  const yearFrom = last ? addDays(last.date, -365) : '';
  const year = days.filter((d) => d.date > yearFrom && d.aircraft !== null);
  const top = year.reduce<PlaDay | null>((m, d) => (!m || (d.aircraft ?? 0) > (m.aircraft ?? 0) ? d : m), null);
  return {
    fetchedAt,
    days: days.slice(-90).map((d) => [d.date, d.aircraft, d.crossed, d.ships]),
    latest:
      last && a
        ? { ...last, aircraftUsual: a.aircraft.centre, aircraftScore: a.aircraft.score, shipsUsual: a.ships.centre, shipsScore: a.ships.score, level: a.level }
        : null,
    yearMax: top ? { date: top.date, aircraft: top.aircraft ?? 0 } : null,
    firstDate: days[0]?.date ?? null,
    totalDays: days.length,
  };
}
