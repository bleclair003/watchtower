import { packRings, type PowerOutageSnapshot } from '@shared/domain/powerOutages';

/** A rectangle ring (lon/lat), for the invented demo areas. */
const box = (w: number, s: number, e: number, n: number): [number, number][] => [[w, s], [e, s], [e, n], [w, n], [w, s]];

/** SIMULATED US power outages for demo mode and tests (flagged `simulated`). Invented areas and counts. */
export function buildDemoPowerOutages(now: number): PowerOutageSnapshot {
  return {
    fetchedAt: new Date(now - 10 * 60_000).toISOString(),
    utilitiesReporting: 150,
    utilitiesWithOutages: 3,
    totalOut: 41_250,
    simulated: true,
    states: [
      { fips: '48', name: 'Texas', out: 38_000, counties: 2, top: [{ name: '[SIMULATED] Demo Electric', out: 38_000 }] },
      { fips: '12', name: 'Florida', out: 3_250, counties: 1, top: [{ name: '[SIMULATED] Demo Power Co', out: 3_250 }] },
    ],
    counties: [
      { fips: '48901', name: '[SIMULATED] Demo County A', state: 'Texas', out: 31_000, utilities: ['[SIMULATED] Demo Electric'], path: packRings([box(-96.0, 29.5, -95.0, 30.2)]) },
      { fips: '48902', name: '[SIMULATED] Demo County B', state: 'Texas', out: 7_000, utilities: ['[SIMULATED] Demo Electric'], path: packRings([box(-97.2, 30.0, -96.4, 30.6)]) },
      { fips: '12901', name: '[SIMULATED] Demo County C', state: 'Florida', out: 3_250, utilities: ['[SIMULATED] Demo Power Co'], path: packRings([box(-82.6, 27.6, -82.0, 28.2)]) },
    ],
  };
}
