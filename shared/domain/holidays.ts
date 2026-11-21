/**
 * Phase 15 item 12: holidays for like-for-like baselines. Holidays are compared with holidays, not
 * with ordinary days, because official feeds and newsrooms publish less on them.
 *
 * The list follows the sources WATCHTOWER reads most (US government and English-language media):
 * US federal holidays on their actual date (not the observed Friday or Monday), plus Christmas Eve,
 * Boxing Day, New Year's Eve, Good Friday and Easter Monday. All computed by rule, by UTC day.
 * Lunar-calendar holidays (Lunar New Year, Eid) are not included.
 */

const DAY = 86_400_000;

/** UTC midnight of the nth (1-based) given weekday (0 = Sunday) in month m (0-based). */
const nthWeekday = (y: number, m: number, weekday: number, n: number) => {
  const first = new Date(Date.UTC(y, m, 1)).getUTCDay();
  return Date.UTC(y, m, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
};
const lastWeekday = (y: number, m: number, weekday: number) => {
  const last = new Date(Date.UTC(y, m + 1, 0));
  return Date.UTC(y, m, last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7));
};

/** Easter Sunday (Gregorian), anonymous Gregorian algorithm. */
export function easterSunday(y: number): number {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(y, month - 1, day);
}

export function holidaysOf(y: number): { date: string; name: string }[] {
  const easter = easterSunday(y);
  const list: [number, string][] = [
    [Date.UTC(y, 0, 1), "New Year's Day"],
    [nthWeekday(y, 0, 1, 3), 'Martin Luther King Jr. Day'],
    [nthWeekday(y, 1, 1, 3), "Presidents' Day"],
    [easter - 2 * DAY, 'Good Friday'],
    [easter + DAY, 'Easter Monday'],
    [lastWeekday(y, 4, 1), 'Memorial Day'],
    [Date.UTC(y, 5, 19), 'Juneteenth'],
    [Date.UTC(y, 6, 4), 'Independence Day (US)'],
    [nthWeekday(y, 8, 1, 1), 'Labor Day'],
    [nthWeekday(y, 9, 1, 2), 'Columbus Day'],
    [Date.UTC(y, 10, 11), 'Veterans Day'],
    [nthWeekday(y, 10, 4, 4), 'Thanksgiving'],
    [Date.UTC(y, 11, 24), 'Christmas Eve'],
    [Date.UTC(y, 11, 25), 'Christmas Day'],
    [Date.UTC(y, 11, 26), 'Boxing Day'],
    [Date.UTC(y, 11, 31), "New Year's Eve"],
  ];
  return list.map(([t, name]) => ({ date: new Date(t).toISOString().slice(0, 10), name })).sort((a, b) => a.date.localeCompare(b.date));
}

const cache = new Map<number, Map<string, string>>();

/** Holiday name for a UTC day ('YYYY-MM-DD'), or null. */
export function holidayName(day: string): string | null {
  const y = Number(day.slice(0, 4));
  let m = cache.get(y);
  if (!m) {
    m = new Map(holidaysOf(y).map((h) => [h.date, h.name]));
    cache.set(y, m);
  }
  return m.get(day) ?? null;
}
