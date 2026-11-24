import type { ShipTrafficDoc, TrafficShip } from '@shared/domain/shipTraffic';

/** SIMULATED tanker and cargo traffic for demo mode and tests: invented ships, MMSIs and tracks. */
export function buildDemoShipTraffic(now: number): ShipTrafficDoc {
  const at = (m: number) => new Date(now - m * 60_000).toISOString();
  const ship = (p: Partial<TrafficShip> & Pick<TrafficShip, 'mmsi' | 'kind' | 'la' | 'lo'>): TrafficShip => ({
    name: null, imo: null, type: p.kind === 'tanker' ? 80 : 70, destination: null, sog: 11, cog: 90, seenAt: at(10), area: 'baltic', track: [], ...p,
  });
  return {
    simulated: true,
    fetchedAt: at(10),
    listenSeconds: 25,
    typesKnown: 1840,
    totalSeen: 4,
    fintraffic: 572,
    levels: [
      { id: 'primorsk', name: 'Primorsk and Vyborg approaches', days: Array.from({ length: 20 }, (_, i) => [new Date(now - (20 - i) * 86_400_000).toISOString().slice(0, 10), 9 + (i % 3), 3] as [string, number, number]), last24: { mean: 2.1, anchored: 0.4, hours: 24 }, centre: 10, score: -4.6, direction: 'drop' },
      { id: 'ust-luga', name: 'Ust-Luga approaches', days: Array.from({ length: 20 }, (_, i) => [new Date(now - (20 - i) * 86_400_000).toISOString().slice(0, 10), 6 + (i % 2), 2] as [string, number, number]), last24: { mean: 6.4, anchored: 2.2, hours: 24 }, centre: 6.5, score: -0.1, direction: null },
      { id: 'gulf-of-finland', name: 'Gulf of Finland (whole)', days: Array.from({ length: 4 }, (_, i) => [new Date(now - (4 - i) * 86_400_000).toISOString().slice(0, 10), 70 + i, 20] as [string, number, number]), last24: { mean: 74, anchored: 21, hours: 24 }, centre: null, score: null, direction: null },
    ],
    dark: [{ mmsi: '999000009', name: '[SIMULATED] TEST DARK', kind: 'tanker', la: 59.7, lo: 25.4, lastAt: at(95), sanctioned: true }],
    ships: [
      ship({ mmsi: '999000001', name: '[SIMULATED] TEST TANKER', imo: '9000001', kind: 'tanker', type: 84, destination: 'PRIMORSK', la: 59.9, lo: 26.2, sog: 12.4, cog: 260, area: 'gulf-of-finland', track: [27.6, 60.2, 180, 27.0, 60.05, 120, 26.6, 59.95, 60] }),
      ship({ mmsi: '999000002', name: '[SIMULATED] TEST CARRIER', kind: 'cargo', type: 70, destination: 'ROTTERDAM', la: 55.4, lo: 15.1, sog: 13, cog: 250, track: [17.2, 55.9, 150, 16.1, 55.6, 75] }),
      ship({ mmsi: '999000003', name: '[SIMULATED] TEST PRODUCT', kind: 'tanker', type: 81, la: 43.9, lo: 31.2, sog: 0.2, cog: null, area: 'black-sea' }),
      ship({ mmsi: '999000004', name: '[SIMULATED] TEST BOX', kind: 'cargo', type: 79, la: 34.6, lo: 32.9, sog: 15, cog: 100, area: 'east-med', track: [31.9, 34.2, 90] }),
    ],
  };
}
