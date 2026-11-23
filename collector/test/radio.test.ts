// @vitest-environment node
/** Radio listening links (Phase 28). Receivers and addresses are invented (reserved .invalid / documentation IPs). */
import { describe, expect, it } from 'vitest';
import type { FetchResult } from '../lib/http.ts';
import {
  RADIO_FREQUENCIES, broadcastifyState, cleanReceiverUrl, frequenciesFor, kiwiTuneUrl, listenLinks, listenPoint, nearestReceivers,
  parseKiwiList, suggestedNow, twenteTuneUrl, unpackAirports, type RadioReceiver,
} from '../../shared/domain/radio.ts';
import { AIRPORTS_PACKED } from '../../shared/domain/airportsData.ts';
import { radioReceivers } from '../adapters/radioReceivers.ts';
import { getSource } from '../../shared/domain/sources.ts';

const entry = (p: Record<string, string>) => ({ status: 'active', offline: 'no', name: 'Test receiver', bands: '0-30000000', users_max: '4', gps: '(52.000000, 5.000000)', url: 'http://192.0.2.1:8073', ...p });
const listJs = (entries: object[]) =>
  `// KiwiSDR.com receiver list for dyatlov map maker\n// KiwiSDR.com data timestamp: Sunday, 22-Nov-2026 23:28:17 GMT\n\nvar kiwisdr_com =\n[\n${entries.map((e) => `\t${JSON.stringify(e)},`).join('\n')}\n]\n;`;
const ok = (b: string): FetchResult => ({ kind: 'ok', status: 200, body: b, validators: {}, bytes: b.length });

describe('receiver list', () => {
  it('parses the list with trailing commas and drops offline, unplaced or unsafe receivers', () => {
    const { receivers, listTime } = parseKiwiList(
      listJs([
        entry({}),
        entry({ offline: 'yes' }),
        entry({ gps: '(0.000000, 0.000000)' }),
        entry({ url: 'javascript:alert(1)' }),
        entry({ url: 'http://user:pw@198.51.100.7:8073/admin?x=1', name: 'Second' }),
      ]),
    );
    expect(listTime).toBe('2026-11-22T23:28:17.000Z');
    expect(receivers).toEqual([{ name: 'Test receiver', url: 'http://192.0.2.1:8073', lat: 52, lon: 5, minKhz: 0, maxKhz: 30_000, slots: 4 }]);
    expect(cleanReceiverUrl('http://198.51.100.7:8073/admin?x=1')).toBe('http://198.51.100.7:8073');
    expect(cleanReceiverUrl('ftp://x.invalid')).toBeNull();
    expect(() => parseKiwiList('nothing here')).toThrow();
  });

  it('finds the nearest receivers that cover the band, and builds tuned links', () => {
    const rx = (url: string, lat: number, lon: number, maxKhz = 30_000): RadioReceiver => ({ name: url, url, lat, lon, minKhz: 0, maxKhz, slots: 4 });
    const list = [rx('http://far.invalid', 0, 100), rx('http://near.invalid', 52, 5), rx('http://low.invalid', 52.1, 5, 5000)];
    expect(nearestReceivers(list, 52, 5, [8992]).map((r) => r.url)).toEqual(['http://near.invalid', 'http://far.invalid']);
    expect(kiwiTuneUrl(list[1], 8992, 'usb')).toBe('http://near.invalid/?f=8992usb');
    expect(twenteTuneUrl(4625, 'usb')).toBe('http://websdr.ewi.utwente.nl:8901/?tune=4625usb');
  });

  it('fetches once a day and makes no records', async () => {
    const many = Array.from({ length: 60 }, (_, i) => entry({ url: `http://192.0.2.${i + 1}:8073`, gps: `(${10 + i * 0.5}, 5)` }));
    let calls = 0;
    const fetch = async () => {
      calls++;
      return ok(listJs(many));
    };
    const NOW = Date.parse('2026-11-23T00:00:00Z');
    const r1 = await radioReceivers.collect({ now: NOW, state: null, fetch });
    expect(r1.events).toEqual([]);
    expect(r1.state.latest.receivers).toHaveLength(60);
    const r2 = await radioReceivers.collect({ now: NOW + 3_600_000, state: r1.state, fetch });
    expect(r2.notModified).toBe(true);
    expect(calls).toBe(1);
    await radioReceivers.collect({ now: NOW + 25 * 3_600_000, state: r1.state, fetch });
    expect(calls).toBe(2);
    await expect(radioReceivers.collect({ now: NOW, state: null, fetch: async () => ok(listJs([entry({})])) })).rejects.toThrow(/only 1/);
    expect(getSource('kiwisdr-receivers')?.pollIntervalMinutes).toBe(1440);
  });
});

