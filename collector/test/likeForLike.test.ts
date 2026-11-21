// @vitest-environment node
/** Phase 15 item 12: like-for-like usual levels (same weekdays, holidays with holidays). */
import { describe, expect, it } from 'vitest';
import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { easterSunday, holidayName } from '../../shared/domain/holidays.ts';
import { usualLevel, type HolidayCounts } from '../../shared/domain/meters/util.ts';
import { mergeHolidayCounts } from '../pipeline.ts';

const H = 3_600_000;
const DAY = 24 * H;
let n = 0;
function at(t: number): IntelligenceEvent {
  const id = `l${++n}`;
  const iso = new Date(t).toISOString();
  return {
    id, contentHash: id, dataOrigin: 'live', sourceId: 'bbc-world', sourceName: 'BBC', sourceClass: 'media', sourceUrl: `https://example.test/${id}`,
    title: 'x', category: 'military', regionIds: ['middle-east'], countryCodes: [], publishedAt: iso, occurredAt: null, collectedAt: iso,
    credibility: 'single-source', verificationStatus: 'unreviewed', locationPrecision: 'country',
  };
}
/** `perDay(day)` records at 12:00 UTC on each of the `days` days before `now`'s day. */
function history(now: number, days: number, perDay: (d: Date, holiday: boolean) => number): IntelligenceEvent[] {
  const out: IntelligenceEvent[] = [];
  const today = Math.floor(now / DAY) * DAY;
  for (let i = 1; i <= days; i++) {
    const noon = today - i * DAY + 12 * H;
    const d = new Date(noon);
    const count = perDay(d, holidayName(d.toISOString().slice(0, 10)) !== null);
    for (let k = 0; k < count; k++) out.push(at(noon));
  }
  return out;
}

describe('holidays', () => {
  it('computes the US federal holidays and Easter by rule', () => {
    expect(holidayName('2026-11-26')).toBe('Thanksgiving');
    expect(holidayName('2026-11-11')).toBe('Veterans Day');
    expect(holidayName('2026-05-25')).toBe('Memorial Day');
    expect(holidayName('2026-09-07')).toBe('Labor Day');
    expect(holidayName('2027-01-18')).toBe('Martin Luther King Jr. Day');
    expect(holidayName('2026-12-25')).toBe('Christmas Day');
    expect(holidayName('2026-11-27')).toBeNull();
    expect(new Date(easterSunday(2026)).toISOString().slice(0, 10)).toBe('2026-04-05');
    expect(new Date(easterSunday(2027)).toISOString().slice(0, 10)).toBe('2027-03-28');
    expect(holidayName('2026-04-03')).toBe('Good Friday');
  });
});

describe('like-for-like usual level', () => {
  const SAT = Date.parse('2026-11-21T14:00:00Z'); // a Saturday

  it('compares a weekend window with earlier weekends, not the all-days average', () => {
    const events = history(SAT, 40, (d) => (d.getUTCDay() === 6 ? 1 : 10));
    const u = usualLevel(events, () => true, SAT, 24, SAT - 40 * DAY - 2 * H);
    expect(u.basis?.method).toBe('like-for-like');
    // Window: Friday 14:00-24:00 (10/24 of a 10-record day) + Saturday 00:00-14:00 (14/24 of a 1-record day) = 4.75.
    expect(u.usual).toBe(4.8);
    expect(u.basis?.text).toContain('Fri, Sat');
    expect(u.current).toBe(0); // the helper writes no records on the current day
  });

  it('falls back to the plain average, and says so, with under three earlier weeks', () => {
    const events = history(SAT, 16, () => 5);
    const u = usualLevel(events, () => true, SAT, 24, SAT - 16 * DAY - 2 * H, 14);
    expect(u.basis?.method).toBe('all-days');
    expect(u.basis?.text).toContain('plain average');
  });

  it('compares a holiday with earlier holidays only once two are known, and records holidays for the store', () => {
    const THANKSGIVING = Date.parse('2026-11-26T20:00:00Z');
    const events = history(THANKSGIVING, 30, (_d, holiday) => (holiday ? 2 : 8));
    const start = THANKSGIVING - 30 * DAY - 2 * H;
    const sink: HolidayCounts = {};
    const plain = usualLevel(events, () => true, THANKSGIVING, 24, start, 14, 1, { key: 'k', holidays: {}, sink });
    expect(plain.basis?.method).toBe('all-days');
    expect(plain.basis?.holidays).toEqual(['Thanksgiving']);
    expect(plain.basis?.text).toContain('Thanksgiving falls in this window');
    expect(sink).toEqual({ k: { '2026-11-11': 2 } }); // Veterans Day, the one whole holiday loaded

    const stored: HolidayCounts = { k: { '2025-11-27': 2, '2025-12-25': 2 } };
    const like = usualLevel(events, () => true, THANKSGIVING, 24, start, 14, 1, { key: 'k', holidays: stored });
    expect(like.basis?.method).toBe('like-for-like');
    // Wednesday 20:00-24:00 (4/24 x 8) + Thanksgiving 00:00-20:00 (20/24 x 2, from three holidays) = 3.0.
    expect(like.usual).toBe(3);
    expect(like.basis?.text).toContain('3 earlier holidays');
  });

  it('merges stored and new holiday counts, keeping three years', () => {
    const now = Date.parse('2026-11-27T00:00:00Z');
    const merged = mergeHolidayCounts({ a: { '2022-12-25': 9, '2025-12-25': 4 }, b: { '2020-01-01': 1 } }, { a: { '2025-12-25': 5, '2026-11-26': 3 } }, now);
    expect(merged).toEqual({ a: { '2025-12-25': 5, '2026-11-26': 3 } });
  });
});
