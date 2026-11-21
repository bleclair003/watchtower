import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { SANCTIONS_LISTS, type SanctionedVessel, type SanctionsListId } from '../../shared/domain/sanctions.ts';
import { SHIP_AREAS, SIGHTING_KEEP_HOURS, shipAreaAt, type SanctionedShipSighting, type SanctionedShipsSnapshot } from '../../shared/domain/sanctionedShips.ts';
import { contentHash } from '../lib/hash.ts';
import { readSecret, redactSecrets } from '../lib/secrets.ts';
import { LIMITS, cleanText, truncate } from '../lib/text.ts';
import { stateVessels, type SanctionsState } from './sanctions.ts';
import type { AdapterContext, AdapterResult, SourceAdapter } from './types.ts';

export const AIS_SOURCE_ID = 'ais-sanctioned-ships';
export const AIS_KEY_ENV = 'AISSTREAM_API_KEY';
/** Listening window. It runs while the other sources are collected, so it adds little or no run time. */
export const LISTEN_SECONDS = 25;

/** The parts of an aisstream.io message WATCHTOWER reads. */
export interface AisMessage {
  MessageType: string;
  MetaData: { MMSI: number; ShipName?: string; latitude: number; longitude: number; time_utc?: string };
  Message: {
    PositionReport?: { Sog?: number; Cog?: number; Latitude?: number; Longitude?: number };
    ShipStaticData?: { ImoNumber?: number; Name?: string; Destination?: string };
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

export type Listener = (key: string, seconds: number) => Promise<{ msgs: AisMessage[]; messages: number }>;

/** Opens aisstream.io for `seconds` and keeps identity messages and position reports in the ship areas. */
export const listenAisStream: Listener = (key, seconds) =>
  new Promise((resolve, reject) => {
    const msgs: AisMessage[] = [];
    let messages = 0;
    let confirmed = false;
    const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');
    ws.binaryType = 'arraybuffer';
    const done = () => {
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      if (!confirmed) reject(new Error('aisstream.io did not confirm the subscription'));
      else resolve({ msgs, messages });
    };
    const timer = setTimeout(done, seconds * 1000);
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
        clearTimeout(timer);
        reject(new Error(`aisstream.io: ${redactSecrets(String(m.error)).slice(0, 120)}`));
        ws.close();
        return;
      }
      messages++;
      if (m.MetaData && (m.MessageType === 'PositionReport' || m.MessageType === 'ShipStaticData')) msgs.push({ MessageType: m.MessageType, MetaData: m.MetaData, Message: m.Message });
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error('aisstream.io connection failed'));
    };
  });

let pending: Promise<{ msgs: AisMessage[]; messages: number }> | null = null;

/**
 * Starts listening at the beginning of a collection run, so the window overlaps the other
 * sources instead of adding to the run time. The adapter then awaits it.
 */
export function primeAisListening(listener: Listener = listenAisStream): void {
  const key = readSecret(AIS_KEY_ENV);
  if (!key || pending) return;
  pending = listener(key, LISTEN_SECONDS);
  pending.catch(() => {}); // surfaced when the adapter awaits it
}

// ---------------------------------------------------------------- adapter ---

export interface AisSanctionedState {
  /** MMSI → IMO for ships matched by IMO (remembered so later position-only windows match). */
  known: Record<string, string>;
  /** Latest sighting per vessel, last 48 hours. */
  sightings: SanctionedShipSighting[];
  latest: SanctionedShipsSnapshot | null;
}

const SANCTIONS_SOURCES = ['ofac-sdn', 'uk-sanctions', 'eu-sanctions'];

export function makeAisSanctionedAdapter(listener: Listener = listenAisStream): SourceAdapter<AisSanctionedState> {
  return {
    sourceId: AIS_SOURCE_ID,
    requiredEnv: [AIS_KEY_ENV],
    async collect(ctx: AdapterContext<AisSanctionedState>): Promise<AdapterResult<AisSanctionedState>> {
      const key = readSecret(AIS_KEY_ENV);
      if (!key) throw new Error(`${AIS_KEY_ENV} is not set`);
      const window = pending ?? listener(key, LISTEN_SECONDS);
      pending = null;
      const vessels: SanctionedVessel[] = [];
      for (const id of SANCTIONS_SOURCES) {
        const st = await ctx.peerState?.<SanctionsState>(id);
        if (st) vessels.push(...stateVessels(st));
      }
      const { msgs, messages } = await window;
      const nowIso = new Date(ctx.now).toISOString();
      if (!vessels.length) throw new Error('no sanctioned-vessel list available yet (sanctions sources not collected)');
      const wl = buildWatchlist(vessels);
      const r = matchWindow(msgs, wl, ctx.state?.known ?? {}, nowIso);
      const cutoff = new Date(ctx.now - SIGHTING_KEEP_HOURS * 3_600_000).toISOString();
      const byKey = new Map<string, SanctionedShipSighting>();
      for (const s of [...(ctx.state?.sightings ?? []), ...r.sightings]) if (s.seenAt >= cutoff) byKey.set(s.imo ?? `mmsi:${s.mmsi}`, s);
      const sightings = [...byKey.values()].sort((a, b) => b.seenAt.localeCompare(a.seenAt));
      return {
        events: sightingEvents(r.sightings, nowIso),
        rejected: [],
        itemsSeen: messages,
        notModified: false,
        state: {
          known: r.known,
          sightings,
          latest: { listenedAt: nowIso, listenSeconds: LISTEN_SECONDS, messages, ships: r.ships, watchlistSize: wl.size, sightings },
        },
      };
    },
  };
}

export const aisSanctionedShips = makeAisSanctionedAdapter();
