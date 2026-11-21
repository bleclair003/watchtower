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

/** US embassy posture stated in an advisory: departure of US government staff, suspended operations. */
export interface EmbassyPosture {
  departure: 'ordered' | 'authorized' | null;
  suspended: boolean;
}

export interface StateAdvisoryState {
  validators: Validators;
  /**
   * Last known level per advisory (keyed by advisory URL), the baseline for change detection.
   * `posture` is absent for advisories recorded before v0.23.0 (then the first reading is a baseline).
   */
  advisories: Record<string, { name: string; iso: string | null; level: number; publishedAt: string | null; posture?: EmbassyPosture }>;
  baselineAt: string;
}

/**
 * Reads the embassy posture from an advisory's text. Ordered/authorized departure means the State
 * Department has ordered or allowed non-emergency US government staff (and/or families) to leave.
 * Wording that lifts or ends a departure counts as none.
 */
export function advisoryPosture(text: string): EmbassyPosture {
  const t = text.toLowerCase().replace(/\s+/g, ' ');
  const lifted = /(lifted|ended|terminated|concluded)[^.]{0,40}(ordered|authorized) departure/.test(t);
  const ordered = !lifted && /ordered (the )?departure|ordered[^.]{0,60}\bdeparture of\b/.test(t);
  const authorized = !lifted && !ordered && /authori[sz]ed (the )?departure|authori[sz]ed[^.]{0,60}\bdeparture of\b/.test(t);
  const resumed = /resumed (normal )?operations/.test(t);
  const suspended = !resumed && /suspended (its |all )?(normal )?operations|ceased operations|embassy[^.]{0,60}\b(is closed|has closed|closed its)\b/.test(t);
  return { departure: ordered ? 'ordered' : authorized ? 'authorized' : null, suspended };
}

export type PostureChange = 'ordered-departure' | 'authorized-departure' | 'operations-suspended' | 'departure-lifted' | 'operations-resumed';

export function postureChanges(before: EmbassyPosture, after: EmbassyPosture): PostureChange[] {
  const out: PostureChange[] = [];
  if (after.departure !== before.departure) {
    if (after.departure === 'ordered') out.push('ordered-departure');
    else if (after.departure === 'authorized') out.push('authorized-departure');
    else out.push('departure-lifted');
  }
  if (after.suspended && !before.suspended) out.push('operations-suspended');
  if (!after.suspended && before.suspended) out.push('operations-resumed');
  return out;
}

const POSTURE_TEXT: Record<PostureChange, string> = {
  'ordered-departure': 'ORDERED DEPARTURE of US government staff',
  'authorized-departure': 'AUTHORIZED DEPARTURE of US government staff',
  'operations-suspended': 'US EMBASSY OPERATIONS SUSPENDED',
  'departure-lifted': 'departure of US government staff lifted',
  'operations-resumed': 'US embassy operations resumed',
};

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

      const text = htmlToText(item.description);
      const posture = advisoryPosture(text);
      advisories[url] = { name: parsed.name, iso, level: parsed.level, publishedAt, posture };
      // Embassy posture changes are their own records (a reissue can add an ordered departure without a level change).
      if (known?.posture && change && change !== 'initial') {
        for (const pc of postureChanges(known.posture, posture)) {
          const pid = contentHash(SOURCE_ID, url, 'posture', publishedAt, pc);
          events.push({
            id: pid,
            contentHash: pid,
            dataOrigin: 'live',
            sourceId: SOURCE_ID,
            sourceName: `${def.organization} — ${def.name}`,
            sourceClass: 'official',
            sourceUrl: url,
            title: truncate(`${parsed.name}: ${POSTURE_TEXT[pc]} — State Department travel advisory (Level ${parsed.level})`, LIMITS.title),
            summary: truncate(text, LIMITS.summary) || undefined,
            category: 'diplomatic',
            regionIds: iso ? regionsForCountry(iso) : [],
            countryCodes: iso ? [iso] : [],
            publishedAt,
            occurredAt: null,
            collectedAt: nowIso,
            credibility: 'official',
            verificationStatus: 'unreviewed',
            locationPrecision: iso ? 'country' : 'none',
            metadata: { subtype: 'embassy-posture', postureChange: pc, advisoryLevel: parsed.level, advisoryName: parsed.name },
          });
        }
      }
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
          departure: posture.departure,
          operationsSuspended: posture.suspended,
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
