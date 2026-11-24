import { describe, expect, it } from 'vitest';
import { describeShape, fromStored, inShape, kmBetween, newAreaId, recordInArea, shapeAreaKm2, shapeBounds, toStored, validateWatchArea, type WatchArea } from './watchAreas.ts';

const area = (p: Partial<WatchArea> = {}): WatchArea => ({
  id: 'area-test-00001',
  name: 'Test area',
  shape: { kind: 'circle', lat: 59.5, lon: 24.5, radiusKm: 20 },
  alert: { enabled: true, severity: 'WARNING', categories: [], discord: true },
  note: '',
  createdAt: '2026-11-24T00:00:00.000Z',
  updatedAt: '2026-11-24T00:00:00.000Z',
  version: 1,
  ...p,
});
const square = { kind: 'polygon' as const, points: [[24, 59], [25, 59], [25, 60], [24, 60]] as [number, number][] };

describe('watch area geometry', () => {
  it('tests points against circles and polygons', () => {
    expect(inShape(area().shape, 59.6, 24.5)).toBe(true); // ~11 km north
    expect(inShape(area().shape, 59.75, 24.5)).toBe(false); // ~28 km north
    expect(inShape(square, 59.5, 24.5)).toBe(true);
    expect(inShape(square, 59.5, 25.1)).toBe(false);
    // A concave polygon: the notch is outside.
    const notch = { kind: 'polygon' as const, points: [[0, 0], [4, 0], [4, 4], [2, 2], [0, 4]] as [number, number][] };
    expect(inShape(notch, 1, 2)).toBe(true);
    expect(inShape(notch, 3.5, 2)).toBe(false);
    expect(kmBetween(59, 24, 60, 24)).toBeCloseTo(111.2, 0);
  });

  it('measures and describes shapes', () => {
    expect(shapeAreaKm2(area().shape)).toBeCloseTo(1256.6, 0);
    expect(shapeAreaKm2(square)).toBeGreaterThan(6000);
    expect(shapeAreaKm2(square)).toBeLessThan(6400);
    expect(describeShape(area().shape)).toBe('circle, 20 km radius (1,257 km²)');
    const [w, s, e, n] = shapeBounds(area().shape);
    expect(n - s).toBeCloseTo(0.36, 2);
    expect(e - w).toBeGreaterThan(n - s);
    expect(newAreaId(Date.parse('2026-11-24T00:00:00Z'), () => 0.5)).toMatch(/^area-[a-z0-9]+-[a-z0-9]{5}$/);
  });

  it('validates', () => {
    expect(validateWatchArea(area())).toEqual([]);
    expect(validateWatchArea(area({ shape: square }))).toEqual([]);
    expect(validateWatchArea(area({ name: ' ' }))).toEqual(['Give the area a name.']);
    expect(validateWatchArea(area({ shape: { kind: 'circle', lat: 59, lon: 24, radiusKm: 0.1 } }))).toHaveLength(1);
    expect(validateWatchArea(area({ shape: { kind: 'polygon', points: [[24, 59], [25, 59]] } }))).toHaveLength(1);
    expect(validateWatchArea(area({ alert: { enabled: true, severity: 'PANIC' as never, categories: ['cooking' as never], discord: false } }))).toHaveLength(2);
  });

  it('only exactly located records in the chosen categories are inside', () => {
    const e = { locationPrecision: 'exact', latitude: 59.55, longitude: 24.5, category: 'maritime' as const };
    expect(recordInArea(area(), e)).toBe(true);
    expect(recordInArea(area(), { ...e, locationPrecision: 'city' })).toBe(false);
    expect(recordInArea(area({ alert: { ...area().alert, categories: ['military'] } }), e)).toBe(false);
    expect(recordInArea(area(), { ...e, latitude: undefined })).toBe(false);
  });
});

describe('storage format', () => {
  it('round-trips polygons through { lo, la } objects (Firestore has no nested arrays)', () => {
    const a = area({ shape: square });
    const stored = toStored(a) as { shape: { points: unknown[] } };
    expect(stored.shape.points[0]).toEqual({ lo: 24, la: 59 });
    expect(fromStored(stored)).toEqual(a);
    expect(fromStored(toStored(area()))).toEqual(area());
  });
});
