import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { regionsForCountry } from '../../shared/domain/regions.ts';
import { getSource } from '../../shared/domain/sources.ts';
import { parseFeed } from '../lib/feed.ts';
import { parseFeedDate } from '../lib/dates.ts';
import { contentHash } from '../lib/hash.ts';
import { advisoryToIso } from '../lib/fips.ts';
import { LIMITS, cleanText, htmlToText, safeUrl, truncate } from '../lib/text.ts';
import type { Validators } from '../lib/http.ts';
import { FIRST_RUN_LOOKBACK_DAYS, type AdapterContext, type AdapterResult, type SourceAdapter } from './types.ts';

const SOURCE_ID = 'state-travel-advisories';
const DAY = 86_400_000;

export type AdvisoryChange = 'initial' | 'new' | 'raised' | 'lowered' | 'reissued';

export interface StateAdvisoryState {
  validators: Validators;
  /** Last known level per advisory (keyed by advisory URL), the baseline for change detection. */
  advisories: Record<string, { name: string; iso: string | null; level: number; publishedAt: string | null }>;
  baselineAt: string;
}

/** "Yemen - Level 4: Do Not Travel" → { name: "Yemen", level: 4, label: "Do Not Travel" } */
export function parseAdvisoryTitle(title: string): { name: string; level: number; label: string } | null {
  const m = cleanText(title).match(/^(.*?)\s+-\s+Level\s+([1-4])\s*:\s*(.+)$/i);
  if (!m) return null;
  return { name: m[1].replace(/\s+Travel Advisory$/i, '').trim(), level: Number(m[2]), label: m[3].trim() };
}

const CHANGE_SUFFIX: Record<AdvisoryChange, (prev?: number) => string> = {
  initial: () => '',
  new: () => ' — NEW ADVISORY',
  raised: (p) => ` — RAISED from Level ${p}`,
  lowered: (p) => ` — LOWERED from Level ${p}`,
  reissued: () => ' — reissued, level unchanged',
};

/**
 * U.S. State Department travel advisories.
 *
 * Each feed item is the *current* advisory for one country. WATCHTOWER keeps
 * the last-seen level per advisory and emits an event only when an advisory is
 * (re)published, labelling whether the level was raised, lowered or unchanged.
 * On the very first run, it records a baseline and imports only advisories
 * published in the last FIRST_RUN_LOOKBACK_DAYS — older ones are not news.
 */
export const stateTravelAdvisories: SourceAdapter<StateAdvisoryState> = {
  sourceId: SOURCE_ID,

  async collect(ctx: AdapterContext<StateAdvisoryState>): Promise<AdapterResult<StateAdvisoryState>> {
    const def = getSource(SOURCE_ID)!;
    const prev = ctx.state;
    const res = await ctx.fetch(def.endpoint!, prev?.validators);
    if (res.kind === 'not-modified') {
      return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: prev! };
    }

    const items = parseFeed(res.body);
    const nowIso = new Date(ctx.now).toISOString();
    const firstRun = !prev;
    const advisories = { ...(prev?.advisories ?? {}) };
    const events: IntelligenceEvent[] = [];
    const rejected: AdapterResult<StateAdvisoryState>['rejected'] = [];

    for (const item of items) {
      const parsed = parseAdvisoryTitle(item.title);
      const url = safeUrl(item.link);
      if (!parsed || !url) {
        rejected.push({ ref: truncate(cleanText(item.title) || '(untitled)', 80), reason: !parsed ? 'unrecognized advisory title' : 'invalid link' });
        continue;
      }
      const fips = item.categories.find((c) => c.domain === 'Country-Tag')?.value;
      const iso = advisoryToIso(fips, parsed.name);
      const publishedAt = parseFeedDate(item.published);
      const known = advisories[url];

      let change: AdvisoryChange | null;
      if (!known) change = firstRun ? 'initial' : 'new';
      else if (publishedAt && known.publishedAt && publishedAt <= known.publishedAt && parsed.level === known.level) change = null;
      else if (parsed.level > known.level) change = 'raised';
      else if (parsed.level < known.level) change = 'lowered';
      else if (publishedAt !== known.publishedAt) change = 'reissued';
      else change = null;

      advisories[url] = { name: parsed.name, iso, level: parsed.level, publishedAt };
      if (!change) continue;

      // First run: baseline only for anything older than the lookback window.
      if (change === 'initial') {
        const t = publishedAt ? Date.parse(publishedAt) : NaN;
        if (!(t >= ctx.now - FIRST_RUN_LOOKBACK_DAYS * DAY)) continue;
      }

      const id = contentHash(SOURCE_ID, url, publishedAt, parsed.level);
      events.push({
        id,
        contentHash: id,
        dataOrigin: 'live',
        sourceId: SOURCE_ID,
        sourceName: `${def.organization} — ${def.name}`,
        sourceClass: 'official',
        sourceUrl: url,
        title: truncate(`${parsed.name} — Level ${parsed.level}: ${parsed.label}${CHANGE_SUFFIX[change](known?.level)}`, LIMITS.title),
        summary: truncate(htmlToText(item.description), LIMITS.summary) || undefined,
        category: 'diplomatic',
        regionIds: iso ? regionsForCountry(iso) : [],
        countryCodes: iso ? [iso] : [],
        publishedAt,
        occurredAt: null,
        collectedAt: nowIso,
        credibility: 'official',
        verificationStatus: 'unreviewed',
        locationPrecision: iso ? 'country' : 'none',
        metadata: {
          advisoryLevel: parsed.level,
          previousLevel: known?.level ?? null,
          change,
          fipsTag: fips ?? null,
          advisoryName: parsed.name,
        },
      });
    }

    return {
      events,
      rejected,
      itemsSeen: items.length,
      notModified: false,
      state: { validators: res.validators, advisories, baselineAt: prev?.baselineAt ?? nowIso },
    };
  },
};
