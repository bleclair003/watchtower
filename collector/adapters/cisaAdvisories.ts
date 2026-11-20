import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { getSource } from '../../shared/domain/sources.ts';
import { parseFeed } from '../lib/feed.ts';
import { parseFeedDate } from '../lib/dates.ts';
import { contentHash } from '../lib/hash.ts';
import { LIMITS, cleanText, htmlToText, safeUrl, truncate } from '../lib/text.ts';
import type { Validators } from '../lib/http.ts';
import {
  FIRST_RUN_LOOKBACK_DAYS,
  STEADY_LOOKBACK_DAYS,
  type AdapterContext,
  type AdapterResult,
  type SourceAdapter,
} from './types.ts';

const SOURCE_ID = 'cisa-advisories';
const DAY = 86_400_000;

export type CisaSubtype =
  | 'ics-advisory'
  | 'ics-medical-advisory'
  | 'alert'
  | 'kev-announcement'
  | 'joint-advisory'
  | 'analysis-report'
  | 'guidance'
  | 'other';

/**
 * Classifies a CISA item by URL path (how CISA itself organizes them).
 * "CISA Adds N Known Exploited Vulnerabilities to Catalog" alerts merely
 * announce KEV additions, which WATCHTOWER already collects from the KEV feed —
 * they are classed separately so the same evidence is not counted twice.
 */
export function cisaSubtype(url: string, title = ''): CisaSubtype {
  const p = new URL(url).pathname;
  if (/known-exploited-vulnerabilit/.test(p) || /known exploited vulnerabilit/i.test(title)) return 'kev-announcement';
  if (p.includes('/resources-tools/')) return 'guidance';
  if (p.includes('/ics-medical-advisories/')) return 'ics-medical-advisory';
  if (p.includes('/ics-advisories/')) return 'ics-advisory';
  if (p.includes('/cybersecurity-advisories/aa')) return 'joint-advisory';
  if (p.includes('/analysis-reports/')) return 'analysis-report';
  if (p.includes('/alerts/')) return 'alert';
  return 'other';
}

const SUBTYPE_LABEL: Record<CisaSubtype, string> = {
  'ics-advisory': 'ICS advisory',
  'ics-medical-advisory': 'ICS medical advisory',
  alert: 'Alert',
  'kev-announcement': 'KEV announcement',
  guidance: 'Guidance',
  'joint-advisory': 'Joint cybersecurity advisory',
  'analysis-report': 'Analysis report',
  other: 'Advisory',
};

export interface CisaAdvisoryState {
  validators: Validators;
  firstRunAt: string;
}

/** CISA cybersecurity advisories RSS (ICS advisories, alerts, joint advisories). */
export const cisaAdvisories: SourceAdapter<CisaAdvisoryState> = {
  sourceId: SOURCE_ID,

  async collect(ctx: AdapterContext<CisaAdvisoryState>): Promise<AdapterResult<CisaAdvisoryState>> {
    const def = getSource(SOURCE_ID)!;
    const res = await ctx.fetch(def.endpoint!, ctx.state?.validators);
    if (res.kind === 'not-modified') return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: ctx.state! };

    const items = parseFeed(res.body);
    const nowIso = new Date(ctx.now).toISOString();
    const lookback = ctx.now - (ctx.state ? STEADY_LOOKBACK_DAYS : FIRST_RUN_LOOKBACK_DAYS) * DAY;
    const events: IntelligenceEvent[] = [];
    const rejected: AdapterResult<CisaAdvisoryState>['rejected'] = [];

    for (const item of items) {
      const url = safeUrl(item.link, 'https://www.cisa.gov/');
      const title = cleanText(item.title);
      const publishedAt = parseFeedDate(item.published);
      if (!url || !title) {
        rejected.push({ ref: truncate(title || '(untitled)', 80), reason: !url ? 'invalid link' : 'empty title' });
        continue;
      }
      if (publishedAt && Date.parse(publishedAt) < lookback) continue;

      const subtype = cisaSubtype(url, title);
      const summary = htmlToText(item.description).replace(/^View CSAF\.?\s*/i, '').replace(/^Summary\.?\s*/i, '');
      const id = contentHash(SOURCE_ID, url);
      events.push({
        id,
        contentHash: id,
        dataOrigin: 'live',
        sourceId: SOURCE_ID,
        sourceName: `CISA — ${def.name}`,
        sourceClass: 'official',
        sourceUrl: url,
        title: truncate(['alert', 'other', 'kev-announcement'].includes(subtype) ? title : `${SUBTYPE_LABEL[subtype]}: ${title}`, LIMITS.title),
        summary: truncate(summary, LIMITS.summary) || undefined,
        category: 'cyber',
        regionIds: ['global-cyber'],
        countryCodes: [],
        publishedAt,
        occurredAt: null,
        collectedAt: nowIso,
        credibility: 'official',
        verificationStatus: 'unreviewed',
        locationPrecision: 'none',
        metadata: { subtype, routine: ['ics-advisory', 'ics-medical-advisory', 'kev-announcement', 'guidance'].includes(subtype) },
      });
    }

    return {
      events,
      rejected,
      itemsSeen: items.length,
      notModified: false,
      state: { validators: res.validators, firstRunAt: ctx.state?.firstRunAt ?? nowIso },
    };
  },
};
