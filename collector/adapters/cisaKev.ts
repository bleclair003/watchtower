import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { getSource } from '../../shared/domain/sources.ts';
import { contentHash } from '../lib/hash.ts';
import { LIMITS, cleanText, truncate } from '../lib/text.ts';
import type { Validators } from '../lib/http.ts';
import {
  FIRST_RUN_LOOKBACK_DAYS,
  STEADY_LOOKBACK_DAYS,
  type AdapterContext,
  type AdapterResult,
  type SourceAdapter,
} from './types.ts';

const SOURCE_ID = 'cisa-kev';
const DAY = 86_400_000;
const CATALOG_PAGE = 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog';

interface KevEntry {
  cveID?: unknown;
  vendorProject?: unknown;
  product?: unknown;
  vulnerabilityName?: unknown;
  dateAdded?: unknown;
  shortDescription?: unknown;
  requiredAction?: unknown;
  dueDate?: unknown;
  knownRansomwareCampaignUse?: unknown;
}

export interface CisaKevState {
  validators: Validators;
  catalogVersion: string | null;
  firstRunAt: string;
  /** Entries added in the last 30 days (for the CYBER page and EPSS scores). */
  recent?: KevRecent[];
}

export interface KevRecent {
  cve: string;
  vendor: string;
  product: string;
  name: string;
  added: string;
  due: string | null;
  ransomware: boolean;
}

const str = (v: unknown, max = 200) => (typeof v === 'string' ? truncate(cleanText(v), max) : '');

/** CISA Known Exploited Vulnerabilities catalog (JSON). One event per newly added CVE. */
export const cisaKev: SourceAdapter<CisaKevState> = {
  sourceId: SOURCE_ID,

  async collect(ctx: AdapterContext<CisaKevState>): Promise<AdapterResult<CisaKevState>> {
    const def = getSource(SOURCE_ID)!;
    // Without the 30-day list (state from before v0.51.0), read the whole catalog once instead of asking 'modified?'.
    const res = await ctx.fetch(def.endpoint!, ctx.state?.recent ? ctx.state.validators : undefined);
    if (res.kind === 'not-modified') return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: ctx.state! };

    let doc: { catalogVersion?: unknown; vulnerabilities?: unknown };
    try {
      doc = JSON.parse(res.body) as typeof doc;
    } catch (err) {
      throw new Error(`KEV JSON parse failed: ${(err as Error).message}`);
    }
    if (!Array.isArray(doc.vulnerabilities)) throw new Error('KEV JSON has no vulnerabilities array');

    const nowIso = new Date(ctx.now).toISOString();
    const lookback = ctx.now - (ctx.state ? STEADY_LOOKBACK_DAYS : FIRST_RUN_LOOKBACK_DAYS) * DAY;
    const events: IntelligenceEvent[] = [];
    const rejected: AdapterResult<CisaKevState>['rejected'] = [];

    for (const raw of doc.vulnerabilities as KevEntry[]) {
      const cve = str(raw.cveID, 40);
      const added = typeof raw.dateAdded === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.dateAdded) ? raw.dateAdded : null;
      if (!/^CVE-\d{4}-\d{4,}$/.test(cve) || !added) {
        rejected.push({ ref: cve || '(no CVE id)', reason: !added ? 'invalid dateAdded' : 'invalid CVE id' });
        continue;
      }
      const publishedAt = `${added}T00:00:00.000Z`;
      if (Date.parse(publishedAt) < lookback) continue;

      const ransomware = str(raw.knownRansomwareCampaignUse, 20) === 'Known';
      const id = contentHash(SOURCE_ID, cve);
      const vendor = str(raw.vendorProject, 80);
      const product = str(raw.product, 80);
      events.push({
        id,
        contentHash: id,
        dataOrigin: 'live',
        sourceId: SOURCE_ID,
        sourceName: `CISA — ${def.name}`,
        sourceClass: 'official',
        sourceUrl: `${CATALOG_PAGE}?search_api_fulltext=${encodeURIComponent(cve)}`,
        title: truncate(`KEV added: ${cve} — ${vendor} ${product}${ransomware ? ' (known ransomware use)' : ''}`, LIMITS.title),
        summary:
          truncate(
            [str(raw.vulnerabilityName), str(raw.shortDescription, 400), raw.dueDate ? `Federal remediation due ${str(raw.dueDate, 20)}.` : '']
              .filter(Boolean)
              .join('. '),
            LIMITS.summary,
          ) || undefined,
        category: 'cyber',
        regionIds: ['global-cyber'],
        countryCodes: [],
        publishedAt,
        occurredAt: null,
        collectedAt: nowIso,
        credibility: 'official',
        verificationStatus: 'unreviewed',
        locationPrecision: 'none',
        metadata: { cve, vendor, product, knownRansomwareUse: ransomware, catalogVersion: str(doc.catalogVersion, 20) || null },
      });
    }

    const recent: KevRecent[] = (doc.vulnerabilities as KevEntry[])
      .filter((v) => typeof v.dateAdded === 'string' && Date.parse(`${v.dateAdded}T00:00:00Z`) >= ctx.now - 30 * DAY && /^CVE-\d{4}-\d{4,}$/.test(str(v.cveID, 40)))
      .map((v) => ({
        cve: str(v.cveID, 40),
        vendor: str(v.vendorProject, 80),
        product: str(v.product, 80),
        name: str(v.vulnerabilityName, 160),
        added: String(v.dateAdded),
        due: typeof v.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.dueDate) ? v.dueDate : null,
        ransomware: str(v.knownRansomwareCampaignUse, 20) === 'Known',
      }));
    return {
      events,
      rejected,
      itemsSeen: doc.vulnerabilities.length,
      notModified: false,
      state: {
        validators: res.validators,
        catalogVersion: str(doc.catalogVersion, 20) || null,
        firstRunAt: ctx.state?.firstRunAt ?? nowIso,
        recent,
      },
    };
  },
};
