import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { SANCTIONS_LISTS, type SanctionedVessel, type SanctionsListId } from '../../shared/domain/sanctions.ts';
import { SHIP_AREAS, SIGHTING_KEEP_HOURS, shipAreaAt, type SanctionedShipSighting, type SanctionedShipsSnapshot } from '../../shared/domain/sanctionedShips.ts';
import { contentHash } from '../lib/hash.ts';
import { readSecret, redactSecrets } from '../lib/secrets.ts';
import { LIMITS, cleanText, truncate } from '../lib/text.ts';
import { stateVessels, type SanctionsState } from './sanctions.ts';
import type { AdapterContext, AdapterResult, SourceAdapter } from './types.ts';
import { cableFlagTitle, checkCables, CABLE_NEAR_KM, CABLE_REPEAT_MIN, CABLE_SLOW_KN, type CableFlag, type NearCableEntry } from '../../shared/domain/cableWatch.ts';
import { underseaName, UNDERSEA_LABEL, type UnderseaLine } from '../../shared/domain/undersea.ts';
import type { InfraSite } from '../../shared/domain/infrastructure.ts';
import { loadUndersea } from '../lib/undersea.ts';
import { loadInfrastructure } from '../lib/infrastructure.ts';

export const AIS_SOURCE_ID = 'ais-sanctioned-ships';
export const AIS_KEY_ENV = 'AISSTREAM_API_KEY';
/** Listening window. It runs while the other sources are collected, so it adds little or no run time. */
export const LISTEN_SECONDS = 25;
/** A connection not confirmed within this long is abandoned for a second one (v0.74.1). */
export const CONFIRM_SECONDS = 8;

/** The parts of an aisstream.io message WATCHTOWER reads. */
export interface AisMessage {
  MessageType: string;
  MetaData: { MMSI: number; ShipName?: string; latitude: number; longitude: number; time_utc?: string };
  Message: {
    PositionReport?: { Sog?: number; Cog?: number; Latitude?: number; Longitude?: number };
    ShipStaticData?: { ImoNumber?: number; Name?: string; Destination?: string; Type?: number };
  };
}

// ---------------------------------------------------------------- matching ---

interface Listed {
  vessels: SanctionedVessel[];
}
export interface Watchlist {
  byImo: Map<string, Listed>;
  byMmsi: Map<string, Listed>;
  size: number;
}

export function buildWatchlist(vessels: SanctionedVessel[]): Watchlist {
  const byImo = new Map<string, Listed>();
  const byMmsi = new Map<string, Listed>();
  for (const v of vessels) {
    if (v.imo && /^\d{7}$/.test(v.imo)) (byImo.get(v.imo) ?? byImo.set(v.imo, { vessels: [] }).get(v.imo)!).vessels.push(v);
    if (v.mmsi && /^\d{9}$/.test(v.mmsi)) (byMmsi.get(v.mmsi) ?? byMmsi.set(v.mmsi, { vessels: [] }).get(v.mmsi)!).vessels.push(v);
  }
  const keys = new Set([...byImo.keys(), ...[...byMmsi.values()].flatMap((l) => l.vessels.map((v) => v.imo ?? `mmsi:${v.mmsi}`))]);
  return { byImo, byMmsi, size: keys.size };
}

