import type { FleetSnapshot } from '@shared/domain/fleet';

/** SIMULATED fleet tracker for demo mode and tests (flagged `simulated`; ship names are placeholders). */
export function buildDemoFleet(now: number): FleetSnapshot {
  return {
    asOf: new Date(now - 4 * 86_400_000).toISOString().slice(0, 10),
    title: 'Simulated fleet tracker',
    url: 'https://example.org/',
    publishedAt: new Date(now - 4 * 86_400_000).toISOString(),
    simulated: true,
    areas: [
      { name: 'Arabian Sea', point: [16, 62], regionIds: ['middle-east'], country: null, ships: [{ name: 'USS DEMO ONE', hull: 'CVN-01', hullType: 'CVN' }, { name: 'USS DEMO TWO', hull: 'DDG-02', hullType: 'DDG' }] },
      { name: 'Philippine Sea', point: [20, 132], regionIds: [], country: null, ships: [{ name: 'USS DEMO THREE', hull: 'LHD-03', hullType: 'LHD' }] },
      { name: 'Mediterranean Sea', point: [36, 18], regionIds: [], country: null, ships: [{ name: 'USS DEMO FOUR', hull: 'DDG-04', hullType: 'DDG' }] },
    ],
  };
}
