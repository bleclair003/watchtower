// @vitest-environment node
/**
 * Military aircraft (ADS-B). The fixture is a real adsb.lol /v2/mil response captured on
 * 2026-11-21 08:22 UTC; synthetic aircraft are added where a case needs one.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { FetchResult } from '../lib/http.ts';
import { HttpError } from '../lib/http.ts';
import { aircraftEvents, militaryAircraft, parseMilitaryAircraft, AIRCRAFT_SOURCE_ID } from '../adapters/militaryAircraft.ts';
import { aircraftClassOf, aircraftRole, type AircraftSnapshot } from '../../shared/domain/aircraft.ts';
import { validateEvent } from '../lib/validate.ts';
import { INDICATOR_CATALOG, validateCatalog } from '../../shared/domain/indicators/catalog.ts';
import { evaluateIndicator } from '../../shared/domain/indicators/evaluate.ts';
import { getSource } from '../../shared/domain/sources.ts';

const NOW = Date.parse('2026-11-21T08:22:00Z');
const body = readFileSync(new URL('./fixtures/adsb-mil.sample.json', import.meta.url), 'utf8');
const ok = (b: string): FetchResult => ({ kind: 'ok', status: 200, body: b, bytes: b.length, validators: {} });
const raw = (p: Record<string, unknown>) => ({ hex: 'ae0001', flight: 'TEST01 ', t: 'K35R', lat: 30, lon: 45, alt_baro: 30000, gs: 420, track: 90, seen_pos: 1, emergency: 'none', ...p });
const withExtra = (...extra: Record<string, unknown>[]) => {
  const d = JSON.parse(body);
  d.ac.push(...extra);
  return JSON.stringify(d);
};

describe('military aircraft parsing (real adsb.lol response)', () => {
  const p = parseMilitaryAircraft(body);

  it('keeps airborne, recent positions only', () => {
    expect(p.totalMarked).toBe(76);
    expect(p.aircraft.length).toBeGreaterThan(30);
    expect(p.aircraft.length).toBeLessThan(45);
    for (const a of p.aircraft) {
      expect(a.age).toBeLessThanOrEqual(120);
      expect(a.t).not.toBe('TWR');
      expect(a.cs ?? '').not.toMatch(/^TEST/);
    }
    const c17 = p.aircraft.find((a) => a.cs === 'RCH4123')!;
    expect(c17).toMatchObject({ hex: 'ae1448', t: 'C17', cls: 'airlift', alt: 33000, gs: 492, trk: 74, em: null });
  });

  it('drops ground, stale, test and position-less aircraft', () => {
    const q = parseMilitaryAircraft(
      JSON.stringify({ ac: [raw({ alt_baro: 'ground' }), raw({ seen_pos: 600 }), raw({ flight: 'TEST1234' }), raw({ lat: undefined }), raw({ hex: 'zz', flight: 'X' }), raw({ flight: 'GOLD11 ' })] }),
    );
    expect(q.aircraft.map((a) => a.cs)).toEqual(['GOLD11']);
    expect(q.dropped).toBe(5);
  });

  it('fails loudly on an unknown layout', () => {
    expect(() => parseMilitaryAircraft('{"aircraft":[]}')).toThrow(/no "ac" array/);
  });

  it('classifies by ICAO type; shared airliner types stay "other"', () => {
    expect(aircraftClassOf('K35R')).toBe('tanker');
    expect(aircraftClassOf('R135')).toBe('isr');
    expect(aircraftClassOf('B52')).toBe('bomber');
    expect(aircraftClassOf('A400')).toBe('airlift');
    expect(aircraftClassOf('A332')).toBe('other'); // could be an MRTT tanker or a VIP jet
    expect(aircraftClassOf(null)).toBe('other');
  });
});

describe('military aircraft records', () => {
  const snap = (b: string): AircraftSnapshot => {
    const p = parseMilitaryAircraft(b);
    return { fetchedAt: new Date(NOW).toISOString(), provider: 'adsb.lol', totalMarked: p.totalMarked, aircraft: p.aircraft };
  };

  it('records notable aircraft over watch countries or open water, once per aircraft, area and day', () => {
    const events = aircraftEvents(snap(body), NOW);
    // R215 (C-295) near Manila is over a watch country (PH). RCH341 (C-17) over Slovakia is inside the
    // Eastern Europe box but over a non-watch country, so it is not recorded. US airlift is not recorded.
    expect(events.map((e) => [e.regionIds[0], e.metadata?.callsign])).toEqual([['south-china-sea', 'R215']]);
    const e = events[0];
    expect(validateEvent(e, NOW)).toBeNull();
    expect(e).toMatchObject({ sourceId: AIRCRAFT_SOURCE_ID, category: 'military', locationPrecision: 'exact', countryCodes: ['PH'], sourceUrl: 'https://globe.adsb.lol/?icao=758725' });
    expect(e.title).toBe('Military airlift aircraft seen: C-295 R215 — SCS watch area');
    expect(e.summary).toMatch(/Only aircraft that broadcast are seen/);
    expect(aircraftEvents(snap(body), NOW + 3_600_000)[0].id).toBe(e.id);
    expect(aircraftEvents(snap(body), NOW + 86_400_000)[0].id).not.toBe(e.id);
  });

  it('uses watch countries and open water, not the whole watch box', () => {
    const cases: [string, number, number, string[]][] = [
      ['AUSTRIA', 48.04, 16.59, []], // the real IAM4613 position: Eastern Europe box, but Austria
      ['HUNGARY', 47.5, 19.0, []],
      ['POLAND', 50.0, 21.0, ['eastern-europe']],
      ['BLKSEA', 43.8, 32.0, ['eastern-europe']], // open water (Black Sea, inside the box)
      ['KALININ', 54.7, 20.5, ['eastern-europe']], // Russia, inside the box
      ['SIBERIA', 55.0, 90.0, []], // Russia, outside the box
      ['HARGEISA', 10.6, 44.0, ['red-sea']], // Somaliland (inland, inside the box) counts with Somalia
      ['SINAI', 29.5, 33.8, []], // Egypt
      ['ALASKA', 64.8, -147.7, ['united-states']], // Fairbanks: US borders, outside the contiguous-US box
    ];
    const extra = cases.map(([f, la, lo], i) => raw({ hex: `ae0${(0xa0 + i).toString(16)}0`.slice(0, 6), flight: f, lat: la, lon: lo }));
    const events = aircraftEvents(snap(withExtra(...extra)), NOW);
    for (const [f, , , regions] of cases) {
      expect([f, events.filter((e) => e.metadata?.callsign === f).map((e) => e.regionIds[0])]).toEqual([f, regions]);
    }
  });

  it('identifies US command posts and VIP transports (live callsigns of 2026-11-21)', () => {
    expect(aircraftRole({ t: 'GLF5', cs: 'SAM928', reg: '20-1949' })).toBe('vip');
    expect(aircraftRole({ t: 'GLF5', cs: 'SPAR81', reg: '01-0030' })).toBe('vip');
    expect(aircraftRole({ t: 'E6', cs: 'GOTO87', reg: '164386' })).toBe('command');
    expect(aircraftRole({ t: 'B742', cs: null, reg: '73-1676' })).toBe('command'); // E-4B by serial
    expect(aircraftRole({ t: 'B742', cs: null, reg: 'EP-NHJ' })).toBeNull(); // another 747-200
    expect(aircraftRole({ t: 'B752', cs: 'SAMSON1', reg: null })).toBeNull(); // not a SAM number
    expect(aircraftRole({ t: 'C17', cs: 'RCH144', reg: null })).toBeNull();
  });

  it('records VIP transports even over the US (where routine airlift is skipped), with their role', () => {
    const events = aircraftEvents(snap(withExtra(raw({ hex: 'ae0010', flight: 'SAM928', t: 'GLF5', lat: 38.8, lon: -77.0 }), raw({ hex: 'ae0011', flight: 'RCH9', t: 'C17', lat: 38.8, lon: -77.0 }))), NOW);
    const vip = events.find((e) => e.metadata?.callsign === 'SAM928')!;
    expect(vip.title).toMatch(/^Government VIP transport seen:/);
    expect(vip.metadata?.aircraftRole).toBe('vip');
    expect(vip.metadata?.aircraftClass).toBe('other'); // never counted by the tanker/airlift indicators
    expect(events.some((e) => e.metadata?.callsign === 'RCH9')).toBe(false);
  });

  it('records tankers over the US and over open water in a watch box', () => {
    const events = aircraftEvents(snap(withExtra(raw({ hex: 'ae0002', flight: 'PACK21', lat: 38.9, lon: -97.4 }), raw({ hex: 'ae0003', flight: 'ETHYL51', lat: 26.6, lon: 52.2 }))), NOW);
    const us = events.find((e) => e.metadata?.callsign === 'PACK21')!;
    expect(us.regionIds).toEqual(['united-states']);
    expect(us.countryCodes).toEqual(['US']);
    const gulf = events.find((e) => e.metadata?.callsign === 'ETHYL51')!;
    expect(gulf.regionIds).toEqual(['middle-east']);
    expect(gulf.countryCodes).toEqual([]); // over the Gulf, not inside a country
  });
});

describe('military aircraft adapter', () => {
  it('stores the latest positions and falls back to adsb.fi', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.includes('adsb.lol')) throw new HttpError('HTTP 429', 429);
      return ok(body);
    });
    const r = await militaryAircraft.collect({ now: NOW, state: null, fetch });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(r.state.latest.provider).toBe('adsb.fi');
    expect(r.state.latest.aircraft.length).toBeGreaterThan(30);
    expect(r.events[0].sourceUrl).toBe('https://globe.adsb.fi/?icao=758725');
  });

  it('fails when every provider fails', async () => {
    await expect(militaryAircraft.collect({ now: NOW, state: null, fetch: async () => { throw new HttpError('HTTP 503', 503); } })).rejects.toThrow(/all military aircraft providers failed/);
  });

  it('puts the positions in the dashboard snapshot', async () => {
    const { runCollection } = await import('../pipeline.ts');
    const { MemoryStore } = await import('../store/memory.ts');
    const store = new MemoryStore();
    const adapter = { ...militaryAircraft, collect: (ctx: Parameters<typeof militaryAircraft.collect>[0]) => militaryAircraft.collect({ ...ctx, fetch: async () => ok(body) }) };
    const { snapshot } = await runCollection([adapter as never], store, { trigger: 'manual', now: () => NOW });
    expect(snapshot.aircraft?.provider).toBe('adsb.lol');
    expect(snapshot.aircraft?.aircraft.length).toBeGreaterThan(30);
  });

  it('is registered, with terms recorded', () => {
    const s = getSource(AIRCRAFT_SOURCE_ID)!;
    expect(s.termsNotes).toMatch(/ODbL/);
    expect(s.termsNotes).toMatch(/adsb\.fi/);
  });
});

describe('air-activity indicators', () => {
  it('are valid, experimental (no RAI weight), and there is no airlift indicator for the US', () => {
    const defs = INDICATOR_CATALOG.filter((d) => d.requiredSourceIds.includes(AIRCRAFT_SOURCE_ID));
    expect(validateCatalog(defs)).toEqual([]);
    expect(defs.length).toBe(20); // 7 strategic-air, 6 airlift, 7 air-patterns (v0.63.0)
    expect(defs.every((d) => d.experimental && d.weight === 0)).toBe(true);
    expect(defs.some((d) => d.id === 'united-states.airlift')).toBe(false);
  });

  it('counts tankers, surveillance and bombers in the region', () => {
    const extra = [0, 1, 2, 3, 4, 5].map((i) => raw({ hex: `ae01${i}0`, flight: `TANKER${i}`, lat: 30 + i * 0.1, lon: 45 }));
    const p = parseMilitaryAircraft(withExtra(...extra));
    const events = aircraftEvents({ fetchedAt: new Date(NOW).toISOString(), provider: 'adsb.lol', totalMarked: p.totalMarked, aircraft: p.aircraft }, NOW);
    const iso = (t: number) => new Date(t).toISOString();
    const status = [{ sourceId: AIRCRAFT_SOURCE_ID, health: 'ONLINE' as const, lastAttemptAt: iso(NOW), lastSuccessAt: iso(NOW), firstSuccessAt: iso(NOW - 864e5), lastNewItemAt: iso(NOW), consecutiveFailures: 0, parseErrors: 0, lastError: null }];
    const me = INDICATOR_CATALOG.find((d) => d.id === 'middle-east.strategic-air')!;
    const ee = INDICATOR_CATALOG.find((d) => d.id === 'eastern-europe.strategic-air')!;
    expect(evaluateIndicator(me, events, status, NOW).state).toBe('TRIGGERED'); // 6 tankers (Iraq)
    expect(evaluateIndicator(ee, events, status, NOW).state).toBe('NORMAL'); // the C-17 is airlift
  });
});
