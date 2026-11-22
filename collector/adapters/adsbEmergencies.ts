import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { getRegion } from '../../shared/domain/regions.ts';
import { SQUAWKS, SQUAWK_LABEL, emergencyLabel, emergencyTiming, isNotableEmergency, parseEmergencies, type EmergencyAircraft, type EmergencySnapshot, type Squawk } from '../../shared/domain/aircraftEmergencies.ts';
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
/** Checks further apart than this do not narrow down when a code came up. */
const MAX_GAP_MS = 75 * 60_000;

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
        (emergencyTiming(a) ? `${emergencyTiming(a)} (checks run about every 30 minutes). ` : '') +
        'Transponder codes are set by the crew and are not verified; most 7700s are medical or technical diversions. Data: adsb.lol (ODbL).',
      LIMITS.summary,
    ),
    category: 'aviation',
    regionIds: a.regionIds,
    countryCodes: [],
    publishedAt: nowIso,
    occurredAt: a.firstSeenAt ?? nowIso,
    collectedAt: nowIso,
    credibility: 'single-source',
    verificationStatus: 'unreviewed',
    latitude: a.la,
    longitude: a.lo,
    locationPrecision: 'exact',
    metadata: {
      subtype: 'aircraft-emergency', squawk: a.sq, hex: a.hex, military: a.mil, routine: !isNotableEmergency(a), geoBasis: 'adsb-position',
      firstSeenAt: a.firstSeenAt ?? nowIso, notSeenAt: a.notSeenAt ?? null,
    },
  };
}

/**
 * When each code came up (v0.63.1). An aircraft already on the code at the previous check keeps its first-seen
 * time; a new one gets this check's time, and the previous check's time as "not on it then" only when that check
 * ran for the code and was recent (a gap in collection would make the window wider than it looks).
 */
export function stampTimes(aircraft: EmergencyAircraft[], prev: EmergencySnapshot | null, now: number, nowIso: string): void {
  const before = new Map((prev?.aircraft ?? []).map((p) => [`${p.hex}|${p.sq}`, p]));
  const prevAt = prev ? Date.parse(prev.fetchedAt) : NaN;
  const prevRecent = Number.isFinite(prevAt) && now - prevAt > 0 && now - prevAt <= MAX_GAP_MS;
  for (const a of aircraft) {
    const was = prevRecent ? before.get(`${a.hex}|${a.sq}`) : undefined;
    if (was) {
      // Older snapshots have no first-seen time: it was on the code at least since the previous check.
      a.firstSeenAt = was.firstSeenAt ?? prev!.fetchedAt;
      a.notSeenAt = was.firstSeenAt ? (was.notSeenAt ?? null) : null;
    } else {
      a.firstSeenAt = nowIso;
      a.notSeenAt = prevRecent && prev!.checkedCodes?.includes(a.sq) ? prev!.fetchedAt : null;
    }
  }
}

export const adsbEmergencies: SourceAdapter<EmergencyState> = {
  sourceId: EMERGENCY_SOURCE_ID,
  async collect(ctx: AdapterContext<EmergencyState>): Promise<AdapterResult<EmergencyState>> {
    const nowIso = new Date(ctx.now).toISOString();
    const aircraft: EmergencyAircraft[] = [];
    const checkedCodes: Squawk[] = [];
    for (const sq of SQUAWKS) {
      const res = await ctx.fetch(`${API}${sq}`, undefined, { Accept: 'application/json' });
      if (res.kind !== 'ok') continue;
      aircraft.push(...parseEmergencies(res.body, sq));
      checkedCodes.push(sq);
    }
    if (checkedCodes.length === 0) throw new Error('aircraft emergencies: no squawk query answered');
    stampTimes(aircraft, ctx.state?.latest ?? null, ctx.now, nowIso);
    const reported = Object.fromEntries(Object.entries(ctx.state?.reported ?? {}).filter(([, t]) => ctx.now - t < REPEAT_MS));
    const events: IntelligenceEvent[] = [];
    for (const a of aircraft) {
      const key = `${a.hex}|${a.sq}`;
      if (reported[key]) continue;
      events.push(emergencyRecord(a, nowIso));
      reported[key] = ctx.now;
    }
    return { events, rejected: [], itemsSeen: aircraft.length, notModified: false, state: { latest: { fetchedAt: nowIso, aircraft, checkedCodes }, reported } };
  },
};
