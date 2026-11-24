import { parseCsv } from './conflictEvents.ts';

/**
 * Satellites (v0.84.0): orbital elements (GP / OMM) from CelesTrak for two groups — military satellites with
 * public element sets, and Earth imaging and resource satellites — read at most twice a day (CelesTrak
 * updates every 2 hours and asks users not to download more often than that, in CSV). Positions and passes
 * are computed in the browser with SGP4 (satellite.js).
 *
 * Limits: the public catalogue leaves out many classified satellites; positions from elements are good to a
 * few kilometres for a day or two after the epoch and drift after that; a pass means the ground track
 * crosses a region, not that anything was imaged.
 */

export const SATELLITES_SOURCE_ID = 'celestrak-satellites';
export const SAT_GROUPS = [
  { id: 'military', label: 'Military (public element sets)' },
  { id: 'resource', label: 'Earth imaging and resources' },
] as const;
export type SatGroup = (typeof SAT_GROUPS)[number]['id'];
export const satGroupUrl = (g: SatGroup) => `https://celestrak.org/NORAD/elements/gp.php?GROUP=${g}&FORMAT=csv`;
export const SAT_CREDIT = 'Orbital data: CelesTrak (celestrak.org), from the US Space Force catalogue';

/** The OMM fields satellite.js json2satrec reads. */
export interface SatElement {
  OBJECT_NAME: string;
  OBJECT_ID: string;
  EPOCH: string;
  MEAN_MOTION: number;
  ECCENTRICITY: number;
  INCLINATION: number;
  RA_OF_ASC_NODE: number;
  ARG_OF_PERICENTER: number;
  MEAN_ANOMALY: number;
  EPHEMERIS_TYPE: number;
  CLASSIFICATION_TYPE: string;
  NORAD_CAT_ID: number;
  ELEMENT_SET_NO: number;
  REV_AT_EPOCH: number;
  BSTAR: number;
  MEAN_MOTION_DOT: number;
  MEAN_MOTION_DDOT: number;
}

const NUM = ['MEAN_MOTION', 'ECCENTRICITY', 'INCLINATION', 'RA_OF_ASC_NODE', 'ARG_OF_PERICENTER', 'MEAN_ANOMALY', 'EPHEMERIS_TYPE', 'NORAD_CAT_ID', 'ELEMENT_SET_NO', 'REV_AT_EPOCH', 'BSTAR', 'MEAN_MOTION_DOT', 'MEAN_MOTION_DDOT'] as const;
const COLS = ['OBJECT_NAME', 'OBJECT_ID', 'EPOCH', ...NUM.slice(0, 7), 'CLASSIFICATION_TYPE', ...NUM.slice(7)] as const;

/** Parses CelesTrak GP CSV. Rows with a missing or non-numeric orbital field are dropped. */
export function parseGpCsv(text: string): SatElement[] {
  const rows = parseCsv(text.replace(/^﻿/, '').trim() + '\n');
  const head = rows.shift()?.map((h) => h.trim()) ?? [];
  if (!COLS.every((c) => head.includes(c))) throw new Error('CelesTrak GP CSV: unexpected columns');
  const at = (r: string[], c: string) => (r[head.indexOf(c)] ?? '').trim();
  const out: SatElement[] = [];
  for (const r of rows) {
    if (r.length < head.length) continue;
    const el: Record<string, unknown> = { OBJECT_NAME: at(r, 'OBJECT_NAME'), OBJECT_ID: at(r, 'OBJECT_ID'), EPOCH: at(r, 'EPOCH'), CLASSIFICATION_TYPE: at(r, 'CLASSIFICATION_TYPE') || 'U' };
    let ok = !!el.OBJECT_NAME && !Number.isNaN(Date.parse(`${el.EPOCH}Z`));
    for (const k of NUM) {
      const v = Number(at(r, k));
      if (!Number.isFinite(v)) ok = false;
      el[k] = v;
    }
    if (ok && (el.MEAN_MOTION as number) > 0) out.push(el as unknown as SatElement);
  }
  return out;
}

/** One stored satellite: its elements and group. */
export interface StoredSat {
  g: SatGroup;
  el: SatElement;
}
export interface SatellitesSnapshot {
  fetchedAt: string;
  sats: StoredSat[];
  /** Per group: count and the newest element epoch. */
  groups: { id: SatGroup; count: number; newestEpoch: string | null }[];
  simulated?: boolean;
}

/** Orbital period (minutes), and rough perigee and apogee heights (km) from the mean motion. */
export function orbitShape(el: Pick<SatElement, 'MEAN_MOTION' | 'ECCENTRICITY'>): { periodMin: number; perigeeKm: number; apogeeKm: number } {
  const MU = 398_600.4418;
  const R = 6378.137;
  const n = (el.MEAN_MOTION * 2 * Math.PI) / 86_400; // rad/s
  const a = Math.cbrt(MU / (n * n));
  return { periodMin: 1440 / el.MEAN_MOTION, perigeeKm: a * (1 - el.ECCENTRICITY) - R, apogeeKm: a * (1 + el.ECCENTRICITY) - R };
}

/** Hours between the element epoch and `now`: positions get worse with age. */
export const epochAgeHours = (el: Pick<SatElement, 'EPOCH'>, now: number) => (now - Date.parse(`${el.EPOCH}Z`)) / 3_600_000;