describe('frequencies', () => {
  it('every frequency cites an https source and sits in the shortwave range', () => {
    for (const f of RADIO_FREQUENCIES) {
      expect(f.sources.length).toBeGreaterThan(0);
      for (const s of f.sources) expect(s.url).toMatch(/^https:\/\//);
      for (const k of f.kHz) expect(k > 1600 && k < 30_000).toBe(true);
    }
  });

  it('shows global entries everywhere and regional ones only in their region', () => {
    expect(frequenciesFor(null).some((f) => f.id === 'uvb-76')).toBe(false);
    expect(frequenciesFor('eastern-europe').some((f) => f.id === 'uvb-76')).toBe(true);
    expect(frequenciesFor('middle-east').filter((f) => f.regions !== 'global').map((f) => f.id)).toEqual(['mid-hf', 'mid-volmet']);
    for (const r of ['red-sea', 'korean-peninsula', 'taiwan-strait', 'south-china-sea']) expect(frequenciesFor(r).some((f) => f.regions !== 'global')).toBe(true);
    expect(frequenciesFor('united-states').every((f) => f.regions === 'global')).toBe(true);
    const ship = RADIO_FREQUENCIES.find((f) => f.id === 'maritime-distress')!;
    expect(listenPoint(ship, 'red-sea')).toEqual([19.25, 42]);
  });

  it('suggests the day or night frequency by UTC hour', () => {
    const hfgcs = RADIO_FREQUENCIES.find((f) => f.id === 'hfgcs')!;
    expect(suggestedNow(hfgcs, Date.parse('2026-11-22T18:00:00Z'))).toBe(11175);
    expect(suggestedNow(hfgcs, Date.parse('2026-11-22T03:00:00Z'))).toBe(4724);
    expect(suggestedNow(RADIO_FREQUENCIES.find((f) => f.id === 'maritime-distress')!, 0)).toBeNull();
  });
});

describe('listening links on records', () => {
  const airports = unpackAirports(AIRPORTS_PACKED);
  const rx: RadioReceiver[] = [{ name: 'Test Ireland', url: 'http://192.0.2.9:8073', lat: 53, lon: -8, minKhz: 0, maxKhz: 30_000, slots: 4 }];

  it('has thousands of airports, with JFK and Heathrow', () => {
    expect(airports.length).toBeGreaterThan(2000);
    expect(airports.find((a) => a.icao === 'KJFK')?.region).toBe('US-NY');
    expect(airports.find((a) => a.icao === 'EGLL')?.region).toBe('GB-ENG');
  });

  it('links aircraft in the US to LiveATC and the state scanner page', () => {
    const l = listenLinks({ lat: 40.7, lon: -73.9, aviation: true }, airports, rx);
    expect(l.map((x) => x.kind)).toEqual(['atc', 'scanner']);
    expect(l[0].url).toMatch(/^https:\/\/www\.liveatc\.net\/search\/\?icao=K[A-Z]{3}$/);
    expect(l[1].url).toBe('https://www.broadcastify.com/listen/stid/36');
    // Not an aircraft: scanners only.
    expect(listenLinks({ lat: 40.7, lon: -73.9, aviation: false }, airports, rx).map((x) => x.kind)).toEqual(['scanner']);
  });

  it('explains that the UK has no ATC feeds', () => {
    const l = listenLinks({ lat: 51.47, lon: -0.45, aviation: true }, airports, rx);
    expect(l).toHaveLength(1);
    expect(l[0].note).toMatch(/UK law/);
  });

  it('offers North Atlantic HF for aircraft far out over the ocean, and nothing in the middle of nowhere', () => {
    const l = listenLinks({ lat: 52, lon: -35, aviation: true }, airports, rx);
    expect(l).toEqual([expect.objectContaining({ kind: 'hf', url: 'http://192.0.2.9:8073/?f=8906usb' })]);
    expect(listenLinks({ lat: -40, lon: -120, aviation: true }, airports, rx)).toEqual([]);
  });

  it('maps US states to Broadcastify state pages', () => {
    expect(broadcastifyState('US-CA')).toEqual({ name: 'California', url: 'https://www.broadcastify.com/listen/stid/6' });
    expect(broadcastifyState('GB-ENG')).toBeNull();
  });
});
