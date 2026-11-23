// @vitest-environment node
/** Shortwave schedules and local stations (Phase 29). Station names, links and schedules are invented. */
import { describe, expect, it } from 'vitest';
import type { FetchResult } from '../lib/http.ts';
import { HttpError } from '../lib/http.ts';
import {
  cleanLinkUrl, eibiSeasonFiles, eibiWeekdays, localListenLinks, onAirNow, parseEibiCodes, parseEibiCsv, pickLocalStations,
  shortwaveForRegion, sortForNow, swMode, type SwBroadcast,
} from '../../shared/domain/shortwave.ts';
import { shortwaveSchedule } from '../adapters/shortwaveSchedule.ts';
import { localRadio, LOCAL_RADIO_COUNTRIES } from '../adapters/localRadio.ts';
import { getSource } from '../../shared/domain/sources.ts';
import { MemoryStore } from '../store/memory.ts';

const ok = (b: string): FetchResult => ({ kind: 'ok', status: 200, body: b, validators: {}, bytes: b.length });
const HEAD = 'kHz:75;Time(UTC):93;Days:59;ITU:49;Station:201;Lng:49;Target:62;Remarks:135;P:35;Start:60;Stop:60;';
const row = (kHz: string, time: string, days: string, itu: string, station: string, lang: string, target: string, site = '', p = '1', a = '', z = '') =>
  [kHz, time, days, itu, station, lang, target, site, p, a, z].join(';');

const CSV = [
  HEAD,
  row('6000', '1600-1700', '', 'USA', 'Test Overseas Radio', 'R', 'UKR'),
  row('7000', '1600-1700', '', 'USA', 'Test Overseas Radio', 'R', 'UKR'),
  row('5000', '0000-2400', '', 'RUS', 'Test Marker X', '-CW', 'RUS', '', '91'),
  row('9000', '2300-0100', 'Mo-Fr', 'KRE', 'Test Peninsula Voice', 'E', 'Eu'),
  row('9100', '1200-1300', 'alt', 'KRE', 'Test Peninsula Voice', 'E', 'Eu'),
  row('9200', '1200-1300', '', 'BRA', 'Test Unrelated Radio', 'P', 'SAm'),
  row('9300', '1200-1300', '', 'IRN', 'Test Inactive', 'FS', 'ME', '', '8'),
  row('9400', '1200-1300', 'irr', 'IRN', 'Test Gulf Voice', 'A', 'ME', '/ARM', '6', '0111', '3112'),
].join('\r\n');

const README = [
  'D) Codes used.',
  '   I)   Language codes.',
  '   II)  Country codes.',
  '   I) Language codes.',
  '   -CW   Morse Station',
  '   E     English: UK (60m), USA (225m)                                       [eng]',
  '   R     Russian: Russia (137m)                                              [rus]',
  '   II) Country codes.',
  '   KRE  Korea, North (Democratic People\'s Republic)',
  '   IWA  Ogasawara (Bonin, Iwo Jima) *',
  '   III) Target-area codes.',
  '   E.. - East ..',
].join('\n');

