import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { WATCH_REGIONS } from '../../shared/domain/regions.ts';
import {
  AIRCRAFT_CLASS_LABEL,
  AIRCRAFT_PROVIDERS,
  AIRCRAFT_ROLE_LABEL,
  NOTABLE_AIRCRAFT_CLASSES,
  aircraftLabel,
  aircraftRole,
  aircraftTypeName,
  type AircraftClass,
  type AircraftPosition,
  type AircraftSnapshot,
} from '../../shared/domain/aircraft.ts';
import { AIRCRAFT_PATTERN_SUBTYPE, PATTERN_LEARNING_DAYS, PATTERN_NOVELTY_DAYS, type AircraftPattern } from '../../shared/domain/aircraftPatterns.ts';
import { regionsForSeaOrWatchCountry } from '../geo/countries.ts';
import { contentHash } from '../lib/hash.ts';
import { LIMITS, truncate } from '../lib/text.ts';

/**
 * Unusual aircraft movement (v0.63.0). Works from the 30-minute ADS-B snapshots:
 *  - hold: a tanker, surveillance/command aircraft or bomber stays within HOLD_RADIUS_KM for at least
 *    HOLD_MIN_MINUTES at altitude, in a 1° grid square where that class has not held for 30 days;
 *  - first appearance: an aircraft type seen in a watch area for the first time in 30 days;
 *  - group (v0.66.0): GROUP_MIN_SIZE or more tankers, surveillance/command aircraft or bombers at altitude
 *    within GROUP_RADIUS_KM of each other, in a 3° square of a watch area with no such group for 30 days;
 *  - odd hour (v0.66.0): ODD_HOUR_MIN_AIRCRAFT or more notable aircraft in a watch area in a UTC hour that
 *    had none on all but ODD_HOUR_MAX_BUSY_DAYS of the last 14 days (at least ODD_HOUR_MIN_DAYS checked).
 * Memory is kept in the source state. Nothing is flagged until the memory is PATTERN_LEARNING_DAYS old,
 * because before that every hold and type would look new.
 */

const MIN = 60_000;
const DAY = 86_400_000;
export const HOLD_RADIUS_KM = 60;
export const HOLD_MIN_MINUTES = 55; // three 30-minute runs
export const HOLD_MIN_ALT_FT = 10_000;
/** Positions kept per aircraft. */
const TRACK_KEEP_MINUTES = 4 * 60;
/** Memory entries older than this are dropped. */
const MEMORY_KEEP_DAYS = 60;
const HOLD_CLASSES: AircraftClass[] = ['tanker', 'isr', 'bomber'];
export const GROUP_RADIUS_KM = 300;
export const GROUP_MIN_SIZE = 3;
const GROUP_CELL_DEG = 3;
export const ODD_HOUR_MIN_AIRCRAFT = 2;
export const ODD_HOUR_LOOKBACK_DAYS = 14;
/** Days of the lookback that must have been checked at this hour. */
export const ODD_HOUR_MIN_DAYS = 12;
/** "Usually empty": notable aircraft at this hour on at most this many of those days. */
export const ODD_HOUR_MAX_BUSY_DAYS = 1;
/** Below this altitude an aircraft may be on the ground at a base: not counted for hours. */
const AIRBORNE_FT = 1_000;
/** Airlift over the US is constant, as in the sighting records. */
const SKIP_CLASSES_BY_REGION: Record<string, string[]> = { 'united-states': ['airlift'] };

export interface PatternMemory {
  /** When this memory started (ISO). */
  since: string;
  /**
   * hex → recent positions packed as "minute,lat,lon,alt;…" (alt empty when unknown). Packed because
   * Firestore cannot store arrays inside arrays.
   */
  tracks: Record<string, string>;
  /** "class|lat|lon" (1° square) → last day held there; flagged = day a record was made, before = last day before that. */
  holds: Record<string, MemoryEntry>;
  /** "region|type" → last day seen; flagged and before as for holds. */
  types: Record<string, MemoryEntry>;
  /** v0.66.0: "region|lat|lon" (3° square) → last day a group was there. Absent in older memory. */
  groups?: Record<string, MemoryEntry>;
  /** When group memory started (it learns on its own 14 days). */
  groupsSince?: string;
  /** v0.66.0: region → "YYYYMMDDHH:count;…", the most notable aircraft airborne in the area at once in each UTC hour checked. */
  hours?: Record<string, string>;
}

