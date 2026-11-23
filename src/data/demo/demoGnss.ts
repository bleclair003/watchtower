import { GNSS_CIRCLES, gnssLevel, type GnssCell, type GnssSnapshot } from '@shared/domain/gnss';

/** SIMULATED GPS-interference squares and lost-GPS points for demo mode and tests: invented counts. */
export function buildDemoGnss(now: number): GnssSnapshot {
  const at = (h: number) => new Date(now - h * 3_600_000).toISOString();
  const cell = (k: string, n: number, bad: number, lost: number, regionIds: string[]): GnssCell => ({ k, n, bad, lost, level: gnssLevel(bad, n), regionIds });
  const cells = [
    cell('54|19', 120, 41, 9, ['eastern-europe']),
    cell('55|20', 96, 30, 6, ['eastern-europe']),
    cell('56|21', 88, 6, 1, ['eastern-europe']),
    cell('55|22', 70, 1, 0, ['eastern-europe']),
    cell('33|35', 64, 22, 3, ['middle-east']),
    cell('32|34', 140, 4, 0, ['middle-east']),
    cell('26|55', 150, 2, 0, ['middle-east']),
    cell('37|127', 210, 0, 0, ['korean-peninsula']),
  ];
  return {
    simulated: true,
    fetchedAt: at(0.4),
    windowHours: 24,
    provider: 'adsb.lol',
    circles: GNSS_CIRCLES,
    failed: ['south-china-sea'],
    cells,
    lost: [
      { la: 54.47, lo: 14.34, at: at(2), nowLa: 54.9, nowLo: 18.6, cs: 'SIM101' },
      { la: 55.9, lo: 18.2, at: at(5), nowLa: 56.4, nowLo: 21.1, cs: 'SIM202' },
      { la: 33.1, lo: 34.6, at: at(9), nowLa: 33.6, nowLo: 35.3, cs: null },
    ],
    sightings: cells.reduce((a, c) => a + c.n, 0) + 900,
    degraded: cells.reduce((a, c) => a + c.bad, 0),
    since: at(30),
  };
}
