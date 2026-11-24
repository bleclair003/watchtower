import { describe, expect, it } from 'vitest';
import { convergenceRecord, CONVERGENCE_SOURCE_ID } from '../lib/convergenceRecords.ts';
import { validateEvent } from '../lib/validate.ts';
import { matches, type Condition } from '../../shared/domain/indicators/conditions.ts';
import type { Hotspot } from '../../shared/domain/convergence.ts';
import type { CountryHotspot } from '../../shared/domain/countryConvergence.ts';

const NOW = Date.parse('2026-11-24T12:00:00Z');
const iso = new Date(NOW).toISOString();

const point: Hotspot = {
  id: 'ship-dark|abc',
  lat: 59.6,
  lon: 24.1,
  radiusKm: 120,
  level: 'strong',
  types: [
    { type: 'ship-dark', label: 'Ship went dark', role: 'anomaly', feed: 'ais', count: 2 },
    { type: 'nav-warning', label: 'Navigational warning', role: 'anomaly', feed: 'nga', count: 1 },
    { type: 'gnss', label: 'GPS interference (high)', role: 'anomaly', feed: 'adsb', count: 1 },
  ],
  feeds: ['adsb', 'ais', 'nga'],
  first: '2026-11-23T10:00:00.000Z',
  last: iso,
  regionIds: ['eastern-europe'],
  signals: [{ type: 'ship-dark', title: 'Invented', sourceId: 'ais-shipping', at: iso, lat: 59.6, lon: 24.1, url: 'https://example.test/1', eventId: 'e1', regionIds: ['eastern-europe'] }],
  signalCount: 4,
};
const country: CountryHotspot = {
  country: 'IR',
  level: 'watch',
  types: [
    { type: 'outage', label: 'Internet outage', role: 'anomaly', feed: 'ioda', count: 1 },
    { type: 'routing', label: 'Routing hijack or leak (not routine)', role: 'anomaly', feed: 'bgp', count: 1 },
  ],
  feeds: ['bgp', 'ioda'],
  first: '2026-11-23T10:00:00.000Z',
  last: iso,
  regionIds: ['middle-east'],
  signals: [{ type: 'outage', feed: 'ioda', role: 'anomaly', title: 'Invented', sourceId: 'ioda-outages', at: iso, url: 'https://example.test/2', eventId: 'e2' }],
  signalCount: 2,
};

describe('convergence records', () => {
  it('builds valid records for map and country hotspots, matched by the STRONG preset', () => {
    const p = convergenceRecord({ kind: 'point', change: 'new', hotspot: point, firstAt: iso }, iso);
    expect(validateEvent(p, NOW)).toBeNull();
    expect(p).toMatchObject({ sourceId: CONVERGENCE_SOURCE_ID, locationPrecision: 'city', latitude: 59.6, credibility: 'experimental' });
    expect(p.title).toMatch(/^Signal convergence STRONG \(new\) near 59\.6°N 24\.1°E: 3 independent feeds/);
    expect(p.sourceUrl).toMatch(/^https:\/\/watchtower-hq\.web\.app\/\?at=59\.600,24\.100,6&sel=conv:ship-dark%7Cabc$/);
    expect(p.metadata).toMatchObject({ subtype: 'convergence-hotspot', level: 'strong', change: 'new', signalEventIds: ['e1'] });

    const c = convergenceRecord({ kind: 'country', change: 'new', hotspot: country, firstAt: iso }, iso, 'https://app.example.test/');
    expect(validateEvent(c, NOW)).toBeNull();
    expect(c).toMatchObject({ countryCodes: ['IR'], locationPrecision: 'country', sourceUrl: 'https://app.example.test/regions/middle-east' });
    expect(c.latitude).toBeUndefined();
    expect(c.title).toMatch(/^Country signal convergence WATCH \(new\): Iran, 2 independent feeds/);

    const strongPreset: Condition = { all: [{ field: 'sourceId', op: 'eq', value: CONVERGENCE_SOURCE_ID }, { field: 'metadata.level', op: 'eq', value: 'strong' }] };
    expect(matches(strongPreset, p)).toBe(true);
    expect(matches(strongPreset, c)).toBe(false);
  });

  it('gives an upgrade its own id, and the same hotspot the same id', () => {
    const a = convergenceRecord({ kind: 'point', change: 'new', hotspot: point, firstAt: iso }, iso);
    const b = convergenceRecord({ kind: 'point', change: 'new', hotspot: point, firstAt: iso }, iso);
    const up = convergenceRecord({ kind: 'point', change: 'upgraded', hotspot: point, firstAt: iso }, iso);
    expect(a.id).toBe(b.id);
    expect(up.id).not.toBe(a.id);
  });
});
