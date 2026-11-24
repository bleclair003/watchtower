import { degreesLat, degreesLong, eciToGeodetic, gstime, json2satrec, propagate, type SatRec } from 'satellite.js';
import type { SatElement } from '@shared/domain/satellites';
import type { BBox } from '@shared/domain/types';

/**
 * SGP4 positions and passes in the browser (v0.84.0), from CelesTrak elements. Positions are approximate
 * (a few km near the epoch, worse as elements age).
 */

export function toSatrec(el: SatElement): SatRec | null {
  const orbital = [el.MEAN_MOTION, el.ECCENTRICITY, el.INCLINATION, el.RA_OF_ASC_NODE, el.ARG_OF_PERICENTER, el.MEAN_ANOMALY];
  if (!orbital.every(Number.isFinite) || el.MEAN_MOTION <= 0 || Number.isNaN(Date.parse(`${el.EPOCH}Z`))) return null;
  try {
    const r = json2satrec(el as never);
    return r && !r.error ? r : null;
  } catch {
    return null;
  }
}

export interface SubPoint {
  lat: number;
  lon: number;
  altKm: number;
}

export function subPoint(rec: SatRec, at: Date): SubPoint | null {
  try {
    const pv = propagate(rec, at);
    if (!pv || typeof pv.position !== 'object' || !pv.position) return null;
    const g = eciToGeodetic(pv.position, gstime(at));
    const lat = degreesLat(g.latitude);
    const lon = degreesLong(g.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(g.height)) return null;
    return { lat, lon, altKm: g.height };
  } catch {
    return null;
  }
}

/** Ground track from `from` over `minutes`, one point every `stepSec`, split where it crosses the antimeridian. */
export function groundTrack(rec: SatRec, from: number, minutes: number, stepSec = 60): [number, number][][] {
  const segs: [number, number][][] = [[]];
  let prevLon: number | null = null;
  for (let t = 0; t <= minutes * 60; t += stepSec) {
    const p = subPoint(rec, new Date(from + t * 1000));
    if (!p) continue;
    if (prevLon !== null && Math.abs(p.lon - prevLon) > 180) segs.push([]);
    segs[segs.length - 1].push([p.lon, p.lat]);
    prevLon = p.lon;
  }
  return segs.filter((s) => s.length > 1);
}

export interface Pass {
  start: number;
  end: number;
  /** Sub-satellite point nearest the box centre during the pass. */
  closest: SubPoint;
}

const inBox = (p: SubPoint, [w, s, e, n]: BBox, padDeg: number) => p.lat >= s - padDeg && p.lat <= n + padDeg && p.lon >= w - padDeg && p.lon <= e + padDeg;

/** Windows when the ground track is inside `box` (padded), from `from` over `hours`, sampled every `stepSec`. */
export function passesOver(rec: SatRec, box: BBox, from: number, hours: number, stepSec = 60, padDeg = 1): Pass[] {
  const out: Pass[] = [];
  const cx = (box[0] + box[2]) / 2;
  const cy = (box[1] + box[3]) / 2;
  let cur: Pass | null = null;
  let best = Infinity;
  for (let t = 0; t <= hours * 3600; t += stepSec) {
    const at = from + t * 1000;
    const p = subPoint(rec, new Date(at));
    if (p && inBox(p, box, padDeg)) {
      const d = (p.lat - cy) ** 2 + (p.lon - cx) ** 2;
      if (!cur) {
        cur = { start: at, end: at, closest: p };
        best = d;
      } else {
        cur.end = at;
        if (d < best) {
          best = d;
          cur.closest = p;
        }
      }
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}
