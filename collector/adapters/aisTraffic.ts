import { SHIP_AREAS, shipAreaAt } from '../../shared/domain/sanctionedShips.ts';
import {
  TRACK_HOURS,
  TRACK_MAX_POINTS,
  TRAFFIC_MAX_SHIPS,
  TRAFFIC_SOURCE_ID,
  kindOfType,
  type ShipTrafficDoc,
  type TrafficShip,
} from '../../shared/domain/shipTraffic.ts';
import { readSecret } from '../lib/secrets.ts';
import { cleanText } from '../lib/text.ts';
import { AIS_KEY_ENV, LISTEN_SECONDS, listenAisStream, parseAisTime, takeAisWindow, type AisMessage, type Listener, type ListenResult } from './aisSanctioned.ts';
import type { AdapterContext, AdapterResult, SourceAdapter } from './types.ts';

/**
 * Tanker and cargo traffic (v0.75.0): from the AIS window the sanctioned-ship source already opens.
 * Remembers each tanker's and cargo ship's type, name, IMO and destination between runs (identity
 * messages come every few minutes, so one window sees few), and keeps a point per run for 24 hours.
 * Makes no records: it feeds the map's SHIPS layer.
 */
export { TRAFFIC_SOURCE_ID };

/** Remembered identity: [type, name, imo, destination, last heard (epoch minutes)]. */
type Known = [number, string | null, string | null, string | null, number];
/** Track: flat [lon, lat, epoch minutes, …], oldest first. */
export interface TrafficState {
  known: Record<string, Known>;
  tracks: Record<string, number[]>;
  /** Latest position per ship: [lat, lon, sog, cog, epoch minutes, area index]. */
  last: Record<string, [number, number, number | null, number | null, number, number]>;
  failedWindows?: number;
  latest: ShipTrafficDoc | null;
}

/** Identities kept, most recently heard first (a few hundred KB of state at most). */
export const KNOWN_MAX = 4000;
const KNOWN_DAYS = 7;
const MIN_POINT_MINUTES = 20;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const AREA_RANK = ['gulf-of-finland', 'black-sea', 'east-med', 'baltic', 'north-sea'];

