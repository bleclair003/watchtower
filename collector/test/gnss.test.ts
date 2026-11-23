// @vitest-environment node
/** GPS interference from aircraft position accuracy (v0.69.0). Aircraft are invented. */
import { describe, expect, it } from 'vitest';
import { GNSS_CIRCLES, cellKey, gnssLevel, readAircraft, type RawGnssAircraft } from '../../shared/domain/gnss.ts';
import { collectGnss, unpackHours, type GnssState } from '../adapters/gnssInterference.ts';
import { validateEvent } from '../lib/validate.ts';
import { HttpError, type FetchResult } from '../lib/http.ts';

const H = 3_600_000;
const T0 = Date.parse('2026-11-23T10:05:00Z');
const ok = (body: string): FetchResult => ({ kind: 'ok', status: 200, body, validators: {}, bytes: body.length });
const noSleep = async () => {};

const plane = (hex: string, lat: number, lon: number, p: Partial<RawGnssAircraft> = {}): RawGnssAircraft => ({
  hex, type: 'adsb_icao', version: 2, nac_p: 10, nic: 8, alt_baro: 35000, lat, lon, seen_pos: 1, flight: `T${hex} `, ...p,
});

/** 20 aircraft in the Baltic square 55|20; `bad` of them degraded, two of those flagged as having lost GPS. */
function baltic(bad: number, at: number): RawGnssAircraft[] {
  return Array.from({ length: 20 }, (_, i) =>
    plane(`b${i}`, 55.2 + i * 0.01, 20.3, i < bad ? (i < 2 ? { nac_p: 0, nic: 0, gpsOkBefore: (at - 600_000) / 1000, gpsOkLat: 54.9, gpsOkLon: 19.8 } : { nac_p: 4 }) : {}),
  );
}

function fetcher(aircraft: RawGnssAircraft[], opts: { failLol?: boolean; failAll?: boolean } = {}) {
  const urls: string[] = [];
  const fetch = async (u: string) => {
    urls.push(u);
    if (opts.failAll || (opts.failLol && u.includes('adsb.lol'))) throw new HttpError('HTTP 429', 429);
    // The Baltic circle returns the aircraft; the Gulf of Finland circle overlaps and returns one of them again.
    if (u.includes('/55.5/20.5/')) return ok(JSON.stringify({ ac: aircraft }));
    if (u.includes('/lat/55.5/lon/20.5/')) return ok(JSON.stringify({ ac: aircraft }));
    if (u.includes('/59.5/26.5/') || u.includes('/lat/59.5/')) return ok(JSON.stringify({ ac: aircraft.slice(0, 1) }));
    return ok(JSON.stringify({ ac: [] }));
  };
  return { fetch, urls };
}

describe('aircraft position accuracy', () => {
  it('counts only airborne ADS-B version 2 aircraft with a fresh position', () => {
    expect(readAircraft(plane('a', 55, 20))).toEqual({ status: 'ok', lat: 55, lon: 20 });
    expect(readAircraft(plane('a', 55, 20, { nac_p: 7 }))?.status).toBe('degraded');
    expect(readAircraft(plane('a', 55, 20, { nac_p: 0, gpsOkBefore: 1 }))?.status).toBe('lost');
    expect(readAircraft(plane('a', 55, 20, { type: 'mlat' }))).toBeNull();
    expect(readAircraft(plane('a', 55, 20, { version: 1 }))).toBeNull();
    expect(readAircraft(plane('a', 55, 20, { alt_baro: 'ground' }))).toBeNull();
    expect(readAircraft(plane('a', 55, 20, { alt_baro: 500 }))).toBeNull();
    expect(readAircraft(plane('a', 55, 20, { seen_pos: 90 }))).toBeNull();
    expect(readAircraft(plane('a', 55, 20, { nac_p: undefined }))).toBeNull();
    expect(cellKey(55.9, -0.2)).toBe('55|-1');
    expect([gnssLevel(0, 10), gnssLevel(1, 40), gnssLevel(2, 20)]).toEqual(['low', 'medium', 'high']);
  });
});