const imoOf = (n: unknown) => (typeof n === 'number' && n >= 1_000_000 && n <= 9_999_999 ? String(n) : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Matches one listening window against the watchlist.
 * - IMO from identity messages is the strong match; the MMSI is then remembered (`known`).
 * - An OFAC-listed MMSI matches a position report only if no identity message in the window
 *   shows a different IMO for it (MMSIs are reassigned after re-flagging).
 */
export function matchWindow(
  msgs: AisMessage[],
  wl: Watchlist,
  known: Record<string, string>,
  nowIso: string,
): { sightings: SanctionedShipSighting[]; known: Record<string, string>; ships: number } {
  const nextKnown = { ...known };
  const staticImo = new Map<string, string>();
  const aisName = new Map<string, string>();
  const destination = new Map<string, string>();
  for (const m of msgs) {
    const mmsi = String(m.MetaData?.MMSI ?? '');
    const s = m.Message?.ShipStaticData;
    // The name in the ship's own identity message wins over the stream's cached name.
    if (m.MessageType === 'ShipStaticData' && s?.Name?.trim()) aisName.set(mmsi, cleanText(s.Name));
    else if (m.MetaData?.ShipName?.trim() && !aisName.has(mmsi)) aisName.set(mmsi, cleanText(m.MetaData.ShipName));
    if (m.MessageType !== 'ShipStaticData' || !s) continue;
    const imo = imoOf(s.ImoNumber);
    if (s.Destination?.trim()) destination.set(mmsi, cleanText(s.Destination));
    if (!imo) continue;
    staticImo.set(mmsi, imo);
    if (wl.byImo.has(imo)) nextKnown[mmsi] = imo;
    else if (nextKnown[mmsi] && nextKnown[mmsi] !== imo) delete nextKnown[mmsi];
  }

  const latest = new Map<string, AisMessage>();
  for (const m of msgs) {
    if (m.MessageType !== 'PositionReport') continue;
    const mmsi = String(m.MetaData?.MMSI ?? '');
    const prev = latest.get(mmsi);
    if (!prev || (m.MetaData.time_utc ?? '') >= (prev.MetaData.time_utc ?? '')) latest.set(mmsi, m);
  }

  const sightings: SanctionedShipSighting[] = [];
  for (const [mmsi, m] of latest) {
    let matchedBy: 'imo' | 'mmsi' | null = null;
    let listed: Listed | undefined;
    const imo = nextKnown[mmsi] ?? null;
    if (imo) {
      matchedBy = 'imo';
      listed = wl.byImo.get(imo);
    } else if (wl.byMmsi.has(mmsi)) {
      const l = wl.byMmsi.get(mmsi)!;
      const seen = staticImo.get(mmsi);
      // An identity message showing another IMO means the MMSI now belongs to a different ship.
      if (!seen || l.vessels.some((v) => v.imo === seen)) {
        matchedBy = 'mmsi';
        // Include the other lists that name the same ship by IMO.
        const listedImo = l.vessels.find((v) => v.imo)?.imo;
        const sameShip = listedImo ? (wl.byImo.get(listedImo)?.vessels ?? []) : [];
        listed = { vessels: [...l.vessels, ...sameShip.filter((v) => !l.vessels.includes(v))] };
      }
    }
    if (!matchedBy || !listed) continue;
    const la = num(m.MetaData.latitude);
    const lo = num(m.MetaData.longitude);
    if (la === null || lo === null) continue;
    const area = shipAreaAt(la, lo);
    if (!area) continue;
    const p = m.Message.PositionReport ?? {};
    const sog = num(p.Sog);
    const cog = num(p.Cog);
    const lists = [...new Set(listed.vessels.map((v) => v.list))] as SanctionsListId[];
    sightings.push({
      mmsi,
      imo: imo ?? listed.vessels.find((v) => v.imo)?.imo ?? null,
      listedName: listed.vessels[0].name,
      aisName: aisName.get(mmsi) ?? null,
      lists,
      programs: [...new Set(listed.vessels.flatMap((v) => v.programs))].slice(0, 4),
      matchedBy,
      la: Math.round(la * 10_000) / 10_000,
      lo: Math.round(lo * 10_000) / 10_000,
      sog: sog !== null && sog < 102.3 ? Math.round(sog * 10) / 10 : null,
      cog: cog !== null && cog < 360 ? Math.round(cog) : null,
      destination: destination.get(mmsi) ?? null,
      area: area.id,
      seenAt: parseAisTime(m.MetaData.time_utc) ?? nowIso,
    });
  }
  return { sightings, known: nextKnown, ships: new Set(msgs.map((m) => m.MetaData?.MMSI)).size };
}

/** "2026-11-21 09:04:07.126103054 +0000 UTC" → ISO. */
export function parseAisTime(t: string | undefined): string | null {
  const m = t && /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/.exec(t);
  return m ? `${m[1]}T${m[2]}.000Z` : null;
}

export function sightingEvents(sightings: SanctionedShipSighting[], nowIso: string): IntelligenceEvent[] {
  return sightings.map((s) => {
    const area = SHIP_AREAS.find((a) => a.id === s.area)!;
    const lists = s.lists.map((l) => SANCTIONS_LISTS[l].short).join('/');
    const day = s.seenAt.slice(0, 10);
    const key = s.imo ?? `mmsi:${s.mmsi}`;
    const id = contentHash(AIS_SOURCE_ID, key, s.area, day);
    const motion = s.sog === null ? '' : s.sog < 0.5 ? ', stopped' : `, ${s.sog} kn`;
    return {
      id,
      contentHash: id,
      dataOrigin: 'live' as const,
      sourceId: AIS_SOURCE_ID,
      sourceName: 'aisstream.io — Sanctioned vessels (AIS)',
      sourceClass: 'aggregator' as const,
      sourceUrl: s.imo ? `https://www.marinetraffic.com/en/ais/details/ships/imo:${s.imo}` : `https://www.marinetraffic.com/en/ais/details/ships/mmsi:${s.mmsi}`,
      title: truncate(`Sanctioned vessel seen: ${s.listedName}${s.imo ? ` (IMO ${s.imo})` : ''} — ${area.name}${motion} · ${lists}`, LIMITS.title),
      summary: truncate(
        `AIS position at ${s.seenAt.slice(11, 16)} UTC, ${s.la.toFixed(3)}, ${s.lo.toFixed(3)}${s.destination ? `, destination "${s.destination}"` : ''}. ` +
          `Listed by ${lists}${s.programs.length ? ` (${s.programs.join('; ')})` : ''}. ` +
          `Matched by ${s.matchedBy === 'imo' ? 'IMO number from the ship’s own identity message' : 'MMSI only (an MMSI can be reassigned after re-flagging)'}` +
          `${s.aisName && s.aisName.toUpperCase() !== s.listedName.toUpperCase() ? `; broadcasting as "${s.aisName}"` : ''}. ` +
          'A sanctioned ship at sea is not by itself a violation; it shows where listed ships operate.',
        LIMITS.summary,
      ),
      category: 'maritime' as const,
      regionIds: area.regionId ? [area.regionId] : [],
      countryCodes: [],
      publishedAt: s.seenAt,
      occurredAt: s.seenAt,
      collectedAt: nowIso,
      credibility: 'single-source' as const,
      verificationStatus: 'unreviewed' as const,
      latitude: s.la,
      longitude: s.lo,
      locationPrecision: 'exact' as const,
      metadata: {
        subtype: 'sanctioned-vessel-sighting',
        mmsi: s.mmsi,
        imo: s.imo,
        lists: s.lists,
        matchedBy: s.matchedBy,
        area: s.area,
        geoBasis: 'source-coordinates (AIS position broadcast by the ship)',
      },
    };
  });
}

// ---------------------------------------------------------------- listening ---

export interface ListenResult {
  msgs: AisMessage[];
  messages: number;
  /** Seconds actually listened (less than asked when the stream dropped). */
  seconds?: number;
  /** Set when the window was cut short or needed a second connection. */
  note?: string;
}
export type Listener = (key: string, seconds: number) => Promise<ListenResult>;

/**
 * Opens aisstream.io for `seconds` and keeps identity messages and position reports in the ship areas.
 * v0.73.0: the stream often drops part-way (about half of the runs on 2026-11-23 failed with "connection
 * failed" after 9–16 s). A drop after the subscription was confirmed keeps what was heard so far.
 */
export const listenAisStream: Listener = (key, seconds) =>
  new Promise((resolve, reject) => {
    const msgs: AisMessage[] = [];
    let messages = 0;
    let confirmed = false;
    let settled = false;
    const started = Date.now();
    const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');
    ws.binaryType = 'arraybuffer';
    const finish = (err: Error | null, note?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(confirmTimer);
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      const listened = Math.round((Date.now() - started) / 1000);
      if (confirmed && (!err || messages > 0)) resolve({ msgs, messages, seconds: Math.min(listened, seconds), note: err ? `stream dropped after ${listened} s (${note ?? err.message}); kept what was heard` : undefined });
      else reject(err ?? new Error('aisstream.io did not confirm the subscription'));
    };
    const timer = setTimeout(() => finish(null), seconds * 1000);
    // v0.74.1: some connections are never confirmed and stay silent; give up early so a second one gets the time left.
    const confirmTimer = setTimeout(() => {
      if (!confirmed) finish(new Error(`aisstream.io did not confirm the subscription within ${CONFIRM_SECONDS} s`));
    }, Math.min(CONFIRM_SECONDS, seconds) * 1000);
    ws.onopen = () =>
      ws.send(JSON.stringify({ APIKey: key, BoundingBoxes: SHIP_AREAS.map((a) => a.box), FilterMessageTypes: ['PositionReport', 'ShipStaticData'] }));
    ws.onmessage = (ev) => {
      const text = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer);
      let m: AisMessage & { error?: string };
      try {
        m = JSON.parse(text);
      } catch {
        return;
      }
      if (m.MessageType === 'SubscriptionConfirmation') {
        confirmed = true;
        return;
      }
      if (m.error) {
        // An error message from aisstream (e.g. a bad key) is never treated as a partial window.
        confirmed = false;
        finish(new Error(`aisstream.io: ${redactSecrets(String(m.error)).slice(0, 120)}`));
        return;
      }
      // Messages arriving means the subscription is live even if the confirmation was missed.
      confirmed = true;
      messages++;
      if (m.MetaData && (m.MessageType === 'PositionReport' || m.MessageType === 'ShipStaticData')) msgs.push({ MessageType: m.MessageType, MetaData: m.MetaData, Message: m.Message });
    };
    ws.onerror = (ev) => {
      const detail = (ev as Event & { message?: string }).message;
      finish(new Error(`aisstream.io connection failed${detail ? `: ${redactSecrets(String(detail)).slice(0, 100)}` : ''}`), 'connection error');
    };
    ws.onclose = (ev) => finish(new Error(`aisstream.io closed the connection (code ${(ev as CloseEvent).code ?? '?'})`), `closed, code ${(ev as CloseEvent).code ?? '?'}`);
  });

