import { distanceKm } from './installations.ts';
import { nearbyLines, underseaName, UNDERSEA_LABEL, type UnderseaLine } from './undersea.ts';
import type { InfraSite } from './infrastructure.ts';
import type { SanctionedShipSighting } from './sanctionedShips.ts';

/**
 * Sanctioned ships lingering near undersea cables and pipelines (v0.73.0).
 *
 * Ships cross the Baltic's cables all the time, so being near one is not news. The pattern behind the
 * 2023–2024 incidents (Balticconnector, Estlink 2, C-Lion 1) was a ship moving slowly over a line, or
 * staying near it. A sanctioned ship is flagged when, within CABLE_NEAR_KM of a mapped line, it is
 * moving under CABLE_SLOW_KN, or it is seen near the same line again CABLE_REPEAT_MIN or more later
 * (within CABLE_REPEAT_HOURS). Positions within PORT_EXCLUDE_KM of a known port are ignored: ships
 * anchor there routinely. AIS is sampled for about 25 seconds a run, so most passes are never seen.
 */
export const CABLE_NEAR_KM = 2;
export const CABLE_SLOW_KN = 4;
export const CABLE_REPEAT_MIN = 30;
export const CABLE_REPEAT_HOURS = 6;
export const PORT_EXCLUDE_KM = 10;

export interface NearCableEntry {
  lineId: string;
  at: string;
  km: number;
}

export interface CableFlag {
  sighting: SanctionedShipSighting;
  line: UnderseaLine;
  km: number;
  reason: 'slow' | 'repeat';
  /** For "repeat": when the ship was first seen near this line in the window. */
  firstAt: string | null;
}

const shipKey = (s: SanctionedShipSighting) => s.imo ?? `mmsi:${s.mmsi}`;

/**
 * Checks this window's sightings against the lines; returns flags and the updated near-line log
 * (ship key → entries in the last CABLE_REPEAT_HOURS).
 */
export function checkCables(
  sightings: SanctionedShipSighting[],
  lines: UnderseaLine[],
  ports: Pick<InfraSite, 'la' | 'lo'>[],
  log: Record<string, NearCableEntry[]>,
  now: number,
): { flags: CableFlag[]; log: Record<string, NearCableEntry[]> } {
  const cutoff = now - CABLE_REPEAT_HOURS * 3_600_000;
  const next: Record<string, NearCableEntry[]> = {};
  for (const [k, entries] of Object.entries(log)) {
    const kept = entries.filter((e) => Date.parse(e.at) >= cutoff);
    if (kept.length) next[k] = kept;
  }
  const flags: CableFlag[] = [];
  for (const s of sightings) {
    if (ports.some((p) => distanceKm(p.la, p.lo, s.la, s.lo) <= PORT_EXCLUDE_KM)) continue;
    const near = nearbyLines(lines, s.la, s.lo, CABLE_NEAR_KM);
    if (!near.length) continue;
    const key = shipKey(s);
    const before = next[key] ?? [];
    for (const { line, km } of near) {
      const earlier = before.filter((e) => e.lineId === line.id && Date.parse(s.seenAt) - Date.parse(e.at) >= CABLE_REPEAT_MIN * 60_000);
      if (s.sog !== null && s.sog < CABLE_SLOW_KN) flags.push({ sighting: s, line, km, reason: 'slow', firstAt: null });
      else if (earlier.length) flags.push({ sighting: s, line, km, reason: 'repeat', firstAt: earlier[0].at });
    }
    next[key] = [...before.filter((e) => e.at !== s.seenAt), ...near.map(({ line, km }) => ({ lineId: line.id, at: s.seenAt, km }))].slice(-20);
  }
  return { flags, log: next };
}

export function cableFlagTitle(f: CableFlag): string {
  const what = UNDERSEA_LABEL[f.line.k].toLowerCase();
  return `Sanctioned vessel near ${what}: ${f.sighting.listedName} ${f.km} km from ${underseaName(f.line)}, ${f.reason === 'slow' ? `${f.sighting.sog} kn` : 'seen there again'}`;
}
