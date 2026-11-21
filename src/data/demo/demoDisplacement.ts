import type { DisplacementSnapshot } from '@shared/domain/displacement';

/** SIMULATED displacement figures for demo mode and tests (flagged `simulated`). Round, invented numbers. */
export function buildDemoDisplacement(now: number): DisplacementSnapshot {
  const year = new Date(now).getUTCFullYear();
  const f = (refugeesAbroad: number, idps: number, refugeesHosted: number) => ({ refugeesAbroad, asylumSeekersAbroad: Math.round(refugeesAbroad / 10), idps, refugeesHosted, asylumSeekersHosted: Math.round(refugeesHosted / 10), returnedRefugees: 0 });
  return {
    fetchedAt: new Date(now).toISOString(),
    year,
    previousYear: year - 1,
    simulated: true,
    rows: [
      { country: 'UA', latest: f(5_000_000, 4_000_000, 2_000), previous: f(5_100_000, 3_500_000, 2_000) },
      { country: 'LB', latest: f(10_000, 400_000, 900_000), previous: f(10_000, 60_000, 800_000) },
      { country: 'YE', latest: f(50_000, 5_000_000, 50_000), previous: null },
    ],
  };
}
