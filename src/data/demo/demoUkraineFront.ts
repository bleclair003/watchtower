import type { FrontReport, UkraineFrontSnapshot } from '@shared/domain/ukraineFront';

/** SIMULATED Ukraine front data for demo mode and tests. Invented figures; settlement names are placeholders. */
export function buildDemoUkraineFront(now: number): UkraineFrontSnapshot {
  const day = (d: number) => new Date(now - d * 86_400_000).toISOString().slice(0, 10);
  const report = (d: number, total: number, pok: number, kos: number): FrontReport => ({
    day: day(d),
    asOf: new Date(now - (d - 1) * 86_400_000 - 16 * 3_600_000).toISOString(),
    fullDay: true,
    total,
    airstrikes: 60,
    guidedBombs: 200,
    kamikazeDrones: 5000,
    shelling: 1800,
    sectors: { pokrovsk: pok, kostiantynivka: kos, huliaipole: 6, lyman: 5, kupiansk: 2 },
    quiet: ['kramatorsk'],
    places: { pokrovsk: ['[SIMULATED] Demo-A', 'Demo-B'], kostiantynivka: ['Demo-C'] },
    url: 'https://example.invalid/general-staff',
  });
  return {
    simulated: true,
    reports: Array.from({ length: 14 }, (_, i) => report(i + 1, i === 0 ? 260 : 170 + (i % 4) * 10, i === 0 ? 48 : 22 + (i % 3), 10)),
    today: { ...report(0, 95, 18, 6), fullDay: false, asOf: new Date(now - 2 * 3_600_000).toISOString() },
    claims: [{ at: new Date(now - 30 * 3_600_000).toISOString(), side: 'russia', place: 'Demo-A', title: '[SIMULATED] Russia says it captured Demo-A', url: 'https://example.invalid/claim', source: 'Demo News' }],
  };
}
