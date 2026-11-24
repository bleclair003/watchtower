import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { regionsForCountry } from '../../shared/domain/regions.ts';
import { CANADA_LEVEL_LABEL, CANADA_TRAVEL_SOURCE_ID } from '../../shared/domain/travelAdvice.ts';
import { contentHash } from '../lib/hash.ts';
import type { Validators } from '../lib/http.ts';
import { LIMITS, truncate } from '../lib/text.ts';
import { FIRST_RUN_LOOKBACK_DAYS, type AdapterContext, type AdapterResult, type SourceAdapter } from './types.ts';

/**
 * Canada's travel advice and advisories (v0.83.0): Global Affairs Canada's open data file (Open Government
 * Licence – Canada), one entry per country with a level from 0 (take normal security precautions) to 3
 * (avoid all travel). A record when a level is raised or lowered, or a country appears; text-only updates
 * at the same level are not recorded (they are frequent and say nothing about risk). The first read is a
 * baseline, except countries at level 2 or 3 published in the last 30 days.
 */

export const CANADA_TRAVEL_URL = 'https://data.international.gc.ca/travel-voyage/index-updated.json';
const PAGE = (slug: string) => `https://travel.gc.ca/destinations/${encodeURIComponent(slug)}`;
const DAY = 86_400_000;

interface RawCountry {
  'country-iso'?: string;
  'advisory-state'?: number;
  'has-regional-advisory'?: number;
  'recent-updates-type'?: string;
  'date-published'?: { date?: string; asp?: string };
  eng?: { name?: string; 'url-slug'?: string; 'advisory-text'?: string; 'recent-updates'?: string };
}

export interface CanadaTravelState {
  validators?: Validators;
  levels: Record<string, { level: number; publishedAt: string | null }>;
  baselineAt: string;
  fetchedAt: string;
}

export type CanadaChange = 'initial' | 'new' | 'raised' | 'lowered';

const isoDate = (s: string | undefined) => {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

export function canadaEvent(iso: string, c: RawCountry, level: number, previous: number | null, change: CanadaChange, nowIso: string): IntelligenceEvent {
  const name = c.eng?.name?.trim() || iso;
  const publishedAt = isoDate(c['date-published']?.asp ?? c['date-published']?.date);
  const label = c.eng?.['advisory-text']?.trim() || CANADA_LEVEL_LABEL[level];
  const suffix =
    change === 'raised' ? ` (raised from “${CANADA_LEVEL_LABEL[previous!]}”)` : change === 'lowered' ? ` (lowered from “${CANADA_LEVEL_LABEL[previous!]}”)` : '';
  const regional = c['has-regional-advisory'] ? ' Regional advisories also apply.' : '';
  const id = contentHash(CANADA_TRAVEL_SOURCE_ID, iso, publishedAt, level);
  // Canada advises on "Israel and Palestine" together.
  const codes = iso === 'IL' && /palestin/i.test(name) ? ['IL', 'PS'] : [iso];
  return {
    id,
    contentHash: id,
    dataOrigin: 'live',
    sourceId: CANADA_TRAVEL_SOURCE_ID,
    sourceName: 'Global Affairs Canada — travel advice and advisories',
    sourceClass: 'official',
    sourceUrl: c.eng?.['url-slug'] ? PAGE(c.eng['url-slug']) : 'https://travel.gc.ca/travelling/advisories',
    title: truncate(`${name} — Canada: ${label}${suffix}`, LIMITS.title),
    summary: truncate(
      `Canada's advice for ${name}: ${label} (level ${level} of 3).${regional}${c.eng?.['recent-updates'] ? ` Latest update: ${c.eng['recent-updates']}.` : ''} Contains information licensed under the Open Government Licence – Canada.`,
      LIMITS.summary,
    ),
    category: 'diplomatic',
    regionIds: [...new Set(codes.flatMap(regionsForCountry))],
    countryCodes: codes,
    publishedAt,
    occurredAt: null,
    collectedAt: nowIso,
    credibility: 'official',
    verificationStatus: 'unreviewed',
    locationPrecision: 'country',
    metadata: {
      // Canada's 0–3 mapped to 1–4, the scale the US uses, so rules can compare them.
      advisoryLevel: level + 1,
      previousLevel: previous === null ? null : previous + 1,
      canadaLevel: level,
      change,
      regionalAdvisory: !!c['has-regional-advisory'],
      updateType: c['recent-updates-type'] ?? null,
      geoBasis: 'source-country',
    },
  };
}

export const canadaTravel: SourceAdapter<CanadaTravelState> = {
  sourceId: CANADA_TRAVEL_SOURCE_ID,
  async collect(ctx: AdapterContext<CanadaTravelState>): Promise<AdapterResult<CanadaTravelState>> {
    const prev = ctx.state;
    const nowIso = new Date(ctx.now).toISOString();
    const res = await ctx.fetch(CANADA_TRAVEL_URL, prev?.validators, { Accept: 'application/json' }, { maxBytes: 4_000_000 });
    if (res.kind === 'not-modified') return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: { ...prev!, fetchedAt: nowIso } };
    const data = (JSON.parse(res.body) as { data?: Record<string, RawCountry> }).data;
    if (!data || typeof data !== 'object') throw new Error('Canada travel advice: no data object');
    const levels = { ...(prev?.levels ?? {}) };
    const events: IntelligenceEvent[] = [];
    const rejected: AdapterResult<CanadaTravelState>['rejected'] = [];
    let seen = 0;
    for (const c of Object.values(data)) {
      seen++;
      const iso = String(c['country-iso'] ?? '').toUpperCase();
      const level = c['advisory-state'];
      // Sub-national entries (the Azores is "PT-20") are skipped, not errors.
      if (!iso || /^[A-Z]{2}-/.test(iso)) continue;
      if (!/^[A-Z]{2}$/.test(iso) || typeof level !== 'number' || level < 0 || level > 3) {
        rejected.push({ ref: truncate(c.eng?.name ?? iso, 80), reason: 'invalid country code or level' });
        continue;
      }
      const publishedAt = isoDate(c['date-published']?.asp ?? c['date-published']?.date);
      const known = levels[iso];
      levels[iso] = { level, publishedAt };
      let change: CanadaChange | null;
      if (!known) change = prev ? 'new' : 'initial';
      else if (level > known.level) change = 'raised';
      else if (level < known.level) change = 'lowered';
      else change = null;
      if (!change) continue;
      if (change === 'initial') {
        const t = publishedAt ? Date.parse(publishedAt) : NaN;
        if (level < 2 || !(t >= ctx.now - FIRST_RUN_LOOKBACK_DAYS * DAY)) continue;
      }
      events.push(canadaEvent(iso, c, level, known?.level ?? null, change, nowIso));
    }
    if (seen < 100) throw new Error(`Canada travel advice: only ${seen} countries in the file`);
    return {
      events,
      rejected,
      itemsSeen: seen,
      notModified: false,
      state: { validators: res.validators, levels, baselineAt: prev?.baselineAt ?? nowIso, fetchedAt: nowIso },
    };
  },
};
