import { describe, expect, it } from 'vitest';
import { compassPoint, formatLonLat, formatMeasurement, greatCircleKm, greatCirclePath, initialBearing, measure } from './measure';
import { decodeMapLink, encodeMapLink, validView, type LinkSettings } from './mapLink';
import { buildSearchIndex, searchMap } from './mapSearch';
import { DEFAULT_FILTERS } from './filters';
import { DEFAULT_SETTINGS } from '../state/SettingsContext';

describe('ruler maths', () => {
  it('measures great-circle distance and bearings', () => {
    // London Heathrow to New York JFK: about 5,540 km, initial bearing about 288°.
    const lhr: [number, number] = [-0.4614, 51.4775];
    const jfk: [number, number] = [-73.7781, 40.6413];
    expect(greatCircleKm(lhr, jfk)).toBeGreaterThan(5530);
    expect(greatCircleKm(lhr, jfk)).toBeLessThan(5560);
    expect(initialBearing(lhr, jfk)).toBeCloseTo(288.1, 0);
    // One degree of latitude along a meridian is about 111.2 km, due north.
    expect(greatCircleKm([10, 0], [10, 1])).toBeCloseTo(111.19, 1);
    expect(initialBearing([10, 0], [10, 1])).toBeCloseTo(0, 5);
    expect(initialBearing([10, 0], [11, 0])).toBeCloseTo(90, 5);
    const m = measure([10, 0], [10, 1]);
    expect(m.nm).toBeCloseTo(60.04, 1);
    expect(m.back).toBeCloseTo(180, 5);
    expect(formatMeasurement(m)).toBe('111 km · 60.0 nm · bearing 000° (N), back 180°');
    expect(compassPoint(359)).toBe('N');
    expect(compassPoint(225)).toBe('SW');
  });

  it('draws the path with continuous longitudes across the antimeridian', () => {
    const path = greatCirclePath([170, 50], [-170, 50], 10);
    expect(path).toHaveLength(11);
    expect(path[0][0]).toBeCloseTo(170);
    expect(path[10][0]).toBeCloseTo(190);
    for (let i = 1; i < path.length; i++) expect(Math.abs(path[i][0] - path[i - 1][0])).toBeLessThan(5);
    expect(greatCirclePath([1, 1], [1, 1])).toHaveLength(2);
  });

  it('formats positions', () => {
    expect(formatLonLat([56.3, 26.5667])).toBe('26.567°N 56.300°E');
    expect(formatLonLat([190, -10])).toBe('10.000°S 170.000°W');
  });
});

