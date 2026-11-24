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
import { contentHash } from '../lib/hash.ts';
import { LIMITS, truncate } from '../lib/text.ts';
import { loadPorts } from '../lib/ports.ts';
import { DIGITRAFFIC_CREDIT } from '../lib/digitraffic.ts';
import { addCounts, TANKER_ZONES, zoneAt, zoneLevels, type PackedHours, type ZoneLevel } from '../../shared/domain/tankerLevels.ts';
import { DARK, detectDark, type DarkEntry, type DarkFlag, type FinEntry, type FixNow } from '../../shared/domain/darkShips.ts';
import { TRAFFIC_LABEL } from '../../shared/domain/shipTraffic.ts';
import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { cleanText } from '../lib/text.ts';
import { AIS_KEY_ENV, gatherAis, loadSanctionsWatchlist, LISTEN_SECONDS, listenAisStream, parseAisTime, takeAisWindow, type AisMessage, type Listener } from './aisSanctioned.ts';
import type { AdapterContext, AdapterResult, SourceAdapter } from './types.ts';

/**
 * Tanker and cargo traffic (v0.75.0): from the AIS window the sanctioned-ship source already opens, and
 * from v0.76.0 Fintraffic's Digitraffic feed (every vessel its Finnish receivers hear).
 * Remembers each tanker's and cargo ship's type, name, IMO and destination between runs (identity
 * messages come every few minutes, so one window sees few), and keeps a point per run for 24 hours.
 * Feeds the map's SHIPS layer, and from v0.77.0 makes records for ships going dark in Finnish waters.
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
  /** v0.77.0: last Fintraffic fix per tanker or cargo ship, and ships currently dark. */
  fin?: Record<string, FinEntry>;
  dark?: Record<string, DarkEntry>;
  /** v0.78.0: tankers per Gulf of Finland zone per hour (Fintraffic), and the day each zone was last recorded. */
  levels?: PackedHours;
  levelRecorded?: Record<string, string>;
}

/** A record for a zone whose last 24 hours are far above or below its usual level (v0.78.0). */
export function levelEvent(z: ZoneLevel, nowIso: string): IntelligenceEvent {
  const zone = TANKER_ZONES.find((x) => x.id === z.id)!;
  const [s, w, n, e] = zone.box;
  const surge = z.direction === 'surge';
  const day = nowIso.slice(0, 10);
  const id = contentHash(TRAFFIC_SOURCE_ID, 'level', z.id, day);
  return {
    id,
    contentHash: id,
    dataOrigin: 'live',
    sourceId: TRAFFIC_SOURCE_ID,
    sourceName: 'Fintraffic Digitraffic AIS — tanker traffic levels',
    sourceClass: 'official',
    sourceUrl: 'https://www.digitraffic.fi/en/marine-traffic/',
    title: truncate(
      `Tanker traffic ${surge ? 'surge' : 'drop'}: ${zone.name}, ${z.last24.mean} tankers on average in the last 24 h against a usual ${z.centre}`,
      LIMITS.title,
    ),
    summary: truncate(
      `Tankers heard in ${zone.name} averaged ${z.last24.mean} over the last 24 hours (${z.last24.anchored} at anchor), against a median of ${z.centre} over ${z.days.length} earlier days: ${z.score} typical spreads ${surge ? 'above' : 'below'} normal. ` +
        (surge
          ? 'A surge can be a loading rush or a queue waiting at anchor. '
          : 'A drop can follow strikes on oil terminals, loading halts or bad weather. ') +
        `Counted each collection run from every ship Finland's receivers hear. ${DIGITRAFFIC_CREDIT}.`,
      LIMITS.summary,
    ),
    category: 'maritime',
    regionIds: ['eastern-europe'],
    countryCodes: ['RU'],
    publishedAt: nowIso,
    occurredAt: nowIso,
    collectedAt: nowIso,
    credibility: 'official',
    verificationStatus: 'unreviewed',
    latitude: Math.round(((s + n) / 2) * 1000) / 1000,
    longitude: Math.round(((w + e) / 2) * 1000) / 1000,
    locationPrecision: 'city',
    metadata: { subtype: 'tanker-level', zone: z.id, direction: z.direction, mean: z.last24.mean, centre: z.centre, score: z.score, geoBasis: 'zone centre (counting area)' },
  };
}

