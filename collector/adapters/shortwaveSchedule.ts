import { EIBI_BASE, eibiSeasonFiles, parseEibiCodes, parseEibiCsv, type ShortwaveSnapshot } from '../../shared/domain/shortwave.ts';
import type { AdapterContext, AdapterResult, SourceAdapter } from './types.ts';

/**
 * Shortwave broadcast schedules (Phase 29): the EiBi list for the current season, kept to transmissions
 * aimed at or based in a watch region, with the README's language and country names. Fetched once a day;
 * makes no records. A row means only that the schedule lists it.
 */
export const SHORTWAVE_SOURCE_ID = 'eibi-schedules';
export const SHORTWAVE_EVERY_MS = 24 * 3_600_000;

export interface ShortwaveState {
  latest: ShortwaveSnapshot;
}

const pick = (all: Record<string, string>, used: Set<string>) => Object.fromEntries(Object.entries(all).filter(([k]) => used.has(k)));

export const shortwaveSchedule: SourceAdapter<ShortwaveState> = {
  sourceId: SHORTWAVE_SOURCE_ID,
  async collect(ctx: AdapterContext<ShortwaveState>): Promise<AdapterResult<ShortwaveState>> {
    if (ctx.state?.latest && ctx.now - Date.parse(ctx.state.latest.fetchedAt) < SHORTWAVE_EVERY_MS) {
      return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: ctx.state };
    }
    let body: string | null = null;
    let used: { season: string; file: string } | null = null;
    let lastErr: unknown = null;
    // A new season's file can appear a few days late: fall back to the previous season's.
    for (const f of eibiSeasonFiles(ctx.now)) {
      try {
        const res = await ctx.fetch(EIBI_BASE + f.file, undefined, { Accept: 'text/csv, text/plain' }, { maxBytes: 4 * 1024 * 1024 });
        if (res.kind === 'ok') {
          body = res.body;
          used = f;
          break;
        }
      } catch (err) {
        lastErr = err;
      }
    }
    if (!body || !used) throw new Error(`no EiBi schedule file for this season or the one before${lastErr ? ` (${(lastErr as Error).message})` : ''}`);
    const broadcasts = parseEibiCsv(body);
    if (broadcasts.length < 200) throw new Error(`EiBi ${used.file}: only ${broadcasts.length} rows for the watch regions (expected over a thousand)`);
    let languages: Record<string, string> = {};
    let countries: Record<string, string> = {};
    const readme = await ctx.fetch(EIBI_BASE + 'README.TXT', undefined, { Accept: 'text/plain' }, { maxBytes: 2 * 1024 * 1024 }).catch(() => null);
    if (readme?.kind === 'ok') {
      languages = pick(parseEibiCodes(readme.body, 'languages'), new Set(broadcasts.map((b) => b.lang)));
      const codes = new Set(broadcasts.flatMap((b) => [b.itu, b.target]));
      countries = pick(parseEibiCodes(readme.body, 'countries'), codes);
    }
    return {
      events: [],
      rejected: [],
      itemsSeen: broadcasts.length,
      notModified: false,
      state: { latest: { fetchedAt: new Date(ctx.now).toISOString(), season: used.season, sourceUrl: EIBI_BASE + used.file, broadcasts, languages, countries } },
    };
  },
};
