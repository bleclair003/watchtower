import { describe, expect, it } from 'vitest';
import { addCounts, MIN_DAYS, unpack, zoneAt, zoneLevels } from './tankerLevels.ts';

const DAY = 86_400_000;
const T0 = Date.parse('2026-11-24T12:00:00Z');

/** Hourly runs for `days` days ending before `end`, with `count(dayIndex)` tankers in Primorsk. */
function history(days: number, end: number, count: (d: number) => number) {
  let p = {};
  for (let d = days; d >= 1; d--) for (let h = 0; h < 24; h++) p = addCounts(p, { primorsk: { t: count(d), m: count(d) - 1, a: 1 } }, end - d * DAY + h * 3_600_000);
  return p;
}

describe('tanker levels', () => {
  it('places points in zones (Primorsk is also in the whole gulf)', () => {
    expect(zoneAt(60.35, 28.6).map((z) => z.id)).toEqual(['primorsk', 'gulf-of-finland']);
    expect(zoneAt(59.7, 28.3).map((z) => z.id)).toEqual(['ust-luga', 'gulf-of-finland']);
    expect(zoneAt(55, 20)).toEqual([]);
  });

  it('keeps one bucket per hour (a second run replaces the first) and drops hours older than 60 days', () => {
    let p = addCounts({}, { primorsk: { t: 5, m: 4, a: 1 } }, T0);
    p = addCounts(p, { primorsk: { t: 7, m: 5, a: 2 } }, T0 + 10 * 60_000);
    expect(unpack(p.primorsk)).toEqual([{ h: Math.floor(T0 / 3_600_000), t: 7, m: 5, a: 2 }]);
    p = addCounts(p, {}, T0 + 61 * DAY);
    expect(unpack(p.primorsk)).toHaveLength(1);
    expect(unpack(p['ust-luga'])[0].t).toBe(0);
  });

  it('builds daily means, waits for 7 days, then flags a drop and a surge', () => {
    const steady = history(10, T0, (d) => 10 + (d % 2));
    const building = zoneLevels(history(3, T0, () => 10), T0);
    expect(building[0]).toMatchObject({ id: 'primorsk', score: null, direction: null });
    expect(building[0].days.length).toBeLessThan(MIN_DAYS);

    const drop = zoneLevels({ ...steady, primorsk: addCountsDay(steady, 1, T0).primorsk }, T0)[0];
    expect(drop.days).toHaveLength(10);
    expect(drop.last24.mean).toBe(1);
    expect(drop.direction).toBe('drop');
    expect(drop.score).toBeLessThan(-3);

    const surge = zoneLevels({ ...steady, primorsk: addCountsDay(steady, 30, T0).primorsk }, T0)[0];
    expect(surge.direction).toBe('surge');
  });
});

/** The last 24 hours with `n` tankers each hour. */
function addCountsDay(p: Record<string, string>, n: number, end: number) {
  let q = p;
  for (let h = 23; h >= 0; h--) q = addCounts(q, { primorsk: { t: n, m: n, a: 0 } }, end - h * 3_600_000);
  return q;
}
