import type { AirportStatusSnapshot, AirspaceNoticesSnapshot, TfrSnapshot } from '@shared/domain/faa';
import { packRings } from '@shared/domain/powerOutages';

const box = (w: number, s: number, e: number, n: number): [number, number][] => [[w, s], [e, s], [e, n], [w, n], [w, s]];
const at = (now: number, h: number) => new Date(now + h * 3_600_000).toISOString();

/** SIMULATED FAA flight restrictions for demo mode and tests. Invented places and times. */
export function buildDemoTfrs(now: number): TfrSnapshot {
  return {
    fetchedAt: at(now, -0.2),
    simulated: true,
    items: [
      { notam: '6/0001', type: 'VIP', title: '[SIMULATED] Demo City, Virginia', state: 'VA', start: at(now, -2), end: at(now, 5), reason: 'Temporary flight restrictions for VIP Movement', altitude: 'From the surface up to and including 17999 feet MSL', path: packRings([box(-78.2, 38.6, -77.2, 39.4)]) },
      { notam: '6/0002', type: 'SECURITY', title: '[SIMULATED] Demo Base, Florida', state: 'FL', start: at(now, 20), end: at(now, 80), reason: 'Temporary flight restrictions for Special Security Reasons', altitude: null, path: packRings([box(-81.5, 30.2, -81.2, 30.5)]) },
    ],
  };
}

/** SIMULATED FAA airport status. Invented events at real airport positions. */
export function buildDemoAirportStatus(now: number): AirportStatusSnapshot {
  return {
    fetchedAt: at(now, -0.1),
    simulated: true,
    events: [
      { code: 'EWR', name: '[SIMULATED] Newark Liberty International', lat: 40.6925, lon: -74.1687, kind: 'ground-stop', condition: 'equipment / outage', start: at(now, -1), end: at(now, 1), delay: null, notable: true, url: null },
      { code: 'ORD', name: "[SIMULATED] Chicago O'Hare International", lat: 41.9786, lon: -87.9048, kind: 'departure-delay', condition: 'WX:Thunderstorms', start: null, end: null, delay: '31 minutes–45 minutes', notable: false, url: null },
    ],
  };
}

/** SIMULATED FAA notices for US flights abroad (one marked new). */
export function buildDemoAirspaceNotices(now: number): AirspaceNoticesSnapshot {
  return {
    fetchedAt: at(now, -1),
    trackingSince: at(now, -24 * 30),
    simulated: true,
    areas: [
      { name: 'Iran', code: 'IR', regionIds: ['middle-east'], level: 'prohibition', docs: [{ title: '[SIMULATED] SFAR 117 — Prohibition against certain flights in the Tehran FIR', url: 'https://example.invalid/sfar117', kind: 'regulation', firstSeen: null }] },
      { name: 'Persian Gulf and Gulf of Oman', code: null, regionIds: ['middle-east'], level: 'advisory', docs: [{ title: '[SIMULATED] KICZ advisory NOTAM — overwater airspace', url: 'https://example.invalid/kicz', kind: 'advisory', firstSeen: at(now, -30) }] },
    ],
  };
}
