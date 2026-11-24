/**
 * Sanctioned vessels seen on AIS in the Baltic and North Sea (Phase 13, item 4b), and from v0.75.0 the
 * Black Sea and eastern Mediterranean, where receivers cover only parts of the coast.
 *
 * Positions come from aisstream.io, whose volunteer receivers cover north-west Europe well and
 * the Middle East and Asia not at all. Vessels are matched against the US, EU and UK sanctions
 * lists: by IMO number (permanent; carried in identity messages every few minutes) or, for
 * OFAC entries, by MMSI (in every position report, but it changes when a ship is re-flagged).
 */
import type { SanctionsListId } from './sanctions.ts';

export interface ShipArea {
  id: string;
  name: string;
  regionId: string | null;
  /** [[south, west], [north, east]] */
  box: [[number, number], [number, number]];
}

/** Checked in order: the Gulf of Finland lies inside the Baltic box. */
export const SHIP_AREAS: ShipArea[] = [
  { id: 'gulf-of-finland', name: 'Gulf of Finland', regionId: 'eastern-europe', box: [[59.0, 22.0], [60.8, 30.5]] },
  { id: 'baltic', name: 'Baltic Sea', regionId: 'eastern-europe', box: [[53.5, 9.5], [66.0, 30.5]] },
  { id: 'north-sea', name: 'North Sea and Channel', regionId: null, box: [[49.0, -5.5], [61.0, 9.5]] },
  // v0.75.0: partial receiver coverage along the coasts (measured 2026-11-24: about 60 and 100 ships in 2 minutes).
  { id: 'black-sea', name: 'Black Sea', regionId: 'eastern-europe', box: [[40.5, 27.5], [46.8, 41.8]] },
  { id: 'east-med', name: 'Eastern Mediterranean', regionId: 'middle-east', box: [[31.0, 28.0], [37.0, 36.5]] },
];

export function shipAreaAt(lat: number, lon: number): ShipArea | null {
  return SHIP_AREAS.find(({ box: [[s, w], [n, e]] }) => lat >= s && lat <= n && lon >= w && lon <= e) ?? null;
}

export interface SanctionedShipSighting {
  mmsi: string;
  imo: string | null;
  /** Name on the sanctions list (the broadcast name may differ). */
  listedName: string;
  /** Name the ship broadcast, if seen. */
  aisName: string | null;
  lists: SanctionsListId[];
  programs: string[];
  /** How the match was made. IMO is the stronger identifier. */
  matchedBy: 'imo' | 'mmsi';
  la: number;
  lo: number;
  /** Knots and degrees, if reported. */
  sog: number | null;
  cog: number | null;
  destination: string | null;
  area: string;
  seenAt: string;
}

export interface SanctionedShipsSnapshot {
  /** Last listening window. */
  listenedAt: string;
  listenSeconds: number;
  /** Messages and distinct ships received in the window (coverage check). */
  messages: number;
  ships: number;
  /** Sanctioned vessels known with an IMO or MMSI. */
  watchlistSize: number;
  /** Latest position per vessel over the last 48 hours. */
  sightings: SanctionedShipSighting[];
  simulated?: boolean;
}

/** Sightings older than this are dropped from the map. */
export const SIGHTING_KEEP_HOURS = 48;