interface MemoryEntry {
  last: string;
  flagged?: string;
  before?: string | null;
}

export type TrackPoint = [number, number, number, number | null];
export const packTrack = (pts: TrackPoint[]) => pts.map((p) => `${p[0]},${p[1]},${p[2]},${p[3] ?? ''}`).join(';');
export function unpackTrack(s: string | undefined): TrackPoint[] {
  if (!s) return [];
  return s.split(';').flatMap((part) => {
    const [m, la, lo, alt] = part.split(',');
    const p: TrackPoint = [Number(m), Number(la), Number(lo), alt === '' || alt === undefined ? null : Number(alt)];
    return p.slice(0, 3).every((n) => Number.isFinite(n)) ? [p] : [];
  });
}

export const emptyMemory = (nowIso: string): PatternMemory => ({ since: nowIso, tracks: {}, holds: {}, types: {}, groups: {}, groupsSince: nowIso, hours: {} });

export function unpackHours(s: string | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const part of (s ?? '').split(';')) {
    const [k, v] = part.split(':');
    if (/^\d{10}$/.test(k ?? '') && Number.isFinite(Number(v))) out.set(k, Number(v));
  }
  return out;
}
const packHours = (m: Map<string, number>) => [...m].map(([k, v]) => `${k}:${v}`).join(';');
export const hourKey = (ms: number) => new Date(ms).toISOString().slice(0, 13).replace(/[-T]/g, '');

/** Greedy clusters: the aircraft with most neighbours within the radius, with those neighbours, repeatedly. */
export function findGroups<T extends { la: number; lo: number }>(items: T[], radiusKm = GROUP_RADIUS_KM, minSize = GROUP_MIN_SIZE): T[][] {
  let left = [...items];
  const groups: T[][] = [];
  for (;;) {
    let best: T[] = [];
    for (const a of left) {
      const near = left.filter((b) => distanceKm(a.la, a.lo, b.la, b.lo) <= radiusKm);
      if (near.length > best.length) best = near;
    }
    if (best.length < minSize) return groups;
    groups.push(best);
    left = left.filter((x) => !best.includes(x));
  }
}

