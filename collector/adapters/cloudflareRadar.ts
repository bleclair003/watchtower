import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { regionsForCountry } from '../../shared/domain/regions.ts';
import { getSource } from '../../shared/domain/sources.ts';
import { contentHash } from '../lib/hash.ts';
import { readSecret } from '../lib/secrets.ts';
import { LIMITS, cleanText, safeUrl, truncate } from '../lib/text.ts';
import { FIRST_RUN_LOOKBACK_DAYS, type AdapterContext, type AdapterResult, type SourceAdapter } from './types.ts';

const SOURCE_ID = 'cloudflare-radar-outages';
export const RADAR_TOKEN_ENV = 'CLOUDFLARE_RADAR_TOKEN';
const STEADY_RANGE_DAYS = 7;

export interface RadarState {
  firstRunAt: string;
}

interface Annotation {
  id?: unknown;
  description?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  linkedUrl?: unknown;
  scope?: unknown;
  locations?: unknown;
  locationsDetails?: unknown;
  asns?: unknown;
  outage?: { outageCause?: unknown; outageType?: unknown };
}

const CAUSE_LABEL: Record<string, string> = {
  GOVERNMENT_DIRECTED: 'government-directed shutdown',
  MILITARY_ACTION: 'military action',
  CYBERATTACK: 'cyberattack',
  CABLE_CUT: 'cable cut',
  POWER_OUTAGE: 'power outage',
  NATURAL_DISASTER: 'natural disaster',
  WEATHER: 'weather',
  FIRE: 'fire',
  BLOCKING: 'blocking',
  MAINTENANCE: 'maintenance',
  TECHNICAL_PROBLEM: 'technical problem',
  NETWORK_PROBLEM: 'network problem',
  MISCONFIGURATION: 'misconfiguration',
  MECHANICAL: 'mechanical failure',
  SOFTWARE: 'software failure',
  DNS: 'DNS failure',
  UNKNOWN: 'unknown cause',
};

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/**
 * Cloudflare Radar Outage Center: internet outages that Cloudflare analysts have reviewed
 * and annotated with a cause and type. Complements IODA's automated detections with an
 * attributed cause. The cause is Cloudflare's assessment and is labelled as such.
 * Licence: CC BY-NC 4.0 (personal, non-commercial use; attribute Cloudflare Radar).
 */
export const cloudflareRadarOutages: SourceAdapter<RadarState> = {
  sourceId: SOURCE_ID,
  requiredEnv: [RADAR_TOKEN_ENV],
  async collect(ctx: AdapterContext<RadarState>): Promise<AdapterResult<RadarState>> {
    const token = readSecret(RADAR_TOKEN_ENV);
    if (!token) throw new Error(`${RADAR_TOKEN_ENV} is not set`);
    const def = getSource(SOURCE_ID)!;
    const range = ctx.state ? STEADY_RANGE_DAYS : FIRST_RUN_LOOKBACK_DAYS;
    const res = await ctx.fetch(`${def.endpoint}?dateRange=${range}d&limit=200&format=JSON`, undefined, { Authorization: `Bearer ${token}` });
    if (res.kind === 'not-modified') return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: ctx.state! };

    const doc = JSON.parse(res.body) as { success?: boolean; result?: { annotations?: Annotation[] }; errors?: unknown };
    if (doc.success === false) throw new Error(`Cloudflare Radar error: ${truncate(JSON.stringify(doc.errors ?? ''), 200)}`);
    const rows = Array.isArray(doc.result?.annotations) ? doc.result!.annotations! : [];
    const nowIso = new Date(ctx.now).toISOString();
    const events: IntelligenceEvent[] = [];
    const rejected: AdapterResult<RadarState>['rejected'] = [];

    for (const a of rows) {
      const id = str(a.id);
      const start = Date.parse(str(a.startDate));
      if (!id || Number.isNaN(start)) {
        rejected.push({ ref: id || '(no id)', reason: 'missing id or start date' });
        continue;
      }
      const locs = (Array.isArray(a.locations) ? a.locations : []).filter((l): l is string => typeof l === 'string' && /^[A-Z]{2}$/.test(l));
      const names = (Array.isArray(a.locationsDetails) ? a.locationsDetails : [])
        .map((d) => (d && typeof d === 'object' ? str((d as Record<string, unknown>).name) : ''))
        .filter(Boolean);
      const cause = str(a.outage?.outageCause).toUpperCase();
      const type = str(a.outage?.outageType).toUpperCase();
      const endIso = Number.isNaN(Date.parse(str(a.endDate))) ? null : new Date(Date.parse(str(a.endDate))).toISOString();
      const startIso = new Date(start).toISOString();
      const place = names.join(', ') || locs.join(', ') || cleanText(str(a.scope)) || 'location not stated';
      const desc = cleanText(str(a.description));
      const radarLink = locs[0] ? `https://radar.cloudflare.com/outage-center?location=${locs[0].toLowerCase()}` : 'https://radar.cloudflare.com/outage-center';
      const key = contentHash(SOURCE_ID, id);
      events.push({
        id: key,
        contentHash: key,
        dataOrigin: 'live',
        sourceId: SOURCE_ID,
        sourceName: `Cloudflare Radar — ${def.name}`,
        sourceClass: 'scientific',
        sourceUrl: safeUrl(a.linkedUrl) ?? radarLink,
        title: truncate(`Internet outage — ${place}: ${CAUSE_LABEL[cause] ?? 'cause not stated'}${type ? ` (${type.toLowerCase()})` : ''}`, LIMITS.title),
        summary: truncate(
          `${desc ? `${desc}. ` : ''}Cloudflare's attributed cause: ${CAUSE_LABEL[cause] ?? 'not stated'}. Started ${startIso}${endIso ? `, ended ${endIso}` : ', ongoing or end not recorded'}.`,
          LIMITS.summary,
        ),
        category: cause === 'MILITARY_ACTION' ? 'military' : cause === 'GOVERNMENT_DIRECTED' ? 'unrest' : 'cyber',
        regionIds: [...new Set(locs.flatMap(regionsForCountry))],
        countryCodes: locs,
        publishedAt: startIso,
        occurredAt: startIso,
        collectedAt: nowIso,
        credibility: 'official',
        verificationStatus: 'unreviewed',
        locationPrecision: locs.length ? 'country' : 'none',
        metadata: {
          subtype: 'internet-outage',
          radarId: id,
          outageCause: cause || null,
          outageType: type || null,
          endedAt: endIso,
          asns: Array.isArray(a.asns) ? a.asns.filter((n) => typeof n === 'number').slice(0, 20) : [],
          geoBasis: locs.length ? 'source-country' : 'none',
          licence: 'CC BY-NC 4.0 — Cloudflare Radar',
        },
      });
    }

    return { events, rejected, itemsSeen: rows.length, notModified: false, state: { firstRunAt: ctx.state?.firstRunAt ?? nowIso } };
  },
};