export function updateTraffic(prev: TrafficState | null, msgs: AisMessage[], now: number, listenSeconds: number): TrafficState {
  const nowMin = Math.floor(now / 60_000);
  const known: Record<string, Known> = { ...(prev?.known ?? {}) };
  // Identities from this window.
  for (const m of msgs) {
    if (m.MessageType !== 'ShipStaticData') continue;
    const s = m.Message?.ShipStaticData;
    const mmsi = String(m.MetaData?.MMSI ?? '');
    if (!s || !/^\d{9}$/.test(mmsi)) continue;
    const kind = kindOfType(s.Type);
    if (!kind) {
      if (typeof s.Type === 'number' && s.Type > 0) delete known[mmsi]; // re-typed as something else
      continue;
    }
    const imo = typeof s.ImoNumber === 'number' && s.ImoNumber >= 1_000_000 && s.ImoNumber <= 9_999_999 ? String(s.ImoNumber) : null;
    known[mmsi] = [s.Type!, s.Name?.trim() ? cleanText(s.Name).slice(0, 40) : null, imo, s.Destination?.trim() ? cleanText(s.Destination).slice(0, 40) : null, nowMin];
  }
  // Latest position per ship in the window.
  const latest = new Map<string, AisMessage>();
  for (const m of msgs) {
    if (m.MessageType !== 'PositionReport') continue;
    const mmsi = String(m.MetaData?.MMSI ?? '');
    const p = latest.get(mmsi);
    if (!p || (m.MetaData.time_utc ?? '') >= (p.MetaData.time_utc ?? '')) latest.set(mmsi, m);
  }
  const tracks: Record<string, number[]> = {};
  const last: TrafficState['last'] = {};
  const cutoff = nowMin - TRACK_HOURS * 60;
  for (const [mmsi, t] of Object.entries(prev?.tracks ?? {})) {
    const kept: number[] = [];
    for (let i = 0; i + 2 < t.length; i += 3) if (t[i + 2] >= cutoff) kept.push(t[i], t[i + 1], t[i + 2]);
    if (kept.length) tracks[mmsi] = kept;
  }
  for (const [mmsi, l] of Object.entries(prev?.last ?? {})) if (l[4] >= cutoff) last[mmsi] = l;
  for (const [mmsi, m] of latest) {
    const k = known[mmsi];
    if (!k) continue;
    const la = num(m.MetaData.latitude);
    const lo = num(m.MetaData.longitude);
    if (la === null || lo === null) continue;
    const area = shipAreaAt(la, lo);
    if (!area) continue;
    const p = m.Message.PositionReport ?? {};
    const sog = num(p.Sog);
    const cog = num(p.Cog);
    const at = Math.floor(Date.parse(parseAisTime(m.MetaData.time_utc) ?? new Date(now).toISOString()) / 60_000);
    k[4] = Math.max(k[4], at);
    last[mmsi] = [r3(la), r3(lo), sog !== null && sog < 102.3 ? Math.round(sog * 10) / 10 : null, cog !== null && cog < 360 ? Math.round(cog) : null, at, SHIP_AREAS.indexOf(area)];
    const t = tracks[mmsi] ?? [];
    const lastAt = t.length ? t[t.length - 1] : -Infinity;
    if (at - lastAt >= MIN_POINT_MINUTES) t.push(r3(lo), r3(la), at);
    tracks[mmsi] = t.slice(-TRACK_MAX_POINTS * 3);
  }
  // Forget identities not heard for a week, and keep the most recent KNOWN_MAX.
  const keep = Object.entries(known)
    .filter(([, k]) => k[4] >= nowMin - KNOWN_DAYS * 1440)
    .sort((a, b) => b[1][4] - a[1][4])
    .slice(0, KNOWN_MAX);
  const knownNext = Object.fromEntries(keep);

  // Map document: watch-region seas first, tankers before cargo, most recent first, capped.
  const ships: TrafficShip[] = [];
  for (const [mmsi, l] of Object.entries(last)) {
    const k = knownNext[mmsi];
    const kind = k ? kindOfType(k[0]) : null;
    if (!k || !kind) continue;
    const t = tracks[mmsi] ?? [];
    const seen = l[4];
    const track: number[] = [];
    for (let i = 0; i + 2 < t.length; i += 3) if (t[i + 2] < seen) track.push(t[i], t[i + 1], seen - t[i + 2]);
    ships.push({
      mmsi, name: k[1], imo: k[2], kind, type: k[0], destination: k[3], la: l[0], lo: l[1], sog: l[2], cog: l[3],
      seenAt: new Date(seen * 60_000).toISOString(), area: SHIP_AREAS[l[5]]?.id ?? 'north-sea', track,
    });
  }
  const totalSeen = ships.length;
  ships.sort(
    (a, b) => AREA_RANK.indexOf(a.area) - AREA_RANK.indexOf(b.area) || Number(b.kind === 'tanker') - Number(a.kind === 'tanker') || b.seenAt.localeCompare(a.seenAt),
  );
  const shown = ships.slice(0, TRAFFIC_MAX_SHIPS);
  // Tracks are kept only for ships that are on the map, so state stays small.
  const shownSet = new Set(shown.map((s) => s.mmsi));
  for (const mmsi of Object.keys(tracks)) if (!shownSet.has(mmsi)) delete tracks[mmsi];
  for (const mmsi of Object.keys(last)) if (!shownSet.has(mmsi)) delete last[mmsi];
  return {
    known: knownNext,
    tracks,
    last,
    failedWindows: 0,
    latest: { fetchedAt: new Date(now).toISOString(), listenSeconds, typesKnown: Object.keys(knownNext).length, ships: shown, totalSeen },
  };
}

export function makeAisTrafficAdapter(listener: Listener = listenAisStream): SourceAdapter<TrafficState> {
  return {
    sourceId: TRAFFIC_SOURCE_ID,
    requiredEnv: [AIS_KEY_ENV],
    async collect(ctx: AdapterContext<TrafficState>): Promise<AdapterResult<TrafficState>> {
      const key = readSecret(AIS_KEY_ENV);
      if (!key) throw new Error(`${AIS_KEY_ENV} is not set`);
      let heard: ListenResult;
      try {
        heard = await takeAisWindow(listener, key);
      } catch (err) {
        // The sanctioned-ship source reports AIS outages; this one keeps the last map until three in a row fail.
        const failed = (ctx.state?.failedWindows ?? 0) + 1;
        const message = err instanceof Error ? err.message : String(err);
        if (failed >= 3) throw new Error(`${message} (${failed} listens in a row failed)`);
        // Tolerated from the first run on (v0.75.1): the map keeps the last traffic, or shows none yet.
        const base: TrafficState = ctx.state ?? { known: {}, tracks: {}, last: {}, latest: null };
        return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: { ...base, failedWindows: failed }, note: `listen failed (${failed} of 3 tolerated in a row)` };
      }
      const state = updateTraffic(ctx.state, heard.msgs, ctx.now, heard.seconds ?? LISTEN_SECONDS);
      return { events: [], rejected: [], itemsSeen: heard.messages, notModified: false, state, note: `${state.latest!.ships.length} tankers and cargo ships on the map, ${state.latest!.typesKnown} types known` };
    },
  };
}

export const aisTraffic = makeAisTrafficAdapter();
