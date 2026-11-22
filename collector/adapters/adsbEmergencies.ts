import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { getRegion } from '../../shared/domain/regions.ts';
import { SQUAWKS, SQUAWK_LABEL, emergencyLabel, isNotableEmergency, parseEmergencies, type EmergencyAircraft, type EmergencySnapshot } from '../../shared/domain/aircraftEmergencies.ts';
import { contentHash } from '../lib/hash.ts';
import { LIMITS, truncate } from '../lib/text.ts';
import type { AdapterContext, AdapterResult, SourceAdapter } from './types.ts';

/**
 * Aircraft emergencies (Phase 25): three small squawk queries per run on adsb.lol (ODbL). Each aircraft
 * and code is recorded once per 12 hours; the current list feeds the map.
 */
export const EMERGENCY_SOURCE_ID = 'adsb-emergencies';
const API = 'https://api.adsb.lol/v2/sqk/';
const REPEAT_MS = 12 * 3_600_000;

export interface EmergencyState {
  latest: EmergencySnapshot;
  /** "hex|squawk" → last recorded (ms). */
  reported: Record<string, number>;
}

export function emergencyRecord(a: EmergencyAircraft, nowIso: string): IntelligenceEvent {
  const id = contentHash(EMERGENCY_SOURCE_ID, a.hex, a.sq, nowIso.slice(0, 13));
  const where = a.regionIds.length ? ` over ${a.regionIds.map((r) => getRegion(r)?.name ?? r).join(' / ')}` : '';
  const who = `${a.mil ? 'Military aircraft ' : 'Aircraft '}${emergencyLabel(a)}${a.t ? ` (${a.t})` : ''}`;
  const caveat = a.sq === '7500' ? ' — often a mis-set transponder; not confirmed' : '';
  return {
    id,
    contentHash: id,
    dataOrigin: 'live',
    sourceId: EMERGENCY_SOURCE_ID,
    sourceName: 'adsb.lol — aircraft emergency codes',
    sourceClass: 'aggregator',
    sourceUrl: `https://adsb.lol/?icao=${a.hex}`,
    title: truncate(`${who} squawking ${SQUAWK_LABEL[a.sq]}${where}${caveat}`, LIMITS.title),
    summary: truncate(
      `${who} broadcast transponder code ${a.sq} (${SQUAWK_LABEL[a.sq]})${a.em ? `, emergency status "${a.em}"` : ''} at ${a.la.toFixed(2)}, ${a.lo.toFixed(2)}${a.alt !== null ? `, ${a.alt} ft` : ''}. ` +
        'Transponder codes are set by the crew and are not verified; most 7700s are medical or technical diversions. Data: adsb.lol (ODbL).',
      LIMITS.summary,
    ),
    category: 'aviation',
    regionIds: a.regionIds,
    countryCodes: [],
    publishedAt: nowIso,
    occurredAt: nowIso,
    collectedAt: nowIso,
    credibility: 'single-source',
    verificationStatus: 'unreviewed',
    latitude: a.la,
    longitude: a.lo,
    locationPrecision: 'exact',
    metadata: { subtype: 'aircraft-emergency', squawk: a.sq, hex: a.hex, military: a.mil, routine: !isNotableEmergency(a), geoBasis: 'adsb-position' },
  };
}

export const adsbEmergencies: SourceAdapter<EmergencyState> = {
  sourceId: EMERGENCY_SOURCE_ID,
  async collect(ctx: AdapterContext<EmergencyState>): Promise<AdapterResult<EmergencyState>> {
    const nowIso = new Date(ctx.now).toISOString();
    const aircraft: EmergencyAircraft[] = [];
    let ok = 0;
    for (const sq of SQUAWKS) {
      const res = await ctx.fetch(`${API}${sq}`, undefined, { Accept: 'application/json' });
      if (res.kind !== 'ok') continue;
      aircraft.push(...parseEmergencies(res.body, sq));
      ok++;
    }
    if (ok === 0) throw new Error('aircraft emergencies: no squawk query answered');
    const reported = Object.fromEntries(Object.entries(ctx.state?.reported ?? {}).filter(([, t]) => ctx.now - t < REPEAT_MS));
    const events: IntelligenceEvent[] = [];
    for (const a of aircraft) {
      const key = `${a.hex}|${a.sq}`;
      if (reported[key]) continue;
      events.push(emergencyRecord(a, nowIso));
      reported[key] = ctx.now;
    }
    return { events, rejected: [], itemsSeen: aircraft.length, notModified: false, state: { latest: { fetchedAt: nowIso, aircraft }, reported } };
  },
};
