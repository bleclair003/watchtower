import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { WATCH_REGIONS } from '../../shared/domain/regions.ts';
import {
  AIRCRAFT_CLASS_LABEL,
  AIRCRAFT_PROVIDERS,
  NOTABLE_AIRCRAFT_CLASSES,
  aircraftClassOf,
  aircraftLabel,
  aircraftTypeName,
  type AircraftPosition,
  type AircraftProvider,
  type AircraftSnapshot,
} from '../../shared/domain/aircraft.ts';
import { regionsForSeaOrWatchCountry } from '../geo/countries.ts';
import { contentHash } from '../lib/hash.ts';
import { LIMITS, truncate } from '../lib/text.ts';
import type { AdapterContext, AdapterResult, SourceAdapter } from './types.ts';

export const AIRCRAFT_SOURCE_ID = 'adsb-military';

/** Endpoints in order of preference. Both return the ADSBExchange v2 JSON layout ({ ac: [...] }). */
export const AIRCRAFT_ENDPOINTS: { provider: AircraftProvider['id']; url: string }[] = [
  { provider: 'adsb.lol', url: 'https://api.adsb.lol/v2/mil' },
  { provider: 'adsb.fi', url: 'https://opendata.adsb.fi/api/v2/mil' },
];

/** A position older than this at fetch time is dropped. */
export const MAX_POSITION_AGE_S = 120;
/** Airlift over the US is routine (hundreds of sorties a week), so it is not recorded for the US. */
const SKIP_CLASSES_BY_REGION: Record<string, string[]> = { 'united-states': ['airlift'] };

export interface MilitaryAircraftState {
  latest: AircraftSnapshot;
  firstRunAt: string;
}

