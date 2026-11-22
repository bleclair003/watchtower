/**
 * Aircraft emergencies (Phase 25): aircraft broadcasting an emergency transponder code, from the same
 * free ADS-B network as the military layer (adsb.lol, ODbL).
 *  - 7700 general emergency (medical, technical, fuel …)
 *  - 7600 radio failure
 *  - 7500 unlawful interference (hijack). Often a mis-set transponder; never confirmed by this data.
 * Most 7700s are routine medical or technical diversions, so only military aircraft, 7500s and
 * emergencies inside a watch region abroad are shown in the feed by default.
 */
import { regionsForPoint } from './regions.ts';

export type Squawk = '7500' | '7600' | '7700';
export const SQUAWKS: Squawk[] = ['7500', '7600', '7700'];
export const SQUAWK_LABEL: Record<Squawk, string> = {
  '7500': 'hijack code (7500)',
  '7600': 'radio failure (7600)',
  '7700': 'general emergency (7700)',
};

export interface EmergencyAircraft {
  hex: string;
  cs: string | null;
  reg: string | null;
  t: string | null;
  la: number;
  lo: number;
  alt: number | null;
  sq: Squawk;
  /** Emergency status broadcast alongside (general, lifeguard, minfuel, nordo, unlawful, downed), or null. */
  em: string | null;
  /** Marked military in the network's database. */
  mil: boolean;
  regionIds: string[];
}

export interface EmergencySnapshot {
  fetchedAt: string;
  aircraft: EmergencyAircraft[];
  simulated?: boolean;
}

interface RawAc {
  hex?: string;
  flight?: string;
  r?: string;
  t?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | 'ground';
  squawk?: string;
  emergency?: string;
  dbFlags?: number;
  seen_pos?: number;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Parses one squawk query ({ ac: [...] }); positions older than 5 minutes and aircraft on the ground are dropped. */
export function parseEmergencies(body: string, sq: Squawk): EmergencyAircraft[] {
  const data = JSON.parse(body) as { ac?: RawAc[] };
  if (!data || !Array.isArray(data.ac)) throw new Error('aircraft emergencies: response has no "ac" array');
  const out: EmergencyAircraft[] = [];
  for (const a of data.ac) {
    const la = num(a.lat);
    const lo = num(a.lon);
    if (!a.hex || la === null || lo === null) continue;
    if ((num(a.seen_pos) ?? 0) > 300 || a.alt_baro === 'ground') continue;
    if (String(a.squawk ?? sq) !== sq) continue;
    out.push({
      hex: a.hex.toLowerCase(),
      cs: a.flight?.trim() || null,
      reg: a.r?.trim() || null,
      t: a.t?.trim() || null,
      la,
      lo,
      alt: num(a.alt_baro),
      sq,
      em: a.emergency && a.emergency !== 'none' ? a.emergency : null,
      mil: ((num(a.dbFlags) ?? 0) & 1) === 1,
      regionIds: regionsForPoint(la, lo),
    });
  }
  return out;
}

/** Shown in the feed by default: military aircraft, hijack codes, and emergencies in a watch region abroad. */
export const isNotableEmergency = (a: Pick<EmergencyAircraft, 'mil' | 'sq' | 'regionIds'>) => a.mil || a.sq === '7500' || a.regionIds.some((r) => r !== 'united-states');

export const emergencyLabel = (a: Pick<EmergencyAircraft, 'cs' | 'reg' | 'hex'>) => a.cs || a.reg || a.hex.toUpperCase();
