import { clusterStations, type FlaggedStation, type RadiationSnapshot } from '@shared/domain/radiation';

/** SIMULATED radiation readings for demo mode and tests: an invented group of raised stations. */
export function buildDemoRadiation(now: number): RadiationSnapshot {
  const at = new Date(now - 40 * 60_000).toISOString();
  const s = (id: string, name: string, lat: number, lon: number, value: number, usual: number): FlaggedStation => ({ id, name: `[SIMULATED] ${name}`, lat, lon, at, value, usual, network: 'bfs', status: 'elevated' });
  const flagged = [s('DEMO1', 'Demo Station A', 51.05, 13.74, 0.31, 0.1), s('DEMO2', 'Demo Station B', 51.3, 13.3, 0.27, 0.11), s('DEMO3', 'Demo Station C', 50.85, 14.2, 0.24, 0.1)];
  return {
    simulated: true,
    networks: [
      { network: 'bfs', fetchedAt: at, stations: 1551, withBaseline: 1540, median: 0.105 },
      { network: 'stuk', fetchedAt: at, stations: 244, withBaseline: 240, median: 0.116 },
      { network: 'radnet', fetchedAt: at, stations: 16, withBaseline: 16, median: 0.05 },
    ],
    flagged,
    clusters: clusterStations(flagged),
  };
}