/** One listening window; if the first connection fails early, a second one gets the time that is left. */
export async function listenWithRetry(listener: Listener, key: string, seconds: number, clock: () => number = Date.now): Promise<ListenResult> {
  const started = clock();
  try {
    return await listener(key, seconds);
  } catch (first) {
    const left = seconds - Math.round((clock() - started) / 1000);
    if (left < 8 || /aisstream\.io: /.test(String((first as Error).message))) throw first;
    const r = await listener(key, left);
    return { ...r, note: `second connection after: ${(first as Error).message.slice(0, 80)}${r.note ? `; ${r.note}` : ''}` };
  }
}

/** Sources that read the one listening window per run (sanctioned ships, tanker and cargo traffic). */
export const AIS_CONSUMERS = 2;
let pending: { window: Promise<ListenResult>; left: number } | null = null;

/**
 * Starts listening at the beginning of a collection run, so the window overlaps the other
 * sources instead of adding to the run time. The AIS sources then share it.
 */
export function primeAisListening(listener: Listener = listenAisStream): void {
  const key = readSecret(AIS_KEY_ENV);
  if (!key || pending) return;
  const window = listenWithRetry(listener, key, LISTEN_SECONDS);
  window.catch(() => {}); // surfaced when an adapter awaits it
  pending = { window, left: AIS_CONSUMERS };
}

