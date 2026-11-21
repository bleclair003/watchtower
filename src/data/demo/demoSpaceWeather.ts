import type { SpaceWeatherSnapshot } from '@shared/domain/spaceWeather';

/** SIMULATED space weather for demo mode and tests: an invented CME heading for Earth. */
export function buildDemoSpaceWeather(now: number): SpaceWeatherSnapshot {
  const at = (h: number) => new Date(now + h * 3_600_000).toISOString();
  const day = (d: number) => at(d * 24).slice(0, 10);
  return {
    fetchedAt: at(-0.3),
    simulated: true,
    now: { r: 0, s: 0, g: 1 },
    forecast: [
      { date: day(0), rMinor: 15, rMajor: 1, s: 1, g: 1 },
      { date: day(1), rMinor: 15, rMajor: 1, s: 1, g: 2 },
      { date: day(2), rMinor: 10, rMajor: 1, s: 1, g: 0 },
    ],
    kp: { latest: 4.67, at: at(-1), max24h: 5.33 },
    arrivals: [{ cmeId: 'DEMO-CME-001', start: at(-50), speed: 820, arrival: at(30), glancing: false, kpLow: 5, kpHigh: 6, modelRunAt: at(-40), url: 'https://example.invalid/demo-cme' }],
    cmes7d: 14,
    fastest7d: 820,
    storms: [],
    messages: [{ code: 'WATA30', serial: '0001', issued: at(-6), headline: 'WATCH: Geomagnetic Storm Category G2 Predicted [SIMULATED]', scale: 'G2', mentionsCme: true }],
  };
}
