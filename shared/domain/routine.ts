/**
 * Routine records: kept and counted everywhere, but hidden from the GOC feed and map by default because
 * they arrive in bulk and rarely matter one by one.
 *  - Routine military-aircraft sightings (tankers, airlift, surveillance; not bombers or command/VIP).
 *  - IODA connectivity drops outside every watch region (IODA states no cause; most are small regional
 *    dips). Outages in a watch region, and Cloudflare's outages with a stated cause, always show.
 */
import type { IntelligenceEvent } from './types.ts';
import { isRoutineSighting } from './aircraft.ts';

export const isRoutineOutage = (e: Pick<IntelligenceEvent, 'sourceId' | 'regionIds'>) => e.sourceId === 'ioda-outages' && e.regionIds.length === 0;

/** Sources whose routine records show again when that source is picked in the source filter. */
export const ROUTINE_SOURCES = new Set(['adsb-military', 'ioda-outages']);

export function isRoutineRecord(e: Pick<IntelligenceEvent, 'sourceId' | 'regionIds' | 'metadata'>): boolean {
  return isRoutineSighting(e) || isRoutineOutage(e);
}
