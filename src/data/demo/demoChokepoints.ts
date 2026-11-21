import { assessChokepoint, type ChokepointSnapshot, type DailyTransit } from '@shared/domain/chokepoints';

/** SIMULATED chokepoint counts for demo mode and tests (flagged `simulated`). */
export function buildDemoChokepoints(now: number): ChokepointSnapshot {
  const end = now - 6 * 86_400_000;
  const series = (f: (i: number) => number): DailyTransit[] =>
    Array.from({ length: 60 }, (_, i) => [new Date(end - (59 - i) * 86_400_000).toISOString().slice(0, 10), Math.max(0, Math.round(f(i))), 0]);
  const make = (id: string, name: string, regionId: string | null, lat: number, lon: number, ref: number, f: (i: number) => number) => {
    const s = series(f);
    return { id, name, regionId, lat, lon, ref2025: { total: ref, tanker: ref / 3 }, series: s, ...assessChokepoint(s, { total: ref }) };
  };
  const items = [
    make('demo-strait-a', 'Demo Strait A', 'middle-east', 26.3, 56.9, 80, (i) => (i < 30 ? 78 : 20) + (i % 5)),
    make('demo-strait-b', 'Demo Strait B', 'taiwan-strait', 24.7, 119.8, 230, (i) => 225 + ((i * 7) % 20)),
  ];
  return { fetchedAt: new Date(now).toISOString(), latestDate: items[0].latestDate, items, simulated: true };
}
