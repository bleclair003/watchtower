/**
 * Conflict events (Phase 25): UCDP Georeferenced Event Dataset, monthly "candidate" release (Uppsala
 * Conflict Data Program). Each event is a coded incident of organised violence with at least one death:
 * where, when, the sides and the best estimate of deaths. Released about a month after the month it
 * covers. CC BY 4.0 — cite UCDP (Sundberg & Melander 2013; Hegre et al. 2020).
 *
 * Only events in watch regions are kept; the map shows those located to a district or better.
 */
import { regionsForPoint } from './regions.ts';

export type ViolenceType = 1 | 2 | 3;
export const VIOLENCE_LABEL: Record<ViolenceType, string> = { 1: 'state-based', 2: 'non-state', 3: 'one-sided (against civilians)' };

/** Compact event for the map. */
export interface ConflictEvent {
  id: number;
  /** Start date (YYYY-MM-DD). */
  d: string;
  la: number;
  lo: number;
  ty: ViolenceType;
  /** Best estimate of deaths. */
  k: number;
  /** UCDP location precision: 1 exact … 3 district, 4 province. */
  p: number;
  country: string;
  a: string;
  b: string;
  regionIds: string[];
}

export interface RegionConflictTotal {
  regionId: string;
  events: number;
  deaths: number;
  /** Deaths by violence type 1, 2, 3. */
  deathsByType: [number, number, number];
}

export interface ConflictSnapshot {
  /** UCDP version, e.g. "26.0.10". */
  release: string;
  /** Month covered (YYYY-MM). */
  month: string;
  fetchedAt: string;
  sourceUrl: string;
  /** Events located to a province or better, in watch regions, in the month. */
  events: ConflictEvent[];
  regions: RegionConflictTotal[];
  /** All events in the file for the month (worldwide). */
  worldEvents: number;
  simulated?: boolean;
}

/** Minimal RFC 4180 CSV reader (quoted fields, doubled quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let f = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          f += '"';
          i++;
        } else q = false;
      } else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(f);
      f = '';
    } else if (c === '\n') {
      row.push(f.endsWith('\r') ? f.slice(0, -1) : f);
      rows.push(row);
      row = [];
      f = '';
    } else f += c;
  }
  if (f || row.length) rows.push([...row, f]);
  return rows;
}

/** Newest monthly candidate file linked from the downloads page: { release, month, url }. */
export function latestCandidate(html: string): { release: string; month: string; url: string } | null {
  let best: { y: number; m: number; url: string } | null = null;
  for (const m of html.matchAll(/href="(https:\/\/ucdp\.uu\.se\/downloads\/candidateged\/GEDEvent_v(\d{2})_0_(\d{1,2})\.csv)"/gi)) {
    const y = 2000 + +m[2];
    const mo = +m[3];
    if (mo < 1 || mo > 12) continue;
    if (!best || y * 100 + mo > best.y * 100 + best.m) best = { y, m: mo, url: m[1] };
  }
  if (!best) return null;
  return { release: `${String(best.y).slice(2)}.0.${best.m}`, month: `${best.y}-${String(best.m).padStart(2, '0')}`, url: best.url };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Reads the candidate CSV for one month into the snapshot parts. Pure. */
export function readCandidate(csv: string, month: string): Pick<ConflictSnapshot, 'events' | 'regions' | 'worldEvents'> {
  const rows = parseCsv(csv);
  const head = rows[0] ?? [];
  const ix = (k: string) => head.indexOf(k);
  const need = ['id', 'type_of_violence', 'side_a', 'side_b', 'where_prec', 'latitude', 'longitude', 'country', 'date_start', 'best'];
  const missing = need.filter((k) => ix(k) < 0);
  if (missing.length) throw new Error(`UCDP: file layout changed (missing ${missing.join(', ')})`);
  const totals = new Map<string, RegionConflictTotal>();
  const events: ConflictEvent[] = [];
  let worldEvents = 0;
  for (const r of rows.slice(1)) {
    if (r.length < head.length - 2) continue;
    const d = r[ix('date_start')].slice(0, 10);
    if (!d.startsWith(month)) continue;
    worldEvents++;
    const la = Number(r[ix('latitude')]);
    const lo = Number(r[ix('longitude')]);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
    // The US box also covers northern Mexico and southern Canada: the US region takes only events UCDP codes in the US.
    const country = r[ix('country')];
    const regionIds = regionsForPoint(la, lo).filter((id) => id !== 'united-states' || /United States/i.test(country));
    if (!regionIds.length) continue;
    const ty = Number(r[ix('type_of_violence')]) as ViolenceType;
    const k = Math.max(0, Number(r[ix('best')]) || 0);
    for (const id of regionIds) {
      const t = totals.get(id) ?? { regionId: id, events: 0, deaths: 0, deathsByType: [0, 0, 0] };
      t.events++;
      t.deaths += k;
      if (ty >= 1 && ty <= 3) t.deathsByType[ty - 1] += k;
      totals.set(id, t);
    }
    const p = Number(r[ix('where_prec')]);
    if (!(p >= 1 && p <= 4) || !(ty >= 1 && ty <= 3)) continue;
    events.push({ id: Number(r[ix('id')]), d, la: Math.round(la * 1e3) / 1e3, lo: Math.round(lo * 1e3) / 1e3, ty, k, p, country, a: clip(r[ix('side_a')], 48), b: clip(r[ix('side_b')], 48), regionIds });
  }
  events.sort((x, y) => y.k - x.k || y.d.localeCompare(x.d));
  return { events, regions: [...totals.values()].sort((x, y) => y.deaths - x.deaths), worldEvents };
}

export const monthName = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
