import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { CENSOR_COUNTRIES, CENSOR_TARGETS, countryRegions, readTarget, targetLabel, type CountryCensorship, type DayRow } from '../../shared/domain/censorship.ts';
import { contentHash } from '../lib/hash.ts';
import { LIMITS, truncate } from '../lib/text.ts';
import type { AdapterContext, AdapterResult, SourceAdapter } from './types.ts';

/**
 * OONI censorship measurements (Phase 23). Two countries per run in turn (7 small aggregation queries
 * each), so every country is refreshed about every three hours and the API's fair-use limits are kept.
 * CC BY-NC-SA 4.0: attribution to OONI on every record.
 */
export const OONI_SOURCE_ID = 'ooni';
export const COUNTRIES_PER_RUN = 2;
const API = 'https://api.ooni.io/api/v1/aggregation';

export interface OoniState {
  cursor: number;
  countries: CountryCensorship[];
  /** country|target already recorded as newly blocked (cleared once it is no longer blocked). */
  reported: string[];
}

export const ooniUrl = (cc: string, query: string, now: number) => {
  const since = new Date(now - 16 * 86_400_000).toISOString().slice(0, 10);
  const until = new Date(now + 86_400_000).toISOString().slice(0, 10);
  return `${API}?probe_cc=${cc}&${query}&since=${since}&until=${until}&axis_x=measurement_start_day`;
};
const explorer = (cc: string) => `https://explorer.ooni.org/country/${cc}`;

export function blockRecord(c: CountryCensorship, t: CountryCensorship['targets'][number], nowIso: string): IntelligenceEvent {
  const id = contentHash(OONI_SOURCE_ID, c.cc, t.id, nowIso.slice(0, 10));
  const pct = (x: number | null) => (x === null ? '?' : `${Math.round(x * 100)}%`);
  return {
    id,
    contentHash: id,
    dataOrigin: 'live',
    sourceId: OONI_SOURCE_ID,
    sourceName: 'OONI — internet censorship measurements',
    sourceClass: 'scientific',
    sourceUrl: explorer(c.cc),
    title: truncate(`OONI: ${targetLabel(t.id)} ${t.status === 'blocked' ? 'looks blocked' : 'partly blocked'} in ${c.name} — ${pct(t.share)} of ${t.tests} tests failed (usually ${pct(t.priorShare)})`, LIMITS.title),
    summary: truncate(
      `OONI volunteers' tests in ${c.name} over the last two days: ${pct(t.share)} of ${t.tests} tests of ${targetLabel(t.id)} were anomalous or hit a confirmed block page, against ${pct(t.priorShare)} in the 14 days before. ` +
        'Anomalies can also come from network faults; a sudden rise across many tests usually means blocking or throttling. Data: OONI, CC BY-NC-SA 4.0.',
      LIMITS.summary,
    ),
    category: 'cyber',
    regionIds: [...new Set([...c.regionIds, 'global-cyber'])],
    countryCodes: [c.cc],
    publishedAt: nowIso,
    occurredAt: null,
    collectedAt: nowIso,
    credibility: 'single-source',
    verificationStatus: 'unreviewed',
    locationPrecision: 'country',
    metadata: { subtype: 'censorship', target: t.id, status: t.status, share: t.share, priorShare: t.priorShare, tests: t.tests, newBlock: true, geoBasis: 'source-country' },
  };
}

export const ooni: SourceAdapter<OoniState> = {
  sourceId: OONI_SOURCE_ID,
  async collect(ctx: AdapterContext<OoniState>): Promise<AdapterResult<OoniState>> {
    const nowIso = new Date(ctx.now).toISOString();
    const prev: OoniState = ctx.state ?? { cursor: 0, countries: [], reported: [] };
    const batch = Array.from({ length: COUNTRIES_PER_RUN }, (_, i) => CENSOR_COUNTRIES[(prev.cursor + i) % CENSOR_COUNTRIES.length]);
    const countries = new Map(prev.countries.map((c) => [c.cc, c]));
    const reported = new Set(prev.reported);
    const events: IntelligenceEvent[] = [];
    let read = 0;
    for (const country of batch) {
      const targets = [];
      for (const t of CENSOR_TARGETS) {
        const res = await ctx.fetch(ooniUrl(country.cc, t.query, ctx.now), undefined, { Accept: 'application/json' });
        if (res.kind !== 'ok') continue;
        const body = JSON.parse(res.body) as { result?: DayRow[] };
        targets.push(readTarget(t.id, Array.isArray(body.result) ? body.result : []));
        read++;
      }
      if (!targets.length) continue;
      const c: CountryCensorship = { cc: country.cc, name: country.name, regionIds: countryRegions(country.cc), fetchedAt: nowIso, targets };
      countries.set(c.cc, c);
      for (const t of targets) {
        const key = `${c.cc}|${t.id}`;
        if (t.isNew && !reported.has(key)) {
          events.push(blockRecord(c, t, nowIso));
          reported.add(key);
        } else if (t.status === 'ok') reported.delete(key);
      }
    }
    if (read === 0 && prev.countries.length) throw new Error('OONI: no measurements could be read this run');
    return {
      events,
      rejected: [],
      itemsSeen: read,
      notModified: false,
      state: { cursor: (prev.cursor + COUNTRIES_PER_RUN) % CENSOR_COUNTRIES.length, countries: [...countries.values()], reported: [...reported] },
    };
  },
};