interface RawAircraft {
  hex?: string;
  flight?: string;
  r?: string;
  t?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | 'ground';
  gs?: number;
  track?: number;
  seen_pos?: number;
  emergency?: string;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Parses the provider response into usable airborne positions. Unknown layouts fail loudly. */
export function parseMilitaryAircraft(body: string): { totalMarked: number; aircraft: AircraftPosition[]; dropped: number } {
  const data = JSON.parse(body) as { ac?: RawAircraft[] };
  if (!data || !Array.isArray(data.ac)) throw new Error('military aircraft: response has no "ac" array');
  const aircraft: AircraftPosition[] = [];
  let dropped = 0;
  for (const a of data.ac) {
    const la = num(a.lat);
    const lo = num(a.lon);
    const hex = typeof a.hex === 'string' ? a.hex.trim().toLowerCase() : '';
    const cs = a.flight?.trim() || null;
    const age = num(a.seen_pos);
    const usable =
      /^~?[0-9a-f]{6}$/.test(hex) &&
      la !== null && lo !== null && Math.abs(la) <= 90 && Math.abs(lo) <= 180 &&
      age !== null && age <= MAX_POSITION_AGE_S &&
      a.alt_baro !== 'ground' &&
      a.t !== 'TWR' && // ground stations and test transmitters
      !(cs && /^TEST/i.test(cs));
    if (!usable) {
      dropped++;
      continue;
    }
    const em = a.emergency && a.emergency !== 'none' ? a.emergency : null;
    aircraft.push({
      hex,
      cs,
      reg: a.r?.trim() || null,
      t: a.t?.trim() || null,
      cls: aircraftClassOf(a.t?.trim()),
      la: Math.round(la * 10_000) / 10_000,
      lo: Math.round(lo * 10_000) / 10_000,
      alt: num(a.alt_baro),
      gs: num(a.gs) === null ? null : Math.round(a.gs!),
      trk: num(a.track) === null ? null : Math.round(a.track!),
      age: Math.round(age),
      em,
    });
  }
  return { totalMarked: data.ac.length, aircraft, dropped };
}

/**
 * Records for notable aircraft (tankers, surveillance/command, bombers, heavy and tactical
 * airlift) inside the watch areas: one per aircraft, watch area and UTC day, at the first
 * position seen that day.
 */
export function aircraftEvents(snapshot: AircraftSnapshot, nowMs: number): IntelligenceEvent[] {
  const provider = AIRCRAFT_PROVIDERS[snapshot.provider];
  const nowIso = new Date(nowMs).toISOString();
  const date = nowIso.slice(0, 10);
  const events: IntelligenceEvent[] = [];
  for (const a of snapshot.aircraft) {
    if (!NOTABLE_AIRCRAFT_CLASSES.includes(a.cls)) continue;
    const where = regionsForSeaOrWatchCountry(a.la, a.lo);
    const regionIds = where.regionIds.filter((r) => !(SKIP_CLASSES_BY_REGION[r] ?? []).includes(a.cls));
    if (!regionIds.length) continue;
    const country = where.country;
    const seenAt = new Date(Date.parse(snapshot.fetchedAt) - a.age * 1000).toISOString();
    const typeName = aircraftTypeName(a.t) ?? a.t ?? 'unknown type';
    const label = aircraftLabel(a);
    const facts = [
      a.alt !== null ? `${a.alt.toLocaleString('en-US')} ft` : null,
      a.gs !== null ? `${a.gs} kt` : null,
      a.trk !== null ? `track ${a.trk}°` : null,
    ].filter(Boolean).join(', ');
    for (const regionId of regionIds) {
      const region = WATCH_REGIONS.find((r) => r.id === regionId)!;
      const id = contentHash(AIRCRAFT_SOURCE_ID, a.hex, regionId, date);
      events.push({
        id,
        contentHash: id,
        dataOrigin: 'live',
        sourceId: AIRCRAFT_SOURCE_ID,
        sourceName: `${provider.name} — Military aircraft (ADS-B)`,
        sourceClass: 'aggregator',
        sourceUrl: provider.aircraftUrl(a.hex),
        title: truncate(`Military ${AIRCRAFT_CLASS_LABEL[a.cls].toLowerCase()} aircraft seen: ${typeName} ${label} — ${region.shortCode} watch area`, LIMITS.title),
        summary: truncate(
          `${typeName}${a.reg ? ` (${a.reg})` : ''}, callsign ${a.cs ?? 'not broadcast'}, seen at ${seenAt.slice(11, 16)} UTC at ${a.la.toFixed(2)}, ${a.lo.toFixed(2)}${facts ? ` (${facts})` : ''}` +
            `${country ? `, over ${country}` : ''}. ` +
            `First sighting in the ${region.name} watch area today. From the ${provider.name} military feed: volunteer ADS-B receivers, aircraft flagged military by the network's community database. ` +
            'Only aircraft that broadcast are seen; one sighting is usually routine.',
          LIMITS.summary,
        ),
        category: 'military',
        regionIds: [regionId],
        countryCodes: country ? [country] : [],
        publishedAt: seenAt,
        occurredAt: seenAt,
        collectedAt: nowIso,
        credibility: 'single-source',
        verificationStatus: 'unreviewed',
        latitude: a.la,
        longitude: a.lo,
        locationPrecision: 'exact',
        metadata: {
          subtype: 'military-aircraft-sighting',
          aircraftClass: a.cls,
          aircraftType: a.t,
          hex: a.hex,
          callsign: a.cs,
          registration: a.reg,
          provider: provider.id,
          licence: provider.licence,
          geoBasis: 'source-coordinates (ADS-B position broadcast by the aircraft)',
          regionBasis: where.basis === 'open-water' ? 'open water inside the watch-area box' : 'over a watch-region country (Natural Earth borders)',
        },
      });
    }
  }
  return events;
}

/**
 * Military aircraft on ADS-B. Each run stores the latest positions (shown on the map) and
 * records notable aircraft inside the watch areas. Tries adsb.lol, then adsb.fi.
 */
export const militaryAircraft: SourceAdapter<MilitaryAircraftState> = {
  sourceId: AIRCRAFT_SOURCE_ID,
  async collect(ctx: AdapterContext<MilitaryAircraftState>): Promise<AdapterResult<MilitaryAircraftState>> {
    const errors: string[] = [];
    for (const ep of AIRCRAFT_ENDPOINTS) {
      try {
        const res = await ctx.fetch(ep.url);
        if (res.kind !== 'ok') throw new Error('unexpected 304');
        const parsed = parseMilitaryAircraft(res.body);
        const fetchedAt = new Date(ctx.now).toISOString();
        const latest: AircraftSnapshot = { fetchedAt, provider: ep.provider, totalMarked: parsed.totalMarked, aircraft: parsed.aircraft };
        return {
          events: aircraftEvents(latest, ctx.now),
          rejected: [],
          itemsSeen: parsed.totalMarked,
          notModified: false,
          state: { latest, firstRunAt: ctx.state?.firstRunAt ?? fetchedAt },
        };
      } catch (err) {
        errors.push(`${ep.provider}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    throw new Error(`all military aircraft providers failed (${errors.join('; ')})`);
  },
};