describe('GPS interference collector', () => {
  it('samples every circle, counts an aircraft once, and keeps squares, lost points and hourly buckets', async () => {
    const { fetch, urls } = fetcher(baltic(6, T0));
    const r = await collectGnss({ now: T0, state: null, fetch }, { sleep: noSleep });
    expect(urls).toHaveLength(GNSS_CIRCLES.length);
    expect(r.itemsSeen).toBe(21);
    const sq = r.state.latest.cells.find((c) => c.k === '55|20')!;
    expect(sq).toMatchObject({ n: 20, bad: 6, lost: 2, level: 'high', regionIds: ['eastern-europe'] });
    expect(r.state.latest.lost).toHaveLength(2);
    expect(r.state.latest.lost[0]).toMatchObject({ la: 54.9, lo: 19.8, cs: 'Tb0' });
    expect(r.state.latest.provider).toBe('adsb.lol');
    expect(r.state.latest.failed).toEqual([]);
    // No records on the first day: there is nothing to compare with.
    expect(r.events).toEqual([]);
    expect(unpackHours(r.state.hours['55|20'])).toEqual([{ h: Math.floor(T0 / H), n: 20, bad: 6, lost: 2 }]);
  });

  it('waits about an hour between samples, and a second sample in the same hour replaces the first', async () => {
    const first = await collectGnss({ now: T0, state: null, fetch: fetcher(baltic(6, T0)).fetch }, { sleep: noSleep });
    const skipped = await collectGnss({ now: T0 + 20 * 60_000, state: first.state, fetch: fetcher(baltic(0, T0)).fetch }, { sleep: noSleep });
    expect(skipped.notModified).toBe(true);
    const forced = { ...first.state, lastSampleAt: new Date(T0 - 2 * H).toISOString() };
    const again = await collectGnss({ now: T0 + 30 * 60_000, state: forced, fetch: fetcher(baltic(1, T0)).fetch }, { sleep: noSleep });
    expect(unpackHours(again.state.hours['55|20'])).toEqual([{ h: Math.floor(T0 / H), n: 20, bad: 1, lost: 1 }]);
  });

  it('falls back to adsb.fi per circle, and fails only when no circle answers', async () => {
    const { fetch, urls } = fetcher(baltic(6, T0), { failLol: true });
    const r = await collectGnss({ now: T0, state: null, fetch }, { sleep: noSleep });
    expect(urls.filter((u) => u.includes('adsb.fi'))).toHaveLength(GNSS_CIRCLES.length);
    expect(r.state.latest.provider).toBe('adsb.fi');
    expect(r.state.latest.cells.find((c) => c.k === '55|20')?.n).toBe(20);
    await expect(collectGnss({ now: T0, state: null, fetch: fetcher([], { failAll: true }).fetch }, { sleep: noSleep })).rejects.toThrow(/No circle could be sampled/);
  });

  it('records a region once a day when a square newly turns high, after a day of history', async () => {
    let state: GnssState | null = null;
    // Day 1: quiet Baltic, hourly.
    for (let h = 0; h < 25; h++) {
      const r = await collectGnss({ now: T0 + h * H, state, fetch: fetcher(baltic(0, T0 + h * H)).fetch }, { sleep: noSleep });
      expect(r.events).toEqual([]);
      state = r.state;
    }
    // Day 2: jamming starts.
    const t1 = T0 + 25 * H;
    const jam = await collectGnss({ now: t1, state, fetch: fetcher(baltic(8, t1)).fetch }, { sleep: noSleep });
    expect(jam.events).toHaveLength(1);
    const ev = jam.events[0];
    expect(ev.title).toBe('GPS interference: degraded aircraft positions over Eastern Europe / Ukraine (1 area at 10%+)');
    expect(ev.summary).toMatch(/In the worst hourly sample of the last 6 hours, 8 of 20 aircraft sightings/);
    expect(ev).toMatchObject({ regionIds: ['eastern-europe'], locationPrecision: 'region', category: 'aviation' });
    expect(ev.metadata).toMatchObject({ subtype: 'gnss-interference', squares: 1, degraded: 8, lost: 2 });
    expect(validateEvent(ev, t1)).toBeNull();
    // The next hour, the same day: nothing new.
    const t2 = t1 + H;
    const later = await collectGnss({ now: t2, state: jam.state, fetch: fetcher(baltic(10, t2)).fetch }, { sleep: noSleep });
    expect(later.events).toEqual([]);
  });

  it('does not record a square that was already high the day before', async () => {
    let state: GnssState | null = null;
    for (let h = 0; h < 26; h++) {
      const r = await collectGnss({ now: T0 + h * H, state, fetch: fetcher(baltic(10, T0 + h * H)).fetch }, { sleep: noSleep });
      if (h >= 24) expect(r.events).toEqual([]);
      state = r.state;
    }
    // Buckets older than 48 hours are dropped.
    const t = T0 + 80 * H;
    const r = await collectGnss({ now: t, state, fetch: fetcher(baltic(0, t)).fetch }, { sleep: noSleep });
    expect(unpackHours(r.state.hours['55|20'])).toHaveLength(1);
    expect(r.state.latest.lost).toEqual([]);
  });
});
