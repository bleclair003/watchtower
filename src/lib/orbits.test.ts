import { describe, expect, it } from 'vitest';
import { buildDemoSatellites } from '../data/demo/demoSatellites';
import { groundTrack, passesOver, subPoint, toSatrec } from './orbits';

const NOW = Date.parse('2026-11-24T12:00:00Z');

describe('orbits (SGP4 in the browser)', () => {
  const sats = buildDemoSatellites(NOW).sats;

  it('computes sub-satellite points at a plausible height', () => {
    const leo = toSatrec(sats[0].el)!;
    const p = subPoint(leo, new Date(NOW))!;
    expect(Math.abs(p.lat)).toBeLessThanOrEqual(98);
    expect(p.altKm).toBeGreaterThan(300);
    expect(p.altKm).toBeLessThan(900);
    const high = subPoint(toSatrec(sats[2].el)!, new Date(NOW))!;
    expect(high.altKm).toBeGreaterThan(15_000);
  });

  it('finds passes over a wide box and splits ground tracks at the antimeridian', () => {
    const rec = toSatrec(sats[3].el)!;
    // A near-polar orbit crosses a 40° band many times in 12 hours.
    const passes = passesOver(rec, [-180, -20, 180, 20], NOW, 12, 60, 0);
    expect(passes.length).toBeGreaterThan(10);
    for (const p of passes) {
      expect(p.end).toBeGreaterThanOrEqual(p.start);
      expect(Math.abs(p.closest.lat)).toBeLessThanOrEqual(20);
    }
    const segs = groundTrack(rec, NOW, 200, 60);
    expect(segs.length).toBeGreaterThan(1);
    for (const seg of segs) for (let i = 1; i < seg.length; i++) expect(Math.abs(seg[i][0] - seg[i - 1][0])).toBeLessThan(180);
  });

  it('returns null for elements that cannot be propagated', () => {
    expect(toSatrec({ ...sats[0].el, MEAN_MOTION: Number.NaN })).toBeNull();
  });
});
