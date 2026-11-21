import type { SanctionedShipsSnapshot } from '@shared/domain/sanctionedShips';

/** SIMULATED sanctioned-vessel sightings for demo mode and tests (flagged `simulated`). */
export function buildDemoSanctionedShips(now: number): SanctionedShipsSnapshot {
  const at = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();
  return {
    listenedAt: at(5),
    listenSeconds: 25,
    messages: 1200,
    ships: 900,
    watchlistSize: 2000,
    simulated: true,
    sightings: [
      { mmsi: '000000001', imo: '0000001', listedName: 'DEMO TANKER A', aisName: 'DEMO A', lists: ['ofac', 'uk'], programs: ['DEMO'], matchedBy: 'imo', la: 59.9, lo: 25.5, sog: 10.5, cog: 80, destination: 'DEMO PORT', area: 'gulf-of-finland', seenAt: at(5) },
      { mmsi: '000000002', imo: null, listedName: 'DEMO TANKER B', aisName: null, lists: ['ofac'], programs: ['DEMO'], matchedBy: 'mmsi', la: 55.2, lo: 14.6, sog: 0, cog: null, destination: null, area: 'baltic', seenAt: at(90) },
    ],
  };
}
