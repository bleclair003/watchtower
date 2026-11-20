/** Time helpers. All storage is ISO-8601 UTC; display converts explicitly. */

const pad = (n: number) => String(n).padStart(2, '0');

/** `2026-11-20 14:05Z` */
export function formatUtc(iso: string | null | undefined, withSeconds = false): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'INVALID';
  const base = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return withSeconds ? `${base}:${pad(d.getUTCSeconds())}Z` : `${base}Z`;
}

/** Military date-time group style clock: `20 NOV 2026 14:05:09` */
export function formatClock(d: Date, mode: 'utc' | 'local'): string {
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const get = mode === 'utc'
    ? { y: d.getUTCFullYear(), mo: d.getUTCMonth(), da: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() }
    : { y: d.getFullYear(), mo: d.getMonth(), da: d.getDate(), h: d.getHours(), mi: d.getMinutes(), s: d.getSeconds() };
  return `${pad(get.da)} ${months[get.mo]} ${get.y} ${pad(get.h)}:${pad(get.mi)}:${pad(get.s)}`;
}

/** Compact relative age: `42m`, `5h`, `3d`. Future timestamps show `+5m`. */
export function formatAge(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const diff = now - t;
  const sign = diff < 0 ? '+' : '';
  const m = Math.floor(Math.abs(diff) / 60_000);
  if (m < 1) return `${sign}<1m`;
  if (m < 60) return `${sign}${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${sign}${h}h`;
  return `${sign}${Math.floor(h / 24)}d`;
}

export const HOUR = 3_600_000;