const minIso = (m: number) => new Date(m * 60_000).toISOString();

/** Records for ships going dark and coming back (v0.77.0). */
export function darkEvents(flags: DarkFlag[], nowIso: string): IntelligenceEvent[] {
  return flags.map((f) => {
    const s = f.ship;
    const who = `${TRAFFIC_LABEL[s.kind]} ${s.name ?? `MMSI ${s.mmsi}`}${s.imo ? ` (IMO ${s.imo})` : ''}${s.sanctioned ? ', on a sanctions list,' : ''}`;
    const dark = f.type === 'dark';
    const id = contentHash(TRAFFIC_SOURCE_ID, f.type, s.mmsi, String(dark ? s.at : s.flaggedAt));
    const la = dark ? s.la : f.la;
    const lo = dark ? s.lo : f.lo;
    return {
      id,
      contentHash: id,
      dataOrigin: 'live',
      sourceId: TRAFFIC_SOURCE_ID,
      sourceName: 'Fintraffic Digitraffic AIS — ships going dark',
      sourceClass: 'official',
      sourceUrl: s.imo ? `https://www.marinetraffic.com/en/ais/details/ships/imo:${s.imo}` : `https://www.marinetraffic.com/en/ais/details/ships/mmsi:${s.mmsi}`,
      title: truncate(
        dark
          ? `Ship went dark: ${who} stopped broadcasting AIS at sea while under way (${s.sog} kn)`
          : `Ship back on AIS: ${who} after ${Math.round((f.gapMin / 60) * 10) / 10} h dark, ${f.movedKm} km from where it went quiet`,
        LIMITS.title,
      ),
      summary: truncate(
        dark
          ? `Last heard at ${minIso(s.at)} at ${s.la.toFixed(3)}, ${s.lo.toFixed(3)}, ${s.sog} kn on ${s.cog ?? '?'}°, after at least ${DARK.minStreak} runs of steady contact; silent ${f.silentMin} min. ` +
            `Other ships are still heard within ${DARK.coverKm} km of its last position and of where it would be now (${f.projected[0]}, ${f.projected[1]}), so it is not simply out of range. ` +
            `Turning AIS off can hide transfers or port calls, but it is also allowed for security reasons and receivers fail: a lead to check, not proof. ${DIGITRAFFIC_CREDIT}.`
          : `Went quiet at ${minIso(s.at)} at ${s.la.toFixed(3)}, ${s.lo.toFixed(3)}; heard again at ${f.la.toFixed(3)}, ${f.lo.toFixed(3)}, ${f.movedKm} km away, after ${f.gapMin} min. ${DIGITRAFFIC_CREDIT}.`,
        LIMITS.summary,
      ),
      category: 'maritime',
      regionIds: ['eastern-europe'],
      countryCodes: [],
      publishedAt: dark ? minIso(s.at) : nowIso,
      occurredAt: dark ? minIso(s.at) : nowIso,
      collectedAt: nowIso,
      credibility: 'official',
      verificationStatus: 'unreviewed',
      latitude: la,
      longitude: lo,
      locationPrecision: 'exact',
      metadata: {
        subtype: dark ? 'ship-dark' : 'ship-reappeared',
        mmsi: s.mmsi,
        imo: s.imo,
        shipKind: s.kind,
        sanctioned: s.sanctioned,
        ...(dark ? { silentMin: f.silentMin } : { gapMin: f.gapMin, movedKm: f.movedKm }),
        geoBasis: 'source-coordinates (AIS position broadcast by the ship)',
      },
    };
  });
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
      const got = await gatherAis(takeAisWindow(listener, key), ctx);
      const heard = got.heard;
      if (!got.heard && !got.dt) {
        // Neither feed answered: keep the last map until three runs in a row fail.
        const failed = (ctx.state?.failedWindows ?? 0) + 1;
        const message = got.windowError ?? 'no AIS data';
        if (failed >= 3) throw new Error(`${message} (${failed} listens in a row failed)`);
        // Tolerated from the first run on (v0.75.1): the map keeps the last traffic, or shows none yet.
        const base: TrafficState = ctx.state ?? { known: {}, tracks: {}, last: {}, latest: null };
        return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: { ...base, failedWindows: failed }, note: `listen failed (${failed} of 3 tolerated in a row)` };
      }
      const state = updateTraffic(ctx.state, got.msgs, ctx.now, heard ? (heard.seconds ?? LISTEN_SECONDS) : 0);
      state.latest!.fintraffic = got.dt ? got.dt.positions : null;
      // v0.77.0: ships going dark, judged only on runs where the Finnish feed answered (it sees every ship).
      let events: IntelligenceEvent[] = [];
      state.fin = ctx.state?.fin ?? {};
      state.dark = ctx.state?.dark ?? {};
      if (got.dt) {
        const allNow = new Map<string, FixNow>();
        for (const m of got.dt.msgs) {
          if (m.MessageType !== 'PositionReport') continue;
          const at = Math.floor(Date.parse(parseAisTime(m.MetaData.time_utc) ?? new Date(ctx.now).toISOString()) / 60_000);
          const p = m.Message.PositionReport ?? {};
          allNow.set(String(m.MetaData.MMSI), { la: m.MetaData.latitude, lo: m.MetaData.longitude, sog: p.Sog ?? null, cog: p.Cog ?? null, nav: p.NavigationalStatus ?? null, at });
        }
        const wl = await loadSanctionsWatchlist(ctx);
        const identity = (mmsi: string) => {
          const k = state.known[mmsi];
          const kind = k ? kindOfType(k[0]) : null;
          return k && kind ? { kind, name: k[1], imo: k[2] } : null;
        };
        let ports: { la: number; lo: number }[] = [];
        try {
          ports = loadPorts();
        } catch {
          // without the port list no ship is excluded for being near a port
        }
        const d = detectDark({ fin: state.fin, dark: state.dark }, allNow, identity, (mmsi, imo) => !!wl && (wl.byMmsi.has(mmsi) || (!!imo && wl.byImo.has(imo))), ports, Math.floor(ctx.now / 60_000));
        state.fin = d.fin;
        state.dark = d.dark;
        events = darkEvents(d.flags, new Date(ctx.now).toISOString());

        // v0.78.0: tankers per zone this run (moving, and at anchor or stopped).
        const counts: Record<string, { t: number; m: number; a: number }> = {};
        for (const [mmsi, f] of allNow) {
          if (identity(mmsi)?.kind !== 'tanker') continue;
          const anchored = f.nav === 1 || f.nav === 5 || (f.sog !== null && f.sog < 0.5);
          for (const z of zoneAt(f.la, f.lo)) {
            const c = (counts[z.id] ??= { t: 0, m: 0, a: 0 });
            c.t++;
            if (anchored) c.a++;
            else c.m++;
          }
        }
        state.levels = addCounts(ctx.state?.levels ?? {}, counts, ctx.now);
      } else state.levels = ctx.state?.levels ?? {};
      const levels = zoneLevels(state.levels ?? {}, ctx.now);
      state.latest!.levels = levels;
      const today = new Date(ctx.now).toISOString().slice(0, 10);
      state.levelRecorded = { ...(ctx.state?.levelRecorded ?? {}) };
      for (const z of levels) {
        if (!z.direction || state.levelRecorded[z.id] === today) continue;
        events.push(levelEvent(z, new Date(ctx.now).toISOString()));
        state.levelRecorded[z.id] = today;
      }
      state.latest!.dark = Object.values(state.dark).map((s) => ({ mmsi: s.mmsi, name: s.name, kind: s.kind, la: s.la, lo: s.lo, lastAt: minIso(s.at), sanctioned: s.sanctioned }));
      return {
        events,
        rejected: [],
        itemsSeen: got.messages,
        notModified: false,
        state,
        note: `${state.latest!.ships.length} tankers and cargo ships on the map, ${state.latest!.typesKnown} types known · ${got.note}`,
      };
    },
  };
}

export const aisTraffic = makeAisTrafficAdapter();
