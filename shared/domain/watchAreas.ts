import { ALERT_SEVERITIES, type AlertSeverity } from './alerts/types.ts';
import { EVENT_CATEGORIES, type EventCategory } from './types.ts';

/**
 * Watch areas (v0.74.0): circles or polygons the owner and editors draw on the map. Each can raise an
 * alert for any exactly located record inside it (strikes, fires, aircraft, ships, cable flags …), and
 * has a page of what is inside. Shared: every member sees them.
 *
 * Only records with exact coordinates are tested: a report placed at a city or country centre is not
 * "inside" anything.
 */
export type WatchShape =
  | { kind: 'circle'; lat: number; lon: number; radiusKm: number }
  /** Ring of [lon, lat], not closed (the last point joins the first). */
  | { kind: 'polygon'; points: [number, number][] };

export interface WatchArea {
  id: string;
  name: string;
  shape: WatchShape;
  alert: {
    enabled: boolean;
    severity: AlertSeverity;
    /** Empty = every category. */
    categories: EventCategory[];
    discord: boolean;
  };
  note: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export const WATCH_AREA_LIMITS = { areas: 50, name: 60, note: 500, points: 50, minRadiusKm: 0.5, maxRadiusKm: 1000, cooldownMinutes: 60 };

const EARTH_KM = 6371.0088;
const rad = (d: number) => (d * Math.PI) / 180;
export function kmBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const h = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Point in shape: great-circle distance for circles, ray casting for polygons (fine below a few hundred km). */
export function inShape(shape: WatchShape, lat: number, lon: number): boolean {
  if (shape.kind === 'circle') return kmBetween(shape.lat, shape.lon, lat, lon) <= shape.radiusKm;
  const pts = shape.points;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** [west, south, east, north] */
export function shapeBounds(shape: WatchShape): [number, number, number, number] {
  if (shape.kind === 'polygon') {
    const xs = shape.points.map((p) => p[0]);
    const ys = shape.points.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  const dLat = shape.radiusKm / 111.195;
  const dLon = dLat / Math.max(0.05, Math.cos(rad(shape.lat)));
  return [shape.lon - dLon, shape.lat - dLat, shape.lon + dLon, shape.lat + dLat];
}

export function shapeCentre(shape: WatchShape): [lat: number, lon: number] {
  if (shape.kind === 'circle') return [shape.lat, shape.lon];
  const [w, s, e, n] = shapeBounds(shape);
  return [(s + n) / 2, (w + e) / 2];
}

/** Ring for drawing (closed), [lon, lat]. */
export function shapeRing(shape: WatchShape, steps = 64): [number, number][] {
  if (shape.kind === 'polygon') return [...shape.points, shape.points[0]];
  const d = shape.radiusKm / EARTH_KM;
  const la1 = rad(shape.lat);
  const lo1 = rad(shape.lon);
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const b = rad((i / steps) * 360);
    const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b));
    const lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
    out.push([(lo2 * 180) / Math.PI, (la2 * 180) / Math.PI]);
  }
  return out;
}

/** Approximate size in km², for display. */
export function shapeAreaKm2(shape: WatchShape): number {
  if (shape.kind === 'circle') return Math.PI * shape.radiusKm ** 2;
  const [lat0] = shapeCentre(shape);
  const k = Math.cos(rad(lat0)) * 111.195;
  let a = 0;
  const p = shape.points;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * k * (p[i][1] * 111.195) - p[i][0] * k * (p[j][1] * 111.195);
  return Math.abs(a) / 2;
}

export function describeShape(shape: WatchShape): string {
  const km2 = Math.round(shapeAreaKm2(shape)).toLocaleString('en-US');
  return shape.kind === 'circle' ? `circle, ${shape.radiusKm} km radius (${km2} km²)` : `polygon, ${shape.points.length} points (${km2} km²)`;
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function validateWatchArea(a: WatchArea): string[] {
  const p: string[] = [];
  if (!/^[a-z0-9-]{4,40}$/.test(a.id)) p.push('Bad id.');
  if (!a.name?.trim()) p.push('Give the area a name.');
  if ((a.name ?? '').length > WATCH_AREA_LIMITS.name) p.push(`Name: at most ${WATCH_AREA_LIMITS.name} characters.`);
  if ((a.note ?? '').length > WATCH_AREA_LIMITS.note) p.push(`Note: at most ${WATCH_AREA_LIMITS.note} characters.`);
  const s = a.shape;
  if (s?.kind === 'circle') {
    if (!finite(s.lat) || !finite(s.lon) || Math.abs(s.lat) > 85 || Math.abs(s.lon) > 180) p.push('Circle centre is not a valid position.');
    if (!finite(s.radiusKm) || s.radiusKm < WATCH_AREA_LIMITS.minRadiusKm || s.radiusKm > WATCH_AREA_LIMITS.maxRadiusKm)
      p.push(`Radius: ${WATCH_AREA_LIMITS.minRadiusKm}–${WATCH_AREA_LIMITS.maxRadiusKm} km.`);
  } else if (s?.kind === 'polygon') {
    if (!Array.isArray(s.points) || s.points.length < 3 || s.points.length > WATCH_AREA_LIMITS.points) p.push(`A polygon needs 3–${WATCH_AREA_LIMITS.points} points.`);
    else if (s.points.some((q) => !Array.isArray(q) || q.length !== 2 || !finite(q[0]) || !finite(q[1]) || Math.abs(q[1]) > 85 || Math.abs(q[0]) > 180)) p.push('A polygon point is not a valid position.');
    else if (shapeAreaKm2(s) < 1) p.push('The polygon is too small.');
  } else p.push('Draw a circle or a polygon.');
  if (!ALERT_SEVERITIES.includes(a.alert?.severity)) p.push('Unknown alert level.');
  if (!Array.isArray(a.alert?.categories) || a.alert.categories.some((c) => !EVENT_CATEGORIES.includes(c))) p.push('Unknown category.');
  return p;
}

export const newAreaId = (now: number, rnd: () => number = Math.random) => `area-${now.toString(36)}-${Math.floor(rnd() * 36 ** 5).toString(36).padStart(5, '0')}`;

/** Whether an exactly located record falls inside the area (and matches its categories). */
export function recordInArea(a: Pick<WatchArea, 'shape' | 'alert'>, e: { locationPrecision: string; latitude?: number; longitude?: number; category: EventCategory }): boolean {
  if (e.locationPrecision !== 'exact' || !finite(e.latitude) || !finite(e.longitude)) return false;
  if (a.alert.categories.length && !a.alert.categories.includes(e.category)) return false;
  return inShape(a.shape, e.latitude, e.longitude);
}

/**
 * Firestore cannot store nested arrays, so polygon corners are stored as { lo, la } objects and turned
 * back into [lon, lat] pairs when read (app and collector alike).
 */
export function toStored(a: WatchArea): Record<string, unknown> {
  return a.shape.kind === 'polygon' ? { ...a, shape: { kind: 'polygon', points: a.shape.points.map(([lo, la]) => ({ lo, la })) } } : { ...a };
}
export function fromStored(raw: unknown): WatchArea {
  const a = raw as WatchArea & { shape: { kind: string; points?: unknown[] } };
  if (a?.shape?.kind === 'polygon' && Array.isArray(a.shape.points)) {
    const points = a.shape.points.map((p) => (Array.isArray(p) ? p : [(p as { lo: number }).lo, (p as { la: number }).la])) as [number, number][];
    return { ...a, shape: { kind: 'polygon', points } };
  }
  return a as WatchArea;
}
