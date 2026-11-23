import type { RadioGuide } from '@shared/domain/shortwave';
import type { NavWarningSnapshot } from '@shared/domain/navWarnings';
import type { EmergencySnapshot } from '@shared/domain/aircraftEmergencies';
import type { RadioReceiversSnapshot } from '@shared/domain/radio';
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
    aircraft: [{ hex: 'fff001', cs: 'SIM7700', reg: null, t: 'A320', la: 43.1, lo: 34.2, alt: 18000, sq: '7700', em: 'general', mil: false, regionIds: ['eastern-europe'], firstSeenAt: new Date(now - 50 * 60_000).toISOString(), notSeenAt: new Date(now - 80 * 60_000).toISOString() }],
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

/** SIMULATED shortwave receivers for demo mode (addresses use the reserved .invalid domain, so links go nowhere). */
export function buildDemoReceivers(now: number): RadioReceiversSnapshot {
  const rx = (name: string, host: string, lat: number, lon: number) => ({ name: `[SIMULATED] ${name}`, url: `http://${host}.invalid:8073`, lat, lon, minKhz: 0, maxKhz: 30_000, slots: 4 });
  return {
    fetchedAt: new Date(now - 6 * 3_600_000).toISOString(),
    listTime: new Date(now - 6 * 3_600_000).toISOString(),
    simulated: true,
    receivers: [
      rx('Demo receiver, Kansas', 'demo-ks', 38.5, -98.0),
      rx('Demo receiver, Ireland', 'demo-ie', 53.0, -8.0),
      rx('Demo receiver, Finland', 'demo-fi', 61.0, 25.0),
      rx('Demo receiver, Cyprus', 'demo-cy', 35.0, 33.0),
      rx('Demo receiver, Japan', 'demo-jp', 35.5, 139.5),
    ],
  };
}

/** Phase 29 demo radio guide: invented stations and schedules, all marked SIMULATED. */
export function buildDemoRadioGuide(now: number): RadioGuide {
  const at = new Date(now - 5 * 3_600_000).toISOString();
  const sw = (station: string, kHz: number[], start: string, end: string, itu: string, target: string, lang: string, utility = false, days = '') =>
    ({ kHz, start, end, days, itu, station: `[SIMULATED] ${station}`, lang, target, site: '', utility });
  const st = (cc: string, name: string, news: boolean, clicks: number) => ({
    uuid: `demo-${cc}-${clicks}`,
    name: `[SIMULATED] ${name}`,
    cc,
    homepage: `https://demo-${cc.toLowerCase()}-${clicks}.invalid/`,
    stream: `https://demo-${cc.toLowerCase()}-${clicks}.invalid/stream`,
    news,
    clicks,
  });
  return {
    generatedAt: at,
    shortwave: {
      fetchedAt: at,
      season: 'B26',
      sourceUrl: 'http://www.eibispace.de/dx/sked-b26.csv',
      simulated: true,
      broadcasts: [
        sw('Demo World Service', [9500, 11800], '0000', '2400', 'ROU', 'EEu', 'UK'),
        sw('Demo Overseas Radio', [7300], '1600', '1800', 'USA', 'UKR', 'R', false, 'Mo-Fr'),
        sw('Demo Channel Marker', [4700, 6900], '0000', '2400', 'RUS', 'RUS', '-CW', true),
        sw('Demo Numbers Station', [5100], '0700', '0730', 'RUS', 'Eu', 'R', true, 'irr'),
        sw('Demo Regional Voice', [6100], '0000', '2400', 'IRN', 'ME', 'A'),
        sw('Demo Gulf Service', [13700], '1200', '1400', 'USA', 'ME', 'FS'),
        sw('Demo Peninsula Radio', [3250, 6100], '0000', '2400', 'KRE', 'KRE', 'K'),
      ],
      languages: { UK: 'Ukrainian', R: 'Russian', '-CW': 'Morse Station', A: 'Arabic', FS: 'Farsi / Iranian Persian', K: 'Korean' },
      countries: { ROU: 'Romania', USA: 'United States of America', RUS: 'Russian Federation', UKR: 'Ukraine', IRN: 'Iran', KRE: 'Korea, North' },
    },
    localRadio: {
      fetchedAt: at,
      sourceUrl: 'https://de1.api.radio-browser.info/',
      simulated: true,
      stations: [
        st('UA', 'Demo News Radio Kyiv', true, 900),
        st('UA', 'Demo Hits FM', false, 500),
        st('IL', 'Demo News Radio', true, 800),
        st('LB', 'Demo Beirut Talk', true, 300),
        st('KR', 'Demo Seoul News', true, 400),
      ],
    },
  };
}
