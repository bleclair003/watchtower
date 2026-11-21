import { DISPLACEMENT_ISO3, EMPTY_FIGURES, type DisplacementFigures, type DisplacementRow, type DisplacementSnapshot } from '../../shared/domain/displacement.ts';
import type { AdapterContext, AdapterResult, SourceAdapter } from './types.ts';

export const UNHCR_SOURCE_ID = 'unhcr-displacement';
export const UNHCR_EVERY_HOURS = 24;
const API = 'https://api.unhcr.org/population/v1';
/** Totals per country of origin (`coo_all`) or per country of asylum (`coa_all`) for one year. */
export const unhcrUrl = (year: number, by: 'origin' | 'asylum') => `${API}/population/?limit=300&year=${year}&${by === 'origin' ? 'coo_all' : 'coa_all'}=true`;

export interface UnhcrItem {
  year: number;
  coo_iso?: string;
  coa_iso?: string;
  refugees?: number | string;
  asylum_seekers?: number | string;
  returned_refugees?: number | string;
  idps?: number | string;
}

const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/** One year's figures per watch country from the origin and asylum tables. Countries in neither table are left out. */
export function figuresByCountry(origin: UnhcrItem[], asylum: UnhcrItem[]): Map<string, DisplacementFigures> {
  const out = new Map<string, DisplacementFigures>();
  const get = (iso2: string) => out.get(iso2) ?? { ...EMPTY_FIGURES };
  for (const r of origin) {
    const c = DISPLACEMENT_ISO3[r.coo_iso ?? ''];
    if (!c) continue;
    const f = get(c);
    out.set(c, { ...f, refugeesAbroad: num(r.refugees), asylumSeekersAbroad: num(r.asylum_seekers), idps: Math.max(f.idps, num(r.idps)), returnedRefugees: num(r.returned_refugees) });
  }
  for (const r of asylum) {
    const c = DISPLACEMENT_ISO3[r.coa_iso ?? ''];
    if (!c) continue;
    const f = get(c);
    out.set(c, { ...f, refugeesHosted: num(r.refugees), asylumSeekersHosted: num(r.asylum_seekers), idps: Math.max(f.idps, num(r.idps)) });
  }
  return out;
}

export function buildDisplacement(year: number, latest: Map<string, DisplacementFigures>, previous: Map<string, DisplacementFigures>, nowIso: string): DisplacementSnapshot {
  const rows: DisplacementRow[] = [...latest].map(([country, f]) => ({ country, latest: f, previous: previous.get(country) ?? null }));
  rows.sort((a, b) => a.country.localeCompare(b.country));
  return { fetchedAt: nowIso, year, previousYear: year - 1, rows };
}

export interface UnhcrState {
  lastFetchedAt: string;
  latest: DisplacementSnapshot | null;
}

async function table(ctx: AdapterContext<UnhcrState>, year: number, by: 'origin' | 'asylum'): Promise<UnhcrItem[]> {
  const res = await ctx.fetch(unhcrUrl(year, by), undefined, { Accept: 'application/json' });
  if (res.kind !== 'ok') throw new Error('UNHCR: unexpected 304');
  const body = JSON.parse(res.body) as { items?: UnhcrItem[] };
  if (!Array.isArray(body.items)) throw new Error('UNHCR: unexpected response');
  return body.items.filter((i) => i.year === year);
}

/**
 * UNHCR Refugee Data Finder API (free, no key), once a day. Context for the region pages, not records:
 * the figures change twice a year (mid-year and annual releases).
 */
export const unhcrDisplacement: SourceAdapter<UnhcrState> = {
  sourceId: UNHCR_SOURCE_ID,
  async collect(ctx: AdapterContext<UnhcrState>): Promise<AdapterResult<UnhcrState>> {
    if (ctx.state && ctx.now - Date.parse(ctx.state.lastFetchedAt) < UNHCR_EVERY_HOURS * 3_600_000) {
      return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: ctx.state };
    }
    // The newest year with data: this year if published (mid-year figures), otherwise last year.
    let year = new Date(ctx.now).getUTCFullYear();
    let origin = await table(ctx, year, 'origin');
    if (origin.length === 0) {
      year -= 1;
      origin = await table(ctx, year, 'origin');
    }
    if (origin.length === 0) throw new Error(`UNHCR: no figures for ${year} or ${year + 1}`);
    const [asylum, prevOrigin, prevAsylum] = await Promise.all([table(ctx, year, 'asylum'), table(ctx, year - 1, 'origin'), table(ctx, year - 1, 'asylum')]);
    const nowIso = new Date(ctx.now).toISOString();
    const latest = buildDisplacement(year, figuresByCountry(origin, asylum), figuresByCountry(prevOrigin, prevAsylum), nowIso);
    return { events: [], rejected: [], itemsSeen: latest.rows.length, notModified: false, state: { lastFetchedAt: nowIso, latest } };
  },
};
