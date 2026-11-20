const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Parses RFC 822/1123 dates as found in real feeds, including:
 *   "Thu, 19 Nov 26 12:00:00 +0000"   (CISA: two-digit year)
 *   "Fri, 23 Oct 2026"                (State Dept: date only → 00:00 UTC)
 *   "2026-11-18T19:17:41.0354Z"       (ISO-8601 passthrough)
 * Returns an ISO string, or null if the value cannot be parsed confidently.
 */
export function parseFeedDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }

  const m = s.match(
    /^(?:[A-Za-z]{3},?\s+)?(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{4}|[A-Z]{1,4})?)?$/,
  );
  if (!m) return null;
  const [, d, mon, y, hh = '0', mm = '0', ss = '0', zone = '+0000'] = m;
  const month = MONTHS[mon.toLowerCase()];
  if (month === undefined) return null;
  let year = Number(y);
  if (y.length === 2) year += year < 70 ? 2000 : 1900;

  let offsetMin = 0;
  if (/^[+-]\d{4}$/.test(zone)) {
    const sign = zone[0] === '-' ? -1 : 1;
    offsetMin = sign * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(3, 5)));
  } else if (!['UT', 'UTC', 'GMT', 'Z'].includes(zone)) {
    const named: Record<string, number> = { EST: -300, EDT: -240, CST: -360, CDT: -300, MST: -420, MDT: -360, PST: -480, PDT: -420 };
    if (!(zone in named)) return null;
    offsetMin = named[zone];
  }

  const day = Number(d);
  const local = new Date(Date.UTC(year, month, day));
  // Reject impossible dates (e.g. 31 Feb) instead of letting Date roll them over.
  if (local.getUTCMonth() !== month || local.getUTCDate() !== day) return null;
  const t = Date.UTC(year, month, day, Number(hh), Number(mm), Number(ss)) - offsetMin * 60_000;
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}
