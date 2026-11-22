import { describe, expect, it } from 'vitest';
import type { ConflictEvent } from '@shared/domain/conflictEvents';
import type { NavWarning } from '@shared/domain/navWarnings';
import { recentConflicts, recentNavWarnings } from './layerTime';

const ev = (id: number, d: string): ConflictEvent => ({ id, d, la: 0, lo: 0, ty: 1, k: 1, p: 1, country: 'Testland', a: 'Side A', b: 'Side B', regionIds: [] });
const nw = (key: string, issuedAt: string | null): NavWarning => ({
  key,
  series: 'TEST',
  number: 1,
  year: 2026,
  issuedAt,
  kind: 'exercise',
  text: 'Invented test warning',
  points: [],
  lat: null,
  lon: null,
  regionIds: [],
});

describe('recentConflicts', () => {
  const events = [ev(1, '2026-10-01'), ev(2, '2026-10-20'), ev(3, '2026-10-25'), ev(4, '2026-10-31')];

  it('keeps everything for the whole month and reports the span', () => {
    expect(recentConflicts(events, null)).toEqual({ events, from: '2026-10-01', to: '2026-10-31' });
  });

  it('counts back from the newest day in the release, not from today', () => {
    const w = recentConflicts(events, 7);
    expect(w.events.map((e) => e.id)).toEqual([3, 4]);
    expect(w).toMatchObject({ from: '2026-10-25', to: '2026-10-31' });
  });

  it('never reports a start before the oldest event', () => {
    expect(recentConflicts([ev(1, '2026-10-30'), ev(2, '2026-10-31')], 14).from).toBe('2026-10-30');
  });

  it('handles an empty release', () => {
    expect(recentConflicts([], 7)).toEqual({ events: [], from: null, to: null });
  });
});

describe('recentNavWarnings', () => {
  const now = Date.parse('2026-11-22T12:00:00Z');
  const list = [nw('a', '2026-11-21T00:00:00Z'), nw('b', '2026-11-10T00:00:00Z'), nw('c', null)];

  it('keeps all warnings when there is no limit', () => {
    expect(recentNavWarnings(list, null, now)).toHaveLength(3);
  });

  it('keeps warnings issued inside the window and drops undated ones', () => {
    expect(recentNavWarnings(list, 2, now).map((w) => w.key)).toEqual(['a']);
    expect(recentNavWarnings(list, 30, now).map((w) => w.key)).toEqual(['a', 'b']);
  });
});
