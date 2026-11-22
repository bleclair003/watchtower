import type { NavWarningSnapshot } from '@shared/domain/navWarnings';
import type { EmergencySnapshot } from '@shared/domain/aircraftEmergencies';
import type { ConflictSnapshot } from '@shared/domain/conflictEvents';

/** SIMULATED navigational warnings for demo mode and tests: invented areas and text. */
export function buildDemoNavWarnings(now: number): NavWarningSnapshot {
  const at = (h: number) => new Date(now - h * 3_600_000).toISOString();
  return {
    simulated: true,
    activeTotal: 214,
    fetchedAt: at(1),
    warnings: [
      {
        key: 'HYDROPAC 9001/26', series: 'HYDROPAC', number: 9001, year: 2026, issuedAt: at(20), kind: 'missile',
        text: '[SIMULATED] SEA OF JAPAN. MISSILE FIRING OPERATIONS IN AREA BOUNDED BY 40-00N 131-00E, 40-00N 133-00E, 38-30N 133-00E, 38-30N 131-00E. DEMO TEXT.',
        points: [[40, 131], [40, 133], [38.5, 133], [38.5, 131]], lat: 39.25, lon: 132, regionIds: ['korean-peninsula'],
      },
      {
        key: 'NAVAREA IV 9002/26', series: 'NAVAREA IV', number: 9002, year: 2026, issuedAt: at(50), kind: 'firing',
        text: '[SIMULATED] EASTERN MEDITERRANEAN. GUNNERY EXERCISES WITHIN 10 MILES OF 33-50N 033-20E. DEMO TEXT.',
        points: [[33.8333, 33.3333]], lat: 33.833, lon: 33.333, regionIds: ['middle-east'],
      },
      {
        key: 'HYDROLANT 9003/26', series: 'HYDROLANT', number: 9003, year: 2026, issuedAt: at(5), kind: 'gnss',
        text: '[SIMULATED] BALTIC SEA. GPS INTERFERENCE REPORTED IN VICINITY OF 55-30N 019-00E. DEMO TEXT.',
        points: [[55.5, 19]], lat: 55.5, lon: 19, regionIds: ['eastern-europe'],
      },
    ],
  };
}

/** SIMULATED aircraft emergency for demo mode and tests. */
export function buildDemoEmergencies(now: number): EmergencySnapshot {
  return {
    simulated: true,
    fetchedAt: new Date(now - 20 * 60_000).toISOString(),
    aircraft: [{ hex: 'fff001', cs: 'SIM7700', reg: null, t: 'A320', la: 43.1, lo: 34.2, alt: 18000, sq: '7700', em: 'general', mil: false, regionIds: ['eastern-europe'] }],
  };
}

/** SIMULATED UCDP-style conflict events for demo mode and tests: invented places and figures. */
export function buildDemoConflicts(now: number): ConflictSnapshot {
  const d = new Date(now - 40 * 86_400_000);
  const month = d.toISOString().slice(0, 7);
  const ev = (id: number, day: number, la: number, lo: number, ty: 1 | 2 | 3, k: number, country: string, regionIds: string[]) => ({ id, d: `${month}-${String(day).padStart(2, '0')}`, la, lo, ty, k, p: 2, country, a: '[SIMULATED] Side A', b: '[SIMULATED] Side B', regionIds });
  return {
    simulated: true,
    release: '0.0.0',
    month,
    fetchedAt: new Date(now - 86_400_000).toISOString(),
    sourceUrl: 'https://ucdp.uu.se/downloads/',
    worldEvents: 2400,
    events: [
      ev(1, 3, 48.0, 37.8, 1, 24, 'Demo Country E', ['eastern-europe']),
      ev(2, 9, 47.6, 35.9, 1, 9, 'Demo Country E', ['eastern-europe']),
      ev(3, 12, 35.2, 38.9, 2, 6, 'Demo Country M', ['middle-east']),
      ev(4, 18, 15.4, 44.2, 1, 14, 'Demo Country R', ['red-sea', 'middle-east']),
      ev(5, 21, 31.5, 34.4, 3, 4, 'Demo Country M', ['middle-east']),
    ],
    regions: [
      { regionId: 'eastern-europe', events: 270, deaths: 1900, deathsByType: [1880, 0, 20] },
      { regionId: 'middle-east', events: 640, deaths: 1300, deathsByType: [900, 250, 150] },
      { regionId: 'red-sea', events: 470, deaths: 820, deathsByType: [700, 80, 40] },
    ],
  };
}
