// @vitest-environment node
/** Phase 24: robust scores, drops, trends. */
import { describe, expect, it } from 'vitest';
import { compare, countAtScore, describe as describeA, levelFromAnomaly, median, signalsOf, trendOf } from './anomaly.ts';

describe('compare', () => {
  it('waits for enough history', () => {
    expect(compare(5, [1, 2, 3]).status).toBe('building');
    expect(describeA(compare(5, [1, 2, 3]))).toContain('3 of 7');
  });

  it('scores against the median and a robust spread', () => {
    const steady = [10, 10, 11, 9, 10, 10, 11, 9, 10];
    const jumpy = [2, 25, 4, 30, 6, 18, 3, 28, 10];
    // 20 is very unusual for a steady series and ordinary for a jumpy one.
    expect(compare(20, steady).direction).toBe('spike');
    expect(compare(20, steady).score!).toBeGreaterThanOrEqual(3);
    expect(compare(20, jumpy).direction).toBe('normal');
  });

  it('is not fooled by one past burst', () => {
    const withBurst = [5, 5, 6, 4, 5, 60, 5, 6, 4];
    expect(compare(15, withBurst).direction).toBe('spike');
  });

  it('treats small counts with their natural randomness', () => {
    // Usually 1 a window: 2 is not unusual, 5 is.
    const ones = [1, 1, 0, 2, 1, 1, 0, 1, 1];
    expect(compare(2, ones).direction).toBe('normal');
    expect(compare(5, ones).direction).toBe('spike');
    // Usually nothing: one event is unusual.
    expect(compare(1, [0, 0, 0, 0, 0, 0, 0, 1]).direction).toBe('spike');
  });

  it('reports drops only for series that are normally busy', () => {
    expect(compare(2, [20, 22, 19, 21, 20, 18, 23]).direction).toBe('drop');
    expect(compare(0, [1, 1, 2, 1, 0, 1, 1]).direction).toBe('normal');
  });

  it('uses a supplied expected level', () => {
    const a = compare(30, [10, 10, 11, 9, 10, 10, 11, 9], { expected: 28 });
    expect(a.centre).toBe(28);
    expect(a.direction).toBe('normal');
  });

  it('gives thresholds and levels', () => {
    const a = compare(0, [4, 4, 4, 4, 4, 4, 4]);
    expect(countAtScore(a, 2)).toBe(8); // 4 + 2 × √4
    expect(levelFromAnomaly(compare(0, [4, 4, 4, 4, 4, 4, 4]))).toBe(0);
    expect(levelFromAnomaly(compare(4, [4, 4, 4, 4, 4, 4, 4]))).toBe(1);
    expect(levelFromAnomaly(compare(9, [4, 4, 4, 4, 4, 4, 4]))).toBe(3);
    expect(levelFromAnomaly(compare(12, [4, 4, 4, 4, 4, 4, 4]))).toBe(4);
  });

  it('handles measurements', () => {
    // Drones per night: usually ~100 ± 30.
    const nights = [80, 120, 95, 130, 70, 110, 100, 90, 140];
    expect(compare(150, nights, { kind: 'measure' }).direction).toBe('normal');
    expect(compare(400, nights, { kind: 'measure' }).direction).toBe('spike');
  });
});

describe('trendOf', () => {
  it('finds a steady rise that has no single extreme point', () => {
    const t = trendOf([10, 11, 12, 13, 14, 15, 16]);
    expect(t.direction).toBe('rising');
    expect(t.slope).toBe(1);
  });
  it('ignores noise and needs 5 points', () => {
    expect(trendOf([10, 14, 9, 13, 11, 12, 10]).direction).toBe('flat');
    expect(trendOf([1, 2, 3, 4]).status).toBe('building');
    expect(trendOf([30, 25, 22, 20, 15, 12]).direction).toBe('falling');
  });
  it('copes with ties', () => {
    expect(trendOf([5, 5, 5, 5, 5, 5]).direction).toBe('flat');
  });
});

describe('signals', () => {
  it('lists only unusual readings', () => {
    expect(signalsOf('x', 'g', compare(10, [10, 10, 10, 10, 10, 10, 10]))).toEqual([]);
    expect(signalsOf('x', 'g', compare(40, [10, 10, 10, 10, 10, 10, 10]), trendOf([1, 2, 3, 4, 5, 6]))).toHaveLength(2);
  });
  it('median', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});