describe('EiBi schedule', () => {
  it('keeps rows for the watch regions, merges frequencies, drops alternates and inactive rows', () => {
    const rows = parseEibiCsv(CSV);
    expect(rows.map((r) => r.station)).toEqual(['Test Overseas Radio', 'Test Marker X', 'Test Peninsula Voice', 'Test Gulf Voice']);
    expect(rows[0].kHz).toEqual([6000, 7000]);
    expect(rows[1].utility).toBe(true);
    expect(rows[3].dates).toEqual(['0111', '3112']);
    expect(swMode(rows[1])).toBe('cw');
    expect(swMode(rows[0])).toBe('am');
    const ee = shortwaveForRegion(rows, 'eastern-europe');
    expect(ee.to.map((r) => r.station)).toEqual(['Test Overseas Radio', 'Test Marker X']);
    expect(shortwaveForRegion(rows, 'korean-peninsula').from.map((r) => r.station)).toEqual(['Test Peninsula Voice']);
  });

  it('reads language and country names from the README', () => {
    expect(parseEibiCodes(README, 'languages')).toEqual({ '-CW': 'Morse Station', E: 'English: UK, USA', R: 'Russian: Russia' });
    expect(parseEibiCodes(README, 'countries')).toEqual({ KRE: "Korea, North (Democratic People's Republic)", IWA: 'Ogasawara (Bonin, Iwo Jima)' });
  });

  it('picks the season file and the one before', () => {
    expect(eibiSeasonFiles(Date.UTC(2026, 10, 23)).map((f) => f.file)).toEqual(['sked-b26.csv', 'sked-a26.csv']);
    expect(eibiSeasonFiles(Date.UTC(2027, 1, 1)).map((f) => f.file)).toEqual(['sked-b26.csv', 'sked-a26.csv']);
    expect(eibiSeasonFiles(Date.UTC(2027, 5, 1)).map((f) => f.file)).toEqual(['sked-a27.csv', 'sked-b26.csv']);
  });

  it('works out whether a row is scheduled now, including overnight rows and day rules', () => {
    expect(eibiWeekdays('')).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(eibiWeekdays('Mo-Fr')).toEqual([0, 1, 2, 3, 4]);
    expect(eibiWeekdays('We-Mo')).toEqual([0, 2, 3, 4, 5, 6]);
    expect(eibiWeekdays('Tu,Fr')).toEqual([1, 4]);
    expect(eibiWeekdays('SaSu')).toEqual([5, 6]);
    expect(eibiWeekdays('1245')).toEqual([0, 1, 3, 4]);
    expect(eibiWeekdays('irr')).toBeNull();
    const b = (start: string, end: string, days = ''): SwBroadcast => ({ kHz: [1], start, end, days, itu: 'X', station: 'S', lang: 'E', target: 'X', site: '', utility: false });
    // 2026-11-23 is a Monday.
    const mon = (h: number, m = 0) => Date.UTC(2026, 10, 23, h, m);
    expect(onAirNow(b('1600', '1700'), mon(16, 30))).toBe('yes');
    expect(onAirNow(b('1600', '1700'), mon(17))).toBe('no');
    expect(onAirNow(b('0000', '2400'), mon(5))).toBe('yes');
    expect(onAirNow(b('2300', '0100', 'Mo-Fr'), mon(0, 30))).toBe('no'); // began Sunday evening
    expect(onAirNow(b('2300', '0100', 'Mo-Fr'), Date.UTC(2026, 10, 24, 0, 30))).toBe('yes'); // began Monday evening
    expect(onAirNow(b('1600', '1700', 'irr'), mon(16, 30))).toBe('unknown');
    expect(onAirNow(b('1600', '1700', 'Sa'), mon(16, 30))).toBe('no');
    expect(sortForNow([b('0100', '0200'), b('1600', '1700'), b('1600', '1700', 'irr')], mon(16, 30)).map((x) => x.air)).toEqual(['yes', 'unknown', 'no']);
  });

  it('collects once a day, falls back to the previous season, and refuses a near-empty file', async () => {
    const NOW = Date.UTC(2026, 10, 23, 10);
    const urls: string[] = [];
    const fetch = async (u: string) => {
      urls.push(u);
      if (u.endsWith('sked-b26.csv')) throw new HttpError('HTTP 404', 404);
      if (u.endsWith('README.TXT')) return ok(README);
      return ok([HEAD, ...Array.from({ length: 250 }, (_, i) => row(String(3000 + i), '1600-1700', '', 'RUS', `Test Station ${i}`, 'R', 'EEu'))].join('\n'));
    };
    const r1 = await shortwaveSchedule.collect({ now: NOW, state: null, fetch });
    expect(urls).toEqual(['http://www.eibispace.de/dx/sked-b26.csv', 'http://www.eibispace.de/dx/sked-a26.csv', 'http://www.eibispace.de/dx/README.TXT']);
    expect(r1.state.latest.season).toBe('A26');
    expect(r1.state.latest.broadcasts).toHaveLength(250);
    expect(r1.state.latest.languages).toEqual({ R: 'Russian: Russia' });
    expect(r1.events).toEqual([]);
    const r2 = await shortwaveSchedule.collect({ now: NOW + 3_600_000, state: r1.state, fetch });
    expect(r2.notModified).toBe(true);
    await expect(shortwaveSchedule.collect({ now: NOW, state: null, fetch: async () => ok(CSV) })).rejects.toThrow(/only 4 rows/);
    expect(getSource('eibi-schedules')?.pollIntervalMinutes).toBe(1440);
  });
});

