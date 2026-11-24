import type { AisMessage } from '../adapters/aisSanctioned.ts';
import type { AdapterContext } from '../adapters/types.ts';

/**
 * Fintraffic Digitraffic marine AIS (v0.76.0): Finland's official, keyless feed of every vessel its
 * coastal receivers hear (Gulf of Finland, Gulf of Bothnia, northern Baltic), and its vessel database
 * (type, name, IMO, destination). Licence: CC BY 4.0, "Source: Fintraffic / digitraffic.fi".
 *
 * Converted into the aisstream.io message shape so the sanctioned-ship check, the cable watch and the
 * tanker and cargo layer read both feeds the same way. Positions older than POSITION_MAX_AGE_MIN are
 * left out (the feed keeps a ship's last position for about a day after it was last heard).
 */
export const DIGITRAFFIC_LOCATIONS = 'https://meri.digitraffic.fi/api/ais/v1/locations';
export const DIGITRAFFIC_VESSELS = 'https://meri.digitraffic.fi/api/ais/v1/vessels';
export const DIGITRAFFIC_HEADERS = { 'Digitraffic-User': 'WATCHTOWER-OSINT/personal-research' };
export const DIGITRAFFIC_CREDIT = 'Source: Fintraffic / digitraffic.fi, license CC 4.0 BY';
export const POSITION_MAX_AGE_MIN = 60;

export interface DigitrafficResult {
  msgs: AisMessage[];
  positions: number;
  vessels: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** Epoch ms → aisstream's "YYYY-MM-DD HH:MM:SS.000000000 +0000 UTC". */
export function aisTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.000000000 +0000 UTC`;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** Parses the two responses into AIS messages: one identity message per vessel, one position per recent fix. */
export function parseDigitraffic(locationsBody: string, vesselsBody: string, now: number): DigitrafficResult {
  const loc = JSON.parse(locationsBody) as { features?: { mmsi?: unknown; geometry?: { coordinates?: unknown[] }; properties?: Record<string, unknown> }[] };
  const ves = JSON.parse(vesselsBody) as Record<string, unknown>[];
  if (!Array.isArray(loc.features) || !Array.isArray(ves)) throw new Error('Digitraffic: unexpected response layout');
  const msgs: AisMessage[] = [];
  const located = new Set<number>();
  let positions = 0;
  for (const f of loc.features) {
    const mmsi = num(f.mmsi ?? f.properties?.mmsi);
    const [lon, lat] = (f.geometry?.coordinates ?? []).map(num);
    const at = num(f.properties?.timestampExternal);
    if (mmsi === null || lat === null || lon === null || at === null || lat === undefined || lon === undefined) continue;
    if (now - at > POSITION_MAX_AGE_MIN * 60_000 || at - now > 5 * 60_000) continue;
    const sog = num(f.properties?.sog);
    const cog = num(f.properties?.cog);
    msgs.push({
      MessageType: 'PositionReport',
      MetaData: { MMSI: mmsi, latitude: lat, longitude: lon, time_utc: aisTime(at) },
      Message: { PositionReport: { Sog: sog ?? undefined, Cog: cog ?? undefined } },
    });
    located.add(mmsi);
    positions++;
  }
  let vessels = 0;
  for (const v of ves) {
    const mmsi = num(v.mmsi);
    if (mmsi === null || !located.has(mmsi)) continue;
    const imo = num(v.imo);
    msgs.push({
      MessageType: 'ShipStaticData',
      MetaData: { MMSI: mmsi, ShipName: text(v.name), latitude: 0, longitude: 0 },
      Message: { ShipStaticData: { ImoNumber: imo && imo > 0 ? imo : undefined, Name: text(v.name), Destination: text(v.destination), Type: num(v.shipType) ?? undefined } },
    });
    vessels++;
  }
  return { msgs, positions, vessels };
}

let cache: { at: number; result: Promise<DigitrafficResult> } | null = null;

/** Both requests, once per run: the AIS sources share the result for two minutes. */
export function fetchDigitraffic(ctx: Pick<AdapterContext<unknown>, 'fetch' | 'now'>): Promise<DigitrafficResult> {
  if (cache && Math.abs(ctx.now - cache.at) < 120_000) return cache.result;
  const result = (async () => {
    const [l, v] = await Promise.all([ctx.fetch(DIGITRAFFIC_LOCATIONS, undefined, DIGITRAFFIC_HEADERS), ctx.fetch(DIGITRAFFIC_VESSELS, undefined, DIGITRAFFIC_HEADERS)]);
    if (l.kind !== 'ok' || v.kind !== 'ok') throw new Error('Digitraffic: no content');
    return parseDigitraffic(l.body, v.body, ctx.now);
  })();
  cache = { at: ctx.now, result };
  result.catch(() => {
    if (cache?.result === result) cache = null;
  });
  return result;
}

/** For tests. */
export const resetDigitrafficCache = () => {
  cache = null;
};