export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const r = Math.PI / 180;
  const dLat = (bLat - aLat) * r;
  const dLon = (bLon - aLon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/** Novel when never seen, last seen more than the novelty period ago, or already flagged today (same record). */
function isNovel(entry: MemoryEntry | undefined, today: string): boolean {
  if (!entry) return true;
  if (entry.flagged === today) return true;
  return daysBetween(entry.last, today) > PATTERN_NOVELTY_DAYS;
}

/** Last day seen before today's record (null when never seen). */
const seenBefore = (entry: MemoryEntry | undefined, today: string) => (!entry ? null : entry.flagged === today ? (entry.before ?? null) : entry.last);

/** The entry after today's sighting. */
function nextEntry(entry: MemoryEntry | undefined, today: string, flaggedNow: boolean): MemoryEntry {
  if (flaggedNow) return { last: today, flagged: today, before: seenBefore(entry, today) };
  return entry?.flagged ? { last: today, flagged: entry.flagged, before: entry.before ?? null } : { last: today };
}

/** A hold: the last positions spanning at least HOLD_MIN_MINUTES, all near their centre, at altitude. */
export function findHold(points: TrackPoint[]): { lat: number; lon: number; minutes: number } | null {
  if (points.length < 3) return null;
  // Longest run ending now in which every point is within the radius of the run's centre.
  for (let start = 0; start <= points.length - 3; start++) {
    const run = points.slice(start);
    const minutes = run[run.length - 1][0] - run[0][0];
    if (minutes < HOLD_MIN_MINUTES) return null;
    const lat = run.reduce((s, p) => s + p[1], 0) / run.length;
    const lon = run.reduce((s, p) => s + p[2], 0) / run.length;
    const alts = run.map((p) => p[3]).filter((a): a is number => a !== null).sort((x, y) => x - y);
    const medianAlt = alts.length ? alts[Math.floor(alts.length / 2)] : null;
    if (medianAlt === null || medianAlt < HOLD_MIN_ALT_FT) continue;
    if (run.every((p) => distanceKm(lat, lon, p[1], p[2]) <= HOLD_RADIUS_KM)) return { lat, lon, minutes };
  }
  return null;
}

function where(a: Pick<AircraftPosition, 'la' | 'lo' | 'cls'>, role: string | null) {
  const w = regionsForSeaOrWatchCountry(a.la, a.lo);
  return { ...w, regionIds: w.regionIds.filter((r) => role || !(SKIP_CLASSES_BY_REGION[r] ?? []).includes(a.cls)) };
}

function record(
  snapshot: AircraftSnapshot,
  nowIso: string,
  a: AircraftPosition,
  regionId: string,
  pattern: AircraftPattern,
  idParts: string[],
  title: string,
  summary: string,
  lat: number,
  lon: number,
  country: string | null,
  extra: Record<string, unknown>,
): IntelligenceEvent {
  const provider = AIRCRAFT_PROVIDERS[snapshot.provider];
  const id = contentHash('adsb-pattern', pattern, ...idParts);
  return {
    id,
    contentHash: id,
    dataOrigin: 'live',
    sourceId: 'adsb-military',
    sourceName: `${provider.name} — Military aircraft (ADS-B)`,
    sourceClass: 'aggregator',
    sourceUrl: provider.aircraftUrl(a.hex),
    title: truncate(title, LIMITS.title),
    summary: truncate(
      `${summary} Detected by WATCHTOWER from ${provider.name} positions sampled every 30 minutes; only aircraft that broadcast ADS-B are seen, and an unusual pattern is not by itself evidence of an operation.`,
      LIMITS.summary,
    ),
    category: 'military',
    regionIds: [regionId],
    countryCodes: country ? [country] : [],
    publishedAt: nowIso,
    occurredAt: nowIso,
    collectedAt: nowIso,
    credibility: 'single-source',
    verificationStatus: 'unreviewed',
    latitude: Math.round(lat * 100) / 100,
    longitude: Math.round(lon * 100) / 100,
    locationPrecision: 'exact',
    metadata: {
      subtype: AIRCRAFT_PATTERN_SUBTYPE,
      pattern,
      // Deliberately not "aircraftClass": the volume indicators count sightings, not these.
      patternClass: a.cls,
      ...(aircraftRole(a) ? { aircraftRole: aircraftRole(a) } : {}),
      aircraftType: a.t,
      hex: a.hex,
      callsign: a.cs,
      registration: a.reg,
      provider: provider.id,
      licence: provider.licence,
      ...extra,
    },
  };
}

/**
 * Updates the memory with this snapshot and returns pattern records. Pure apart from the returned memory.
 */
export function detectPatterns(
  snapshot: AircraftSnapshot,
  nowMs: number,
  prev: PatternMemory | null,
): { events: IntelligenceEvent[]; memory: PatternMemory; learning: boolean } {
  const nowIso = new Date(nowMs).toISOString();
  const today = dayOf(nowMs);
  const minute = Math.round(nowMs / MIN);
  const mem: PatternMemory = prev
    ? {
        since: prev.since,
        tracks: { ...prev.tracks },
        holds: { ...prev.holds },
        types: { ...prev.types },
        groups: { ...(prev.groups ?? {}) },
        groupsSince: prev.groupsSince ?? nowIso,
        hours: { ...(prev.hours ?? {}) },
      }
    : emptyMemory(nowIso);
  const learning = nowMs - Date.parse(mem.since) < PATTERN_LEARNING_DAYS * DAY;
  const memoryDays = Math.floor((nowMs - Date.parse(mem.since)) / DAY);
  const noveltyText = memoryDays >= PATTERN_NOVELTY_DAYS ? `${PATTERN_NOVELTY_DAYS} days` : `the ${memoryDays} days WATCHTOWER has been watching`;
  const events: IntelligenceEvent[] = [];
  const seenHex = new Set<string>();

  for (const a of snapshot.aircraft) {
    const role = aircraftRole(a);
    const notable = NOTABLE_AIRCRAFT_CLASSES.includes(a.cls) || !!role;
    if (!notable) continue;
    const typeName = aircraftTypeName(a.t) ?? a.t ?? 'unknown type';
    const label = aircraftLabel(a);
    const kind = role ? AIRCRAFT_ROLE_LABEL[role].toLowerCase() : `${AIRCRAFT_CLASS_LABEL[a.cls].toLowerCase()} aircraft`;
    const here = where(a, role);

    // First appearance of a type in a watch area.
    if (a.t) {
      for (const regionId of here.regionIds) {
        const key = `${regionId}|${a.t}`;
        const entry = mem.types[key];
        const novel = isNovel(entry, today);
        if (!learning && novel) {
          const region = WATCH_REGIONS.find((r) => r.id === regionId)!;
          events.push(
            record(
              snapshot, nowIso, a, regionId, 'first-appearance', [regionId, a.t, today],
              `First ${typeName} in the ${region.shortCode} watch area in ${memoryDays >= PATTERN_NOVELTY_DAYS ? `${PATTERN_NOVELTY_DAYS} days` : `${memoryDays} days`}: ${label}`,
              `A ${kind} of a type not seen in the ${region.name} watch area in ${noveltyText}: ${typeName}${a.reg ? ` (${a.reg})` : ''}, callsign ${a.cs ?? 'not broadcast'}, at ${a.la.toFixed(2)}, ${a.lo.toFixed(2)}${a.alt !== null ? `, ${a.alt.toLocaleString('en-US')} ft` : ''}.`,
              a.la, a.lo, here.country,
              { lastSeenBefore: seenBefore(entry, today), memoryDays },
            ),
          );
        }
        mem.types[key] = nextEntry(entry, today, !learning && novel);
      }
    }

    // Holds: tankers, surveillance/command aircraft, bombers, command posts and VIP transports.
    if (!HOLD_CLASSES.includes(a.cls) && !role) continue;
    seenHex.add(a.hex);
    const pts = [...unpackTrack(mem.tracks[a.hex]), [minute, a.la, a.lo, a.alt] as TrackPoint].filter((p) => minute - p[0] <= TRACK_KEEP_MINUTES);
    mem.tracks[a.hex] = packTrack(pts);
    const hold = findHold(pts);
    if (!hold) continue;
    const at = where({ la: hold.lat, lo: hold.lon, cls: a.cls }, role);
    if (!at.regionIds.length) continue;
    const cell = `${role ?? a.cls}|${Math.floor(hold.lat)}|${Math.floor(hold.lon)}`;
    const entry = mem.holds[cell];
    const novel = isNovel(entry, today);
    if (!learning && novel) {
      const regionId = at.regionIds[0];
      const region = WATCH_REGIONS.find((r) => r.id === regionId)!;
      const hours = Math.round((hold.minutes / 60) * 2) / 2;
      events.push(
        record(
          snapshot, nowIso, a, regionId, 'hold', [a.hex, cell, today],
          `${typeName} ${label} holding about ${hours} h — ${region.shortCode} watch area, no ${role ? AIRCRAFT_ROLE_LABEL[role].toLowerCase() : AIRCRAFT_CLASS_LABEL[a.cls].toLowerCase()} hold there in ${memoryDays >= PATTERN_NOVELTY_DAYS ? `${PATTERN_NOVELTY_DAYS} days` : `${memoryDays} days`}`,
          `A ${kind} (${typeName}${a.reg ? `, ${a.reg}` : ''}, callsign ${a.cs ?? 'not broadcast'}) stayed within ${HOLD_RADIUS_KM} km of ${hold.lat.toFixed(2)}, ${hold.lon.toFixed(2)} for at least ${Math.round(hold.minutes)} minutes at altitude${at.country ? `, over ${at.country}` : ''}. No aircraft of this kind has held in this 1° square in ${noveltyText}.`,
          hold.lat, hold.lon, at.country,
          { holdMinutes: Math.round(hold.minutes), cell, lastHeldBefore: seenBefore(entry, today), memoryDays },
        ),
      );
    }
    mem.holds[cell] = nextEntry(entry, today, !learning && novel);
  }

  events.push(...detectGroups(snapshot, nowMs, mem));
  events.push(...detectOddHours(snapshot, nowMs, mem));

  // Forget aircraft not seen for an hour (one missed sample is tolerated) and stale memory.
  for (const [hex, packed] of Object.entries(mem.tracks)) {
    const last = unpackTrack(packed).at(-1);
    if (!seenHex.has(hex) && (!last || minute - last[0] > 60)) delete mem.tracks[hex];
  }
  for (const book of [mem.holds, mem.types, mem.groups ?? {}]) for (const [k, v] of Object.entries(book)) if (daysBetween(v.last, today) > MEMORY_KEEP_DAYS) delete book[k];

  return { events, memory: mem, learning };
}

const DAY_WORD = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

function describeMix(list: AircraftPosition[]): string {
  const counts = new Map<string, number>();
  for (const a of list) {
    const role = aircraftRole(a);
    const k = role ? AIRCRAFT_ROLE_LABEL[role].toLowerCase() : AIRCRAFT_CLASS_LABEL[a.cls].toLowerCase();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts].sort((x, y) => y[1] - x[1]).map(([k, n]) => `${n} ${k}`).join(', ');
}

const memberList = (list: AircraftPosition[]) => list.map((a) => `${aircraftTypeName(a.t) ?? a.t ?? 'unknown type'} ${a.cs ?? a.reg ?? a.hex}`).join('; ');
const members = (list: AircraftPosition[]) => list.map((a) => ({ hex: a.hex, type: a.t, callsign: a.cs, cls: a.cls }));
const typeList = (list: AircraftPosition[]) => [...new Set(list.map((a) => a.t ?? '?'))].join(', ');

/** Groups of strategic aircraft at altitude where no group has been seen for 30 days. Updates mem.groups. */
function detectGroups(snapshot: AircraftSnapshot, nowMs: number, mem: PatternMemory): IntelligenceEvent[] {
  const nowIso = new Date(nowMs).toISOString();
  const today = dayOf(nowMs);
  const book = (mem.groups ??= {});
  const since = mem.groupsSince ?? nowIso;
  const learning = nowMs - Date.parse(since) < PATTERN_LEARNING_DAYS * DAY;
  const memoryDays = Math.floor((nowMs - Date.parse(since)) / DAY);
  const strategic = snapshot.aircraft.filter((a) => {
    const role = aircraftRole(a);
    return (HOLD_CLASSES.includes(a.cls) || role === 'command') && role !== 'vip' && a.alt !== null && a.alt >= HOLD_MIN_ALT_FT;
  });
  const events: IntelligenceEvent[] = [];
  for (const g of findGroups(strategic)) {
    const lat = g.reduce((s, a) => s + a.la, 0) / g.length;
    const lon = g.reduce((s, a) => s + a.lo, 0) / g.length;
    const at = regionsForSeaOrWatchCountry(lat, lon);
    const regionId = at.regionIds[0];
    if (!regionId) continue;
    const cell = `${regionId}|${Math.floor(lat / GROUP_CELL_DEG) * GROUP_CELL_DEG}|${Math.floor(lon / GROUP_CELL_DEG) * GROUP_CELL_DEG}`;
    const entry = book[cell];
    const novel = isNovel(entry, today);
    if (!learning && novel) {
      const region = WATCH_REGIONS.find((r) => r.id === regionId)!;
      const span = Math.round(Math.max(...g.flatMap((a) => g.map((b) => distanceKm(a.la, a.lo, b.la, b.lo)))));
      const short = memoryDays >= PATTERN_NOVELTY_DAYS ? `${PATTERN_NOVELTY_DAYS} days` : DAY_WORD(memoryDays);
      const period = memoryDays >= PATTERN_NOVELTY_DAYS ? `${PATTERN_NOVELTY_DAYS} days` : `the ${DAY_WORD(memoryDays)} WATCHTOWER has been watching`;
      events.push(
        record(
          snapshot, nowIso, g[0], regionId, 'group', [cell, today],
          `${g.length} strategic aircraft together — ${region.shortCode} watch area: ${describeMix(g)}; no such group there in ${short}`,
          `${g.length} tankers, surveillance or command aircraft and bombers were airborne within ${span} km of each other around ${lat.toFixed(2)}, ${lon.toFixed(2)}${at.country ? `, over ${at.country}` : ''}: ${memberList(g)}. No group of ${GROUP_MIN_SIZE} or more within ${GROUP_RADIUS_KM} km has been seen in this ${GROUP_CELL_DEG}° square in ${period}. Aircraft flying together can mean refuelling for a strike package, an exercise or a deployment.`,
          lat, lon, at.country,
          { groupSize: g.length, spanKm: span, cell, members: members(g), aircraftType: typeList(g), callsign: null, registration: null, lastGroupBefore: seenBefore(entry, today), memoryDays },
        ),
      );
    }
    book[cell] = nextEntry(entry, today, !learning && novel);
  }
  return events;
}

/** Notable aircraft in a watch area in an hour that is usually empty there. Updates mem.hours. */
function detectOddHours(snapshot: AircraftSnapshot, nowMs: number, mem: PatternMemory): IntelligenceEvent[] {
  const nowIso = new Date(nowMs).toISOString();
  const hours = (mem.hours ??= {});
  const key = hourKey(nowMs);
  const oldest = hourKey(nowMs - (ODD_HOUR_LOOKBACK_DAYS + 1) * DAY);
  const byRegion = new Map<string, AircraftPosition[]>();
  for (const a of snapshot.aircraft) {
    const role = aircraftRole(a);
    if (!(NOTABLE_AIRCRAFT_CLASSES.includes(a.cls) || role) || a.alt === null || a.alt < AIRBORNE_FT) continue;
    for (const regionId of where(a, role).regionIds) {
      const list = byRegion.get(regionId) ?? [];
      list.push(a);
      byRegion.set(regionId, list);
    }
  }
  const events: IntelligenceEvent[] = [];
  for (const region of WATCH_REGIONS) {
    if (!region.countryCodes.length) continue;
    const here = byRegion.get(region.id) ?? [];
    const seen = unpackHours(hours[region.id]);
    // The usual level: this UTC hour on each of the last 14 days, as checked then.
    const past: number[] = [];
    for (let d = 1; d <= ODD_HOUR_LOOKBACK_DAYS; d++) {
      const v = seen.get(hourKey(nowMs - d * DAY));
      if (v !== undefined) past.push(v);
    }
    seen.set(key, Math.max(seen.get(key) ?? 0, here.length));
    for (const k of [...seen.keys()]) if (k < oldest) seen.delete(k);
    hours[region.id] = packHours(seen);
    const busy = past.filter((v) => v > 0).length;
    if (here.length < ODD_HOUR_MIN_AIRCRAFT || past.length < ODD_HOUR_MIN_DAYS || busy > ODD_HOUR_MAX_BUSY_DAYS) continue;
    const hh = key.slice(8);
    const lat = here.reduce((s, a) => s + a.la, 0) / here.length;
    const lon = here.reduce((s, a) => s + a.lo, 0) / here.length;
    const country = regionsForSeaOrWatchCountry(here[0].la, here[0].lo).country;
    events.push(
      record(
        snapshot, nowIso, here[0], region.id, 'odd-hour', [region.id, key],
        `${here.length} military aircraft at ${hh}:00Z — ${region.shortCode} watch area, an hour with none on ${past.length - busy} of the last ${past.length} days: ${describeMix(here)}`,
        `${here.length} notable military aircraft (tankers, surveillance aircraft, bombers, transports, command posts or VIP transports) were airborne in the ${region.name} watch area in the ${hh}:00–${hh}:59 UTC hour: ${memberList(here)}. On the last ${past.length} days WATCHTOWER checked at this hour, it saw any there on ${busy === 0 ? 'none' : DAY_WORD(busy)}. Flights at unusual hours can mean an operation, a deployment or an exercise; they can also be a one-off ferry flight.`,
        lat, lon, country,
        { aircraftCount: here.length, hourUtc: Number(hh), daysChecked: past.length, busyDays: busy, members: members(here), aircraftType: typeList(here), callsign: null, registration: null },
      ),
    );
  }
  return events;
}
