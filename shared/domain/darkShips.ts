import { kmBetween } from './watchAreas.ts';
import type { TrafficKind } from './shipTraffic.ts';

/**
 * Ships going dark (v0.77.0), from Fintraffic's feed, which reports every ship its Finnish receivers hear
 * each run. A tanker or cargo ship is flagged when:
 *  - it was heard on at least MIN_STREAK runs in a row (steady contact, not a ship at the edge of range);
 *  - at its last fix it was under way (MIN_SOG knots or more, not anchored, moored or aground) and more
 *    than PORT_KM from a port;
 *  - it has now been silent between MIN_SILENT_MIN and MAX_SILENT_MIN;
 *  - at least COVER_SHIPS other ships are heard right now within COVER_KM of its last position AND of
 *    where it would be by now at its last speed and course, so receivers are working where it should be.
 * When it is heard again, a second record says how long it was gone and how far it moved.
 *
 * Turning AIS off is legal in some cases (security threats, some fishing) and receivers fail, so a flag is
 * a lead to check, not proof of evasion.
 */
export const DARK = { minStreak: 3, minSog: 2, portKm: 15, coverKm: 30, coverShips: 3, minSilentMin: 60, maxSilentMin: 360, keepHours: 48, maxProjectKm: 150 };
/** AIS navigational status codes that mean the ship is not under way: at anchor, moored, aground. */
const STOPPED = new Set([1, 5, 6]);

/** Last fix per ship from the Finnish feed: steady-contact streak and position (epoch minutes). */
export interface FinEntry {
  streak: number;
  at: number;
  la: number;
  lo: number;
  sog: number | null;
  cog: number | null;
  nav: number | null;
}

export interface DarkEntry {
  mmsi: string;
  name: string | null;
  imo: string | null;
  kind: TrafficKind;
  la: number;
  lo: number;
  /** Last heard (epoch minutes). */
  at: number;
  sog: number | null;
  cog: number | null;
  flaggedAt: number;
  sanctioned: boolean;
}

export type DarkFlag =
  | { type: 'dark'; ship: DarkEntry; silentMin: number; projected: [number, number] }
  | { type: 'back'; ship: DarkEntry; gapMin: number; movedKm: number; la: number; lo: number };

export interface FixNow {
  la: number;
  lo: number;
  sog: number | null;
  cog: number | null;
  nav: number | null;
  /** Epoch minutes of the fix. */
  at: number;
}

/** Point `km` from (lat, lon) along `bearing`. */
export function project(lat: number, lon: number, bearing: number, km: number): [number, number] {
  const d = km / 6371.0088;
  const b = (bearing * Math.PI) / 180;
  const la1 = (lat * Math.PI) / 180;
  const lo1 = (lon * Math.PI) / 180;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b));
  const lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return [(la2 * 180) / Math.PI, (lo2 * 180) / Math.PI];
}

export function detectDark(
  prev: { fin: Record<string, FinEntry>; dark: Record<string, DarkEntry> },
  /** Fintraffic fixes this run, for every ship (used for the coverage check). */
  allNow: Map<string, FixNow>,
  /** Tanker or cargo identity for a ship, or null. */
  identity: (mmsi: string) => { kind: TrafficKind; name: string | null; imo: string | null } | null,
  isSanctioned: (mmsi: string, imo: string | null) => boolean,
  ports: { la: number; lo: number }[],
  nowMin: number,
): { fin: Record<string, FinEntry>; dark: Record<string, DarkEntry>; flags: DarkFlag[] } {
  const fin: Record<string, FinEntry> = {};
  const dark: Record<string, DarkEntry> = {};
  const flags: DarkFlag[] = [];
  for (const [m, d] of Object.entries(prev.dark)) if (nowMin - d.flaggedAt <= DARK.keepHours * 60) dark[m] = d;
  const heardNear = (lat: number, lon: number, self: string) =>
    [...allNow.entries()].filter(([m, f]) => m !== self && kmBetween(lat, lon, f.la, f.lo) <= DARK.coverKm).length;

  // Ships heard now: streaks, and ships coming back.
  for (const [mmsi, f] of allNow) {
    const id = identity(mmsi);
    if (!id) continue;
    const p = prev.fin[mmsi];
    const streak = p ? (f.at > p.at ? p.streak + 1 : p.streak) : 1;
    fin[mmsi] = { streak, at: f.at, la: f.la, lo: f.lo, sog: f.sog, cog: f.cog, nav: f.nav };
    const d = dark[mmsi];
    if (d && f.at > d.at) {
      flags.push({ type: 'back', ship: d, gapMin: f.at - d.at, movedKm: Math.round(kmBetween(d.la, d.lo, f.la, f.lo)), la: f.la, lo: f.lo });
      delete dark[mmsi];
    }
  }

  // Ships not heard now.
  for (const [mmsi, e] of Object.entries(prev.fin)) {
    if (allNow.has(mmsi) || dark[mmsi]) continue;
    const silent = nowMin - e.at;
    if (silent < DARK.minSilentMin) {
      fin[mmsi] = e; // not long enough yet: check again next run
      continue;
    }
    if (silent > DARK.maxSilentMin) continue;
    const id = identity(mmsi);
    if (!id || e.streak < DARK.minStreak) continue;
    if (e.sog === null || e.sog < DARK.minSog || (e.nav !== null && STOPPED.has(e.nav))) continue;
    if (ports.some((p) => kmBetween(p.la, p.lo, e.la, e.lo) <= DARK.portKm)) continue;
    const km = Math.min(DARK.maxProjectKm, e.sog * 1.852 * (silent / 60));
    const projected = project(e.la, e.lo, e.cog ?? 0, e.cog === null ? 0 : km);
    if (heardNear(e.la, e.lo, mmsi) < DARK.coverShips || heardNear(projected[0], projected[1], mmsi) < DARK.coverShips) continue;
    const ship: DarkEntry = { mmsi, name: id.name, imo: id.imo, kind: id.kind, la: e.la, lo: e.lo, at: e.at, sog: e.sog, cog: e.cog, flaggedAt: nowMin, sanctioned: isSanctioned(mmsi, id.imo) };
    dark[mmsi] = ship;
    flags.push({ type: 'dark', ship, silentMin: silent, projected: [Math.round(projected[0] * 1000) / 1000, Math.round(projected[1] * 1000) / 1000] });
  }
  return { fin, dark, flags };
}