/** The primed window (shared by the AIS sources in a run), or a new listen when none was primed. */
export function takeAisWindow(listener: Listener, key: string): Promise<ListenResult> {
  if (pending) {
    const w = pending.window;
    if (--pending.left <= 0) pending = null;
    return w;
  }
  return listenWithRetry(listener, key, LISTEN_SECONDS);
}

// ---------------------------------------------------------------- adapter ---

export interface AisSanctionedState {
  /** MMSI → IMO for ships matched by IMO (remembered so later position-only windows match). */
  known: Record<string, string>;
  /** Latest sighting per vessel, last 48 hours. */
  sightings: SanctionedShipSighting[];
  latest: SanctionedShipsSnapshot | null;
  /** v0.73.0: listening windows that failed in a row (the source fails at MAX_FAILED_WINDOWS). */
  failedWindows?: number;
  /** v0.73.0: sanctioned ships seen near undersea lines in the last hours (ship key → entries). */
  cableLog?: Record<string, NearCableEntry[]>;
}

/** A failed listen is tolerated twice in a row (the map shows how old the last window is); the third fails the source. */
export const MAX_FAILED_WINDOWS = 3;

const SANCTIONS_SOURCES = ['ofac-sdn', 'uk-sanctions', 'eu-sanctions'];

export function makeAisSanctionedAdapter(listener: Listener = listenAisStream): SourceAdapter<AisSanctionedState> {
  return {
    sourceId: AIS_SOURCE_ID,
    requiredEnv: [AIS_KEY_ENV],
    async collect(ctx: AdapterContext<AisSanctionedState>): Promise<AdapterResult<AisSanctionedState>> {
      const key = readSecret(AIS_KEY_ENV);
      if (!key) throw new Error(`${AIS_KEY_ENV} is not set`);
      const window = takeAisWindow(listener, key);
      const vessels: SanctionedVessel[] = [];
      for (const id of SANCTIONS_SOURCES) {
        const st = await ctx.peerState?.<SanctionsState>(id);
        if (st) vessels.push(...stateVessels(st));
      }
      let heard: ListenResult;
      try {
        heard = await window;
      } catch (err) {
        const failed = (ctx.state?.failedWindows ?? 0) + 1;
        const message = err instanceof Error ? err.message : String(err);
        if (!ctx.state || failed >= MAX_FAILED_WINDOWS) throw new Error(`${message}${failed > 1 ? ` (${failed} listens in a row failed)` : ''}`);
        // Tolerated: nothing new this run; the sightings and the last window's time stay as they were.
        return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: { ...ctx.state, failedWindows: failed }, note: `listen failed (${failed} of ${MAX_FAILED_WINDOWS} tolerated in a row): ${message}` };
      }
      const { msgs, messages } = heard;
      const nowIso = new Date(ctx.now).toISOString();
      if (!vessels.length) throw new Error('no sanctioned-vessel list available yet (sanctions sources not collected)');
      const wl = buildWatchlist(vessels);
      const r = matchWindow(msgs, wl, ctx.state?.known ?? {}, nowIso);
      const cutoff = new Date(ctx.now - SIGHTING_KEEP_HOURS * 3_600_000).toISOString();
      const byKey = new Map<string, SanctionedShipSighting>();
      for (const s of [...(ctx.state?.sightings ?? []), ...r.sightings]) if (s.seenAt >= cutoff) byKey.set(s.imo ?? `mmsi:${s.mmsi}`, s);
      const sightings = [...byKey.values()].sort((a, b) => b.seenAt.localeCompare(a.seenAt));
      // v0.73.0: sanctioned ships lingering near undersea cables and pipelines.
      let lines: UnderseaLine[] = [];
      let ports: InfraSite[] = [];
      try {
        lines = loadUndersea();
        ports = loadInfrastructure().filter((x) => x.t === 'port');
      } catch {
        // The data files ship with the app; without them the check is skipped.
      }
      const cables = checkCables(r.sightings, lines, ports, ctx.state?.cableLog ?? {}, ctx.now);
      return {
        events: [...sightingEvents(r.sightings, nowIso), ...cableEvents(cables.flags, nowIso)],
        rejected: [],
        itemsSeen: messages,
        notModified: false,
        state: {
          known: r.known,
          sightings,
          latest: { listenedAt: nowIso, listenSeconds: heard.seconds ?? LISTEN_SECONDS, messages, ships: r.ships, watchlistSize: wl.size, sightings },
          failedWindows: 0,
          cableLog: cables.log,
        },
        note: heard.note,
      };
    },
  };
}