describe('shareable map links', () => {
  const settings = { ...DEFAULT_SETTINGS } as LinkSettings;

  it('round-trips view, layers, filters, selection and ruler', () => {
    const s = encodeMapLink({
      view: { lat: 26.56789, lon: 56.25, zoom: 5.123 },
      settings: { ...settings, aircraft: false, infrastructure: true, navWarnDays: 7, imagery: 'viirs', imageryDate: '2026-11-20', installationsOperator: 'US' },
      filters: { ...DEFAULT_FILTERS, regionId: 'middle-east', windowHours: null, categories: ['military', 'maritime'], keyword: 'tanker' },
      selection: { kind: 'base', key: 'wd:Q123' },
      ruler: [[56.1, 26.2], [57.5, 25.1]],
    });
    expect(s).toContain('at=26.568,56.25,5.12');
    expect(s).toContain('sel=base:wd:Q123');
    const d = decodeMapLink(`?${s}`)!;
    expect(d.view).toEqual({ lat: 26.568, lon: 56.25, zoom: 5.12 });
    expect(d.settings).toMatchObject({ aircraft: false, infrastructure: true, graticule: true, navWarnDays: 7, imagery: 'viirs', imageryDate: '2026-11-20', installationsOperator: 'US' });
    expect(d.filters).toEqual({ regionId: 'middle-east', windowHours: null, categories: ['military', 'maritime'], keyword: 'tanker' });
    expect(d.selection).toEqual({ kind: 'base', key: 'wd:Q123' });
    expect(d.ruler).toEqual([[56.1, 26.2], [57.5, 25.1]]);
  });

  it('writes only what differs from the defaults, and every layer can be off', () => {
    const all = Object.fromEntries(Object.keys(settings).map((k) => [k, typeof settings[k as keyof LinkSettings] === 'boolean' ? false : settings[k as keyof LinkSettings]])) as LinkSettings;
    const s = encodeMapLink({ view: null, settings: all, filters: DEFAULT_FILTERS, selection: null, ruler: null });
    expect(s).toBe('layers=-');
    expect(decodeMapLink(`?${s}`)!.settings.aircraft).toBe(false);
  });

  it('ignores links without map state, and drops bad or unknown values', () => {
    expect(decodeMapLink('')).toBeNull();
    expect(decodeMapLink('?utm_source=x')).toBeNull();
    const d = decodeMapLink('?at=95,10,3&region=atlantis&win=-5&cat=military,cooking&cls=secret&sel=missile:x&ruler=1,2&nav=9999&img=webcam&op=usa&layers=<script>')!;
    expect(d.view).toBeNull();
    expect(d.filters).toEqual({ categories: ['military'] });
    expect(d.selection).toBeNull();
    expect(d.ruler).toBeNull();
    expect(d.settings).toEqual({});
    expect(decodeMapLink('?at=10,200,40')!.view).toEqual({ lat: 10, lon: -160, zoom: 12 });
    expect(decodeMapLink(`?q=${'x'.repeat(300)}`)!.filters.keyword).toHaveLength(100);
  });

  it('accepts only a sane remembered view', () => {
    expect(validView({ lat: 10, lon: 20, zoom: 3 })).toEqual({ lat: 10, lon: 20, zoom: 3 });
    expect(validView({ lat: 'x', lon: 20, zoom: 3 })).toBeNull();
    expect(validView(null)).toBeNull();
  });
});

describe('map search', () => {
  const index = buildSearchIndex({
    worldBases: [{ q: 'Q1', n: 'Camp Lemonnier', la: 11.55, lo: 43.15, c: 'DJ', o: [], oc: ['US'], k: [], w: null } as never],
    aircraft: [{ hex: 'ae1234', cs: 'RCH123 ', reg: '05-5140', t: 'C17', cls: 'airlift', la: 30, lo: 40, alt: 30000, gs: 400 } as never],
    ships: [{ mmsi: '273000000', imo: '9000001', listedName: 'TEST TANKER', aisName: 'TEST T', lists: [], programs: [], matchedBy: 'imo', la: 55, lo: 20, sog: 0, cog: 0, destination: 'PRIMORSK' } as never],
    airports: [{ icao: 'OMDB', lat: 25.25, lon: 55.36, region: 'AE-DU', name: 'Dubai International Airport' }],
  });

  it('finds bases, callsigns, registrations, ship identifiers, airports and regions', () => {
    expect(searchMap(index, 'lemon')[0]).toMatchObject({ kind: 'base', select: { kind: 'base', key: 'wd:Q1' } });
    expect(searchMap(index, 'rch123')[0]).toMatchObject({ kind: 'aircraft', label: 'RCH123', select: { kind: 'air', key: 'ae1234' } });
    expect(searchMap(index, '05-5140')[0].kind).toBe('aircraft');
    expect(searchMap(index, '9000001')[0]).toMatchObject({ kind: 'ship', select: { kind: 'listed', key: '9000001' } });
    expect(searchMap(index, 'primorsk')[0].kind).toBe('ship');
    expect(searchMap(index, 'omdb')[0]).toMatchObject({ kind: 'airport', select: null });
    expect(searchMap(index, 'dubai intl')).toEqual([]); // every word must match
    expect(searchMap(index, 'red sea')[0]).toMatchObject({ kind: 'region', regionId: 'red-sea' });
    expect(searchMap(index, 'x')).toEqual([]);
  });
});
