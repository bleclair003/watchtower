import { gFromKp } from '../spaceWeather.ts';
import type { MeterInput } from './input.ts';
import type { Meter, MeterComponent, MeterLevel } from './types.ts';
import { evidenceOf, meter, newest, within } from './util.ts';

const SW_SOURCES = new Set(['nasa-donki', 'noaa-swpc']);
const H = 3_600_000;

/** NOAA scale (0–5) → meter level: 1 LOW, 2 GUARDED, 3 ELEVATED, 4+ HIGH. */
const fromScale = (n: number): Exclude<MeterLevel, null> => (n >= 4 ? 4 : (n as 0 | 1 | 2 | 3));

/**
 * Space weather (Phase 19), global. The meter shows the highest of:
 *  - the current NOAA geomagnetic storm scale (G1 LOW … G4+ HIGH);
 *  - radio blackouts R3 (GUARDED), R4+ (ELEVATED); solar radiation storms S2 (GUARDED), S3+ (ELEVATED);
 *  - NOAA's predicted G level for the next three days, one step lower (a forecast, not an event);
 *  - a CME predicted to reach Earth within 72 hours: the G level of NASA's model Kp (at least LOW).
 */
export function spaceWeatherMeter(input: MeterInput): Meter {
  const sw = input.spaceWeather;
  const base = { id: 'space-weather', kind: 'space-weather' as const, family: 'topic' as const, name: 'Space weather (CMEs, geomagnetic storms)', regionId: null };
  if (!sw) return meter({ ...base, level: null, label: 'NO DATA', value: null, reading: 'NASA DONKI and NOAA SWPC have not been read yet.', components: [], evidence: [], asOf: null, baseline: 'none', notes: [] });
  const { now } = input;
  const cur = sw.now ?? { r: 0, s: 0, g: 0 };
  const fcG = Math.max(0, ...sw.forecast.map((d) => d.g ?? 0));
  const soon = sw.arrivals.filter((a) => Date.parse(a.arrival) >= now - 12 * H && Date.parse(a.arrival) <= now + 72 * H);
  const arrivalLevel = Math.max(0, ...soon.map((a) => Math.max(1, gFromKp(a.kpHigh ?? 0)))) as number;
  const parts: [string, number][] = [
    ['geomagnetic', fromScale(cur.g)],
    ['radio', cur.r >= 4 ? 3 : cur.r >= 3 ? 2 : 0],
    ['radiation', cur.s >= 3 ? 3 : cur.s >= 2 ? 2 : 0],
    ['forecast', Math.max(0, fromScale(fcG) - 1)],
    ['arrival', fromScale(arrivalLevel)],
  ];
  const level = Math.max(...parts.map(([, l]) => l)) as Exclude<MeterLevel, null>;
  const fmt = (t: string) => `${t.slice(8, 10)}/${t.slice(5, 7)} ${t.slice(11, 16)} UTC`;
  const components: MeterComponent[] = [
    { label: 'NOAA scales now (radio · radiation · geomagnetic)', value: `R${cur.r} · S${cur.s} · G${cur.g}`, active: cur.g > 0 || cur.r >= 3 || cur.s >= 2 },
    { label: 'Planetary K-index (latest · 24 h max)', value: sw.kp ? `${sw.kp.latest} · ${sw.kp.max24h}` : 'no reading', active: (sw.kp?.max24h ?? 0) >= 5 },
    { label: 'NOAA forecast, next 3 days (max G)', value: `G${fcG}`, active: fcG > 0 },
    {
      label: 'CMEs predicted to reach Earth (72 h)',
      value: soon.length ? soon.map((a) => `${fmt(a.arrival)}${a.glancing ? ' glancing' : ''}${a.kpHigh !== null ? ` Kp≤${a.kpHigh}` : ''}`).join('; ') : '0',
      active: soon.length > 0,
    },
    { label: 'CMEs measured in 7 days (fastest)', value: `${sw.cmes7d}${sw.fastest7d ? ` (${sw.fastest7d} km/s)` : ''}`, active: false, note: 'context: most CMEs miss Earth' },
  ];
  const reading = soon.length
    ? `CME expected at Earth ~${fmt(soon[0].arrival)}${soon[0].glancing ? ' (glancing blow)' : ''}${soon[0].kpHigh !== null ? `; model up to Kp ${soon[0].kpHigh} (G${gFromKp(soon[0].kpHigh)})` : ''}. Now R${cur.r} S${cur.s} G${cur.g}.`
    : cur.g || cur.r || cur.s
      ? `NOAA scales now R${cur.r} S${cur.s} G${cur.g}.`
      : `Quiet: no storms now, none forecast above G${fcG} and no CME heading for Earth.`;
  const records = input.events.filter((e) => SW_SOURCES.has(e.sourceId) && within(e, now, 72));
  return meter({
    ...base,
    level,
    value: level,
    reading,
    components,
    evidence: evidenceOf(records, (e) => (e.sourceId === 'noaa-swpc' ? 'NOAA message' : 'NASA DONKI')),
    asOf: newest(records) ?? sw.fetchedAt,
    baseline: 'none',
    notes: [
      'Strong geomagnetic storms (G3+) degrade GPS accuracy, HF radio and satellite operations and stress power grids; radio blackouts (R3+) cut HF on the sunlit side of Earth.',
      'CME arrival times are model predictions (NASA WSA-Enlil), usually within about ±7 hours; the strength depends on the CME\'s magnetic field, known only on arrival.',
    ],
  });
}