export const aisSanctionedShips = makeAisSanctionedAdapter();

/** One record per ship, line and day (v0.73.0). */
export function cableEvents(flags: CableFlag[], nowIso: string): IntelligenceEvent[] {
  const out = new Map<string, IntelligenceEvent>();
  for (const f of flags) {
    const s = f.sighting;
    const key = s.imo ?? `mmsi:${s.mmsi}`;
    const id = contentHash(AIS_SOURCE_ID, 'cable', key, f.line.id, s.seenAt.slice(0, 10));
    if (out.has(id)) continue;
    const area = SHIP_AREAS.find((a) => a.id === s.area)!;
    const lists = s.lists.map((l) => SANCTIONS_LISTS[l].short).join('/');
    out.set(id, {
      id,
      contentHash: id,
      dataOrigin: 'live',
      sourceId: AIS_SOURCE_ID,
      sourceName: 'aisstream.io — Sanctioned vessels near undersea cables (AIS)',
      sourceClass: 'aggregator',
      sourceUrl: s.imo ? `https://www.marinetraffic.com/en/ais/details/ships/imo:${s.imo}` : `https://www.marinetraffic.com/en/ais/details/ships/mmsi:${s.mmsi}`,
      title: truncate(`${cableFlagTitle(f)} — ${area.name} · ${lists}`, LIMITS.title),
      summary: truncate(
        `AIS position at ${s.seenAt.slice(11, 16)} UTC, ${s.la.toFixed(3)}, ${s.lo.toFixed(3)}: ${f.km} km from ${underseaName(f.line)} (${UNDERSEA_LABEL[f.line.k].toLowerCase()}${f.line.op ? `, ${f.line.op}` : ''}, as mapped on OpenStreetMap). ` +
          (f.reason === 'slow'
            ? `Moving at ${s.sog} kn (under ${CABLE_SLOW_KN} kn) within ${CABLE_NEAR_KM} km of the line. `
            : `Also seen within ${CABLE_NEAR_KM} km of it at ${f.firstAt?.slice(11, 16)} UTC, ${CABLE_REPEAT_MIN}+ minutes earlier. `) +
          'Slow ships over cables were behind the 2023–2024 Baltic cable and pipeline damage, but most such passes are innocent (waiting, drifting, slow steaming). AIS is sampled briefly each run, and routes are approximate.',
        LIMITS.summary,
      ),
      category: 'maritime',
      regionIds: area.regionId ? [area.regionId] : [],
      countryCodes: [],
      publishedAt: s.seenAt,
      occurredAt: s.seenAt,
      collectedAt: nowIso,
      credibility: 'single-source',
      verificationStatus: 'unreviewed',
      latitude: s.la,
      longitude: s.lo,
      locationPrecision: 'exact',
      metadata: { subtype: 'cable-proximity', mmsi: s.mmsi, imo: s.imo, lineId: f.line.id, lineKind: f.line.k, km: f.km, reason: f.reason, sog: s.sog, geoBasis: 'source-coordinates (AIS position broadcast by the ship)' },
    });
  }
  return [...out.values()];
}
