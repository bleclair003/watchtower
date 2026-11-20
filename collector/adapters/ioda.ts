import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { getSource } from '../../shared/domain/sources.ts';
import { regionsForCountry } from '../../shared/domain/regions.ts';
import { contentHash } from '../lib/hash.ts';
import { LIMITS, cleanText, truncate } from '../lib/text.ts';
import { FIRST_RUN_LOOKBACK_DAYS, type AdapterContext, type AdapterResult, type SourceAdapter } from './types.ts';

const SOURCE_ID = 'ioda-outages';
const DAY = 86_400_000;
/** Each run asks for outage events overlapping the last 3 days (ids make repeats harmless). */
const WINDOW_DAYS = 3;
/**
 * Minimum outage length to import. IODA reports ~300 country events a week, median ~1 h
 * (2026-11-20 sample). Events are re-read for 3 days, so an outage that grows past the
 * threshold is imported when it crosses it.
 */
export const MIN_DURATION_HOURS = 4;

export interface IodaState {
  firstRunAt: string;
}

const DATASOURCE: Record<string, string> = {
  bgp: 'BGP routing (fewer announced networks)',
  'ping-slash24': 'active probing (fewer responding hosts)',
  'merit-nt': 'network telescope (less background traffic)',
  gtr: 'Google Transparency Report (less Google traffic)',
};

interface IodaEvent {
  location?: unknown;
  location_name?: unknown;
  start?: unknown;
  duration?: unknown;
  datasource?: unknown;
  method?: unknown;
  score?: unknown;
}

/**
 * IODA (Internet Outage Detection and Analysis, Georgia Tech): country-level outage events.
 *
 * IODA detects drops in connectivity signals. A detected drop is NOT proof of a
 * government shutdown: power cuts, cable faults and measurement artefacts look the same.
 * Titles therefore say "connectivity drop detected", and the signal used is recorded.
 * One record per (country, signal, start time); a later, longer duration does not create a
 * new record.
 */
export const iodaOutages: SourceAdapter<IodaState> = {
  sourceId: SOURCE_ID,
  async collect(ctx: AdapterContext<IodaState>): Promise<AdapterResult<IodaState>> {
    const def = getSource(SOURCE_ID)!;
    const until = Math.floor(ctx.now / 1000);
    // First run: 7 days (the API returns at most 500 rows; 30 days of country events exceeds that).
    const from = until - (ctx.state ? WINDOW_DAYS : 7) * 86_400;
    const url = `${def.endpoint}?from=${from}&until=${until}&entityType=country&limit=500`;
    const res = await ctx.fetch(url);
    if (res.kind === 'not-modified') return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: ctx.state! };

    const doc = JSON.parse(res.body) as { data?: IodaEvent[]; error?: unknown };
    if (doc.error) throw new Error(`IODA error: ${String(doc.error).slice(0, 200)}`);
    const rows = Array.isArray(doc.data) ? doc.data : [];
    const nowIso = new Date(ctx.now).toISOString();
    const events: IntelligenceEvent[] = [];
    const rejected: AdapterResult<IodaState>['rejected'] = [];

    for (const r of rows) {
      const loc = typeof r.location === 'string' ? r.location : '';
      const m = loc.match(/^country\/([A-Z]{2})$/);
      const start = typeof r.start === 'number' ? r.start : NaN;
      const duration = typeof r.duration === 'number' ? r.duration : NaN;
      const ds = typeof r.datasource === 'string' ? r.datasource : '';
      if (!m || !Number.isFinite(start) || !ds) {
        rejected.push({ ref: loc || '(no location)', reason: 'not a country-level event with start and signal' });
        continue;
      }
      if (start * 1000 < ctx.now - (FIRST_RUN_LOOKBACK_DAYS + 1) * DAY) continue;
      if (!(duration >= MIN_DURATION_HOURS * 3600)) continue;
      const iso = m[1];
      const name = cleanText(typeof r.location_name === 'string' ? r.location_name : iso);
      const startIso = new Date(start * 1000).toISOString();
      const ongoing = Number.isFinite(duration) && start + duration >= until - 3600;
      const hours = Number.isFinite(duration) ? Math.round(duration / 3600) : null;
      const link = `https://ioda.inetintel.cc.gatech.edu/country/${iso}?from=${start - 86_400}&until=${Math.min(until, start + Math.max(duration || 0, 86_400) + 86_400)}`;
      const id = contentHash(SOURCE_ID, iso, ds, start);
      events.push({
        id,
        contentHash: id,
        dataOrigin: 'live',
        sourceId: SOURCE_ID,
        sourceName: `IODA — ${def.name}`,
        sourceClass: 'scientific',
        sourceUrl: link,
        title: truncate(`Internet connectivity drop detected — ${name} (${ds.toUpperCase()})`, LIMITS.title),
        summary: truncate(
          `IODA detected a drop in ${DATASOURCE[ds] ?? ds} for ${name}, starting ${startIso}` +
            (hours !== null ? `${ongoing ? ', still ongoing at collection' : ''}, ${hours} h at collection time` : '') +
            '. A connectivity drop can come from a shutdown, power cut, cable fault or measurement artefact; IODA does not say which.',
          LIMITS.summary,
        ),
        category: 'cyber',
        regionIds: regionsForCountry(iso),
        countryCodes: [iso],
        publishedAt: startIso,
        occurredAt: startIso,
        collectedAt: nowIso,
        credibility: 'official',
        verificationStatus: 'unreviewed',
        locationPrecision: 'country',
        metadata: {
          subtype: 'internet-outage',
          signal: ds,
          method: typeof r.method === 'string' ? r.method : null,
          score: typeof r.score === 'number' ? Math.round(r.score) : null,
          durationHoursAtCollection: hours,
          ongoingAtCollection: ongoing,
          minDurationHours: MIN_DURATION_HOURS,
          geoBasis: 'source-country',
        },
      });
    }

    return { events, rejected, itemsSeen: rows.length, notModified: false, state: { firstRunAt: ctx.state?.firstRunAt ?? nowIso } };
  },
};
