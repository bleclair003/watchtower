import type { AircraftSnapshot } from '@shared/domain/aircraft';

/**
 * SIMULATED aircraft for demo mode and tests: callsigns start with DEMO, positions are
 * arbitrary points, and the snapshot is flagged `simulated` so the UI labels it.
 */
export function buildDemoAircraft(now: number): AircraftSnapshot {
  return {
    fetchedAt: new Date(now - 5 * 60_000).toISOString(),
    provider: 'adsb.lol',
    simulated: true,
    totalMarked: 5,
    aircraft: [
      { hex: 'ae0d01', cs: 'DEMO01', reg: null, t: 'K35R', cls: 'tanker', la: 31.2, lo: 41.5, alt: 28000, gs: 410, trk: 120, age: 2, em: null },
      { hex: 'ae0d02', cs: 'DEMO02', reg: null, t: 'R135', cls: 'isr', la: 45.1, lo: 33.0, alt: 31000, gs: 380, trk: 80, age: 4, em: null },
      { hex: 'ae0d03', cs: 'DEMO03', reg: null, t: 'C17', cls: 'airlift', la: 50.2, lo: 21.8, alt: 34000, gs: 450, trk: 95, age: 1, em: null },
      { hex: 'ae0d04', cs: 'DEMO04', reg: null, t: 'P8', cls: 'isr', la: 24.0, lo: 121.5, alt: 22000, gs: 330, trk: 10, age: 3, em: null },
      { hex: 'ae0d05', cs: 'DEMO05', reg: null, t: 'A332', cls: 'other', la: 38.5, lo: -95.0, alt: 36000, gs: 470, trk: 270, age: 6, em: null },
    ],
  };
}
