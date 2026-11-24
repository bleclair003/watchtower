import { buildPlaSnapshot, type PlaDay, type TaiwanPlaSnapshot } from '@shared/domain/taiwanPla';

/** SIMULATED daily PLA counts around Taiwan for demo mode and tests: an invented quiet stretch, a patrol and a surge. */
export function buildDemoTaiwanPla(now: number): TaiwanPlaSnapshot {
  const day = (k: number) => new Date(now - k * 86_400_000).toISOString().slice(0, 10);
  const days: PlaDay[] = [];
  for (let k = 89; k >= 0; k--) {
    const wave = (k * 7) % 5;
    let aircraft = 4 + wave;
    let ships = 7 + (k % 3);
    if (k === 30) aircraft = 26; // an invented readiness patrol
    if (k === 0) {
      aircraft = 71; // an invented exercise day
      ships = 19;
    }
    days.push({ date: day(k), aircraft, crossed: Math.round(aircraft * 0.6), ships, type: 'Mixed', balloons: k === 12 ? 1 : 0, note: 'SIMULATED' });
  }
  return { ...buildPlaSnapshot(days, new Date(now - 3 * 3_600_000).toISOString()), simulated: true };
}
