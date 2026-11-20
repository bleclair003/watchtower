import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { regionsForCountry } from '../../shared/domain/regions.ts';
import { getSource } from '../../shared/domain/sources.ts';
import { contentHash } from '../lib/hash.ts';
import { readSecret } from '../lib/secrets.ts';
import { LIMITS, cleanText, safeUrl, truncate } from '../lib/text.ts';
import { FIRST_RUN_LOOKBACK_DAYS, type AdapterContext, type AdapterResult, type SourceAdapter } from './types.ts';

const SOURCE_ID = 'cloudflare-radar-outages';
export const RADAR_TOKEN_ENV = 'CLOUDFLARE_RADAR_TOKEN';
/** Cloudflare annotates outages after review, sometimes days after they start, so every run reads 30 days. */
const STEADY_RANGE_DAYS = 30;

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
  asnsDetails?: unknown;
  entities?: unknown;
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
  revisable: true,
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
      // Country-scoped outages list `locations`; network-scoped ones (a single ISP or AS) put
      // the country inside each network's details instead.
      const nets = (Array.isArray(a.asnsDetails) ? a.asnsDetails : []).filter((d): d is Record<string, unknown> => !!d && typeof d === 'object');
      const netLoc = (d: Record<string, unknown>) => (d.location && typeof d.location === 'object' ? (d.location as Record<string, unknown>) : {});
      const iso2 = (v: unknown) => (typeof v === 'string' && /^[A-Z]{2}$/.test(v.toUpperCase()) ? v.toUpperCase() : null);
      const topLocs = (Array.isArray(a.locations) ? a.locations : []).map(iso2).filter((l): l is string => !!l);
      const netLocs = nets.map((d) => iso2(netLoc(d).code)).filter((l): l is string => !!l);
      // Regional outages (a province or state) describe the area as entities: name + country.
      const ents = (Array.isArray(a.entities) ? a.entities : []).filter((d): d is Record<string, unknown> => !!d && typeof d === 'object');
      const entLocs = ents.map((d) => iso2(d.entityLocation)).filter((l): l is string => !!l);
      const entNames = [...new Set(ents.map((d) => cleanText(str(d.entityName))).filter(Boolean))].slice(0, 3);
      const locs = [...new Set([...topLocs, ...netLocs, ...entLocs])];
      const locNames = (Array.isArray(a.locationsDetails) ? a.locationsDetails : [])
        .map((d) => (d && typeof d === 'object' ? str((d as Record<string, unknown>).name) : ''))
        .filter(Boolean);
      const netNames = [...new Set(nets.map((d) => str(netLoc(d).name)).filter(Boolean))];
      const names = locNames.length ? locNames : entNames.length ? [`${entNames.join(', ')}${entLocs[0] ? `, ${entLocs[0]}` : ''}`] : netNames;
      const networks = nets.map((d) => cleanText(str(d.name))).filter(Boolean).slice(0, 3);
      const cause = str(a.outage?.outageCause).toUpperCase();
      const type = str(a.outage?.outageType).toUpperCase();
      const endIso = Number.isNaN(Date.parse(str(a.endDate))) ? null : new Date(Date.parse(str(a.endDate))).toISOString();
      const startIso = new Date(start).toISOString();
      const place = names.join(', ') || locs.join(', ') || cleanText(str(a.scope)) || 'location not stated';
      const desc = cleanText(str(a.description));
      const linked = safeUrl(a.linkedUrl);
      // Some annotations link to Cloudflare's internal tracker, which outsiders cannot open.
      const publicLink = linked && !/(^|\.)cfdata\.org$/i.test(new URL(linked).hostname) ? linked : null;
      const radarLink = locs[0] ? `https://radar.cloudflare.com/outage-center?location=${locs[0].toLowerCase()}` : 'https://radar.cloudflare.com/outage-center';
      const key = contentHash(SOURCE_ID, id);
      events.push({
        id: key,
        contentHash: key,
        dataOrigin: 'live',
        sourceId: SOURCE_ID,
        sourceName: `Cloudflare Radar — ${def.name}`,
        sourceClass: 'scientific',
        sourceUrl: publicLink ?? radarLink,
        title: truncate(
          `Internet outage — ${place}${networks.length && !topLocs.length ? ` (${networks.join(', ')})` : ''}: ${CAUSE_LABEL[cause] ?? 'cause not stated'}${type ? ` (${type.toLowerCase()})` : ''}`,
          LIMITS.title,
        ),
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
          geoBasis: topLocs.length ? 'source-country' : entLocs.length ? 'source-country (affected area)' : netLocs.length ? 'source-country (network location)' : 'none',
          areas: entNames,
          networks,
          revisionKey: contentHash(cause, type, endIso ?? '', desc, locs.join(',')),
          licence: 'CC BY-NC 4.0 — Cloudflare Radar',
        },
      });
    }

    return { events, rejected, itemsSeen: rows.length, notModified: false, state: { firstRunAt: ctx.state?.firstRunAt ?? nowIso } };
  },
};