describe('local stations', () => {
  const st = (p: Record<string, unknown>) => ({ stationuuid: 'u1', name: 'Test FM', countrycode: 'UA', homepage: 'https://test-fm.invalid/', url_resolved: 'http://test-fm.invalid/live', tags: 'pop', clickcount: 5, lastcheckok: 1, ...p });

  it('keeps working stations with safe links, news first then most played', () => {
    const picked = pickLocalStations(
      [
        st({}),
        st({ stationuuid: 'u2', name: 'Test News', tags: 'news,talk', clickcount: 1 }),
        st({ stationuuid: 'u3', name: 'Test Broken', lastcheckok: 0 }),
        st({ stationuuid: 'u4', name: 'Test Elsewhere', countrycode: 'PL' }),
        st({ stationuuid: 'u5', name: 'Test Unsafe', homepage: 'javascript:alert(1)', url_resolved: 'http://user:pw@x.invalid/' }),
        st({ stationuuid: 'u6', name: 'test fm' }),
        st({ stationuuid: 'u7', name: 'Test Hits', clickcount: 50, homepage: '' }),
      ],
      'UA',
    );
    expect(picked.map((s) => s.name)).toEqual(['Test News', 'Test Hits', 'Test FM']);
    expect(picked[0].news).toBe(true);
    expect(picked[1].homepage).toBeNull();
    expect(cleanLinkUrl('http://user:pw@x.invalid/')).toBeNull();
    expect(pickLocalStations({ not: 'a list' }, 'UA')).toEqual([]);
    expect(localListenLinks(picked, ['XX', 'UA'])).toEqual([
      { kind: 'local', label: 'Local radio (UA): Test News — news', url: 'https://test-fm.invalid/' },
      { kind: 'local', label: 'Local radio (UA): Test Hits', url: 'http://test-fm.invalid/live' },
    ]);
  });

  it('searches each watch-region country on a server from the directory list, keeping old stations for a failed country', async () => {
    const NOW = Date.UTC(2026, 10, 23, 10);
    const urls: string[] = [];
    const fetch = async (u: string) => {
      urls.push(u);
      if (u.includes('/json/servers')) return ok(JSON.stringify([{ name: 'evil.example' }, { name: 'zz1.api.radio-browser.info' }]));
      const cc = /countrycode=([A-Z]{2})/.exec(u)![1];
      if (cc === 'PL') throw new HttpError('HTTP 503', 503);
      return ok(JSON.stringify([st({ countrycode: cc, stationuuid: `id-${cc}`, name: `Test ${cc}` })]));
    };
    const prev = { latest: { fetchedAt: new Date(NOW - 2 * 86_400_000).toISOString(), sourceUrl: 'x', stations: [{ uuid: 'old', name: 'Old PL', cc: 'PL', homepage: 'https://old.invalid/', stream: null, news: false, clicks: 1 }] } };
    const r = await localRadio.collect({ now: NOW, state: prev, fetch });
    expect(urls[1]).toMatch(/^https:\/\/zz1\.api\.radio-browser\.info\/json\/stations\/search\?countrycode=/);
    expect(urls).toHaveLength(LOCAL_RADIO_COUNTRIES.length + 1);
    expect(r.state.latest.stations.find((s) => s.cc === 'PL')?.name).toBe('Old PL');
    expect(r.state.latest.stations.find((s) => s.cc === 'UA')?.name).toBe('Test UA');
    await expect(localRadio.collect({ now: NOW, state: null, fetch: async () => { throw new HttpError('HTTP 503', 503); } })).rejects.toThrow(/no country search/);
  });

  it('a collection run writes the radio guide document, and does not rewrite it unchanged', async () => {
    const { runCollection } = await import('../pipeline.ts');
    const NOW = Date.UTC(2026, 10, 23, 10);
    const store = new MemoryStore();
    const fetch = async (u: string) => {
      if (u.includes('/json/servers')) return ok('[]');
      const cc = /countrycode=([A-Z]{2})/.exec(u)![1];
      return ok(JSON.stringify([st({ countrycode: cc, stationuuid: `id-${cc}`, name: `Test ${cc}` })]));
    };
    const adapter = { ...localRadio, collect: (ctx: Parameters<typeof localRadio.collect>[0]) => localRadio.collect({ ...ctx, fetch }) };
    await runCollection([adapter as never], store, { trigger: 'manual', now: () => NOW });
    const g = await store.getRadioGuide();
    expect(g?.shortwave).toBeNull();
    expect(g?.localRadio?.stations.length).toBe(LOCAL_RADIO_COUNTRIES.length);
    await runCollection([adapter as never], store, { trigger: 'manual', now: () => NOW + 1_800_000 });
    expect((await store.getRadioGuide())?.generatedAt).toBe(g?.generatedAt);
  });

  it('memory store keeps the radio guide', async () => {
    const s = new MemoryStore();
    expect(await s.getRadioGuide()).toBeNull();
    await s.putRadioGuide({ generatedAt: 'x', shortwave: null, localRadio: null });
    expect((await s.getRadioGuide())?.generatedAt).toBe('x');
  });
});
