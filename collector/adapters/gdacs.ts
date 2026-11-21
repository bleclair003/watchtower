import { XMLParser } from 'fast-xml-parser';
import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { getSource } from '../../shared/domain/sources.ts';
import { regionsForCountry } from '../../shared/domain/regions.ts';
import { regionsForExactPoint } from '../geo/countries.ts';
import { parseFeedDate } from '../lib/dates.ts';
import { contentHash } from '../lib/hash.ts';
import { FeedParseError } from '../lib/feed.ts';
import { LIMITS, cleanText, decodeEntities, safeUrl, truncate } from '../lib/text.ts';
import type { Validators } from '../lib/http.ts';
import { FIRST_RUN_LOOKBACK_DAYS, STEADY_LOOKBACK_DAYS, type AdapterContext, type AdapterResult, type SourceAdapter } from './types.ts';

const SOURCE_ID = 'gdacs';
const DAY = 86_400_000;

export interface GdacsState {
  validators: Validators;
  firstRunAt: string;
}

const EVENT_TYPES: Record<string, string> = {
  EQ: 'Earthquake',
  TC: 'Tropical cyclone',
  FL: 'Flood',
  VO: 'Volcano',
  DR: 'Drought',
  WF: 'Wildfire',
  TS: 'Tsunami',
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  processEntities: false,
  htmlEntities: false,
  isArray: (name) => name === 'item',
  trimValues: true,
});

const str = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'object' && '#text' in (v as Record<string, unknown>)) return String((v as Record<string, unknown>)['#text']);
  return '';
};

/** ISO3 → ISO2 for the countries GDACS reports most; unknown codes are left unmapped, never guessed. */
const ISO3: Record<string, string> = {
  AFG: 'AF', BGD: 'BD', CHN: 'CN', COD: 'CD', DJI: 'DJ', EGY: 'EG', ERI: 'ER', ETH: 'ET', IDN: 'ID', IND: 'IN', IRN: 'IR', IRQ: 'IQ',
  ISR: 'IL', JOR: 'JO', JPN: 'JP', KEN: 'KE', KOR: 'KR', LBN: 'LB', MMR: 'MM', MOZ: 'MZ', MYS: 'MY', NPL: 'NP', OMN: 'OM', PAK: 'PK',
  PHL: 'PH', PRK: 'KP', PSE: 'PS', RUS: 'RU', SAU: 'SA', SDN: 'SD', SOM: 'SO', SSD: 'SS', SYR: 'SY', THA: 'TH', TUR: 'TR', TWN: 'TW',
  UKR: 'UA', USA: 'US', VNM: 'VN', YEM: 'YE', MDG: 'MG', MEX: 'MX', AUS: 'AU', BRA: 'BR', CHL: 'CL', PER: 'PE', ECU: 'EC', COL: 'CO',
  GRC: 'GR', ITA: 'IT', NZL: 'NZ', PNG: 'PG', VUT: 'VU', TON: 'TO', FJI: 'FJ', SLB: 'SB', BRN: 'BN', KHM: 'KH', LAO: 'LA', LKA: 'LK',
  ARE: 'AE', QAT: 'QA', KWT: 'KW', BHR: 'BH', MDA: 'MD', POL: 'PL', ROU: 'RO', BLR: 'BY', LTU: 'LT', LVA: 'LV', EST: 'EE', NGA: 'NG',
  NER: 'NE', TCD: 'TD', MLI: 'ML', BFA: 'BF', CMR: 'CM', ZAF: 'ZA', ZWE: 'ZW', MWI: 'MW', TZA: 'TZ', UGA: 'UG', HTI: 'HT', CUB: 'CU',
};

/**
 * GDACS (Global Disaster Alert and Coordination System; EC JRC + UN OCHA).
 *
 * Imports Orange and Red alerts anywhere, and Green alerts only inside a watch area
 * (Green means low expected humanitarian impact; worldwide they are mostly routine
 * wildfires). Coordinates are GDACS's event point, so precision is `exact`.
 * An alert-level change creates a new record (the id includes the level).
 * Licence: CC BY 4.0, credit GDACS.
 */
export const gdacs: SourceAdapter<GdacsState> = {
  sourceId: SOURCE_ID,
  async collect(ctx: AdapterContext<GdacsState>): Promise<AdapterResult<GdacsState>> {
    const def = getSource(SOURCE_ID)!;
    const res = await ctx.fetch(def.endpoint!, ctx.state?.validators);
    if (res.kind === 'not-modified') return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: ctx.state! };
    if (/<!ENTITY/i.test(res.body)) throw new FeedParseError('Feed declares XML entities; refused');

    let doc: Record<string, unknown>;
    try {
      doc = parser.parse(res.body) as Record<string, unknown>;
    } catch (err) {
      throw new FeedParseError(`XML parse failed: ${(err as Error).message}`);
    }
    const items = (((doc.rss as Record<string, unknown> | undefined)?.channel as Record<string, unknown> | undefined)?.item ?? []) as Record<string, unknown>[];
    const nowIso = new Date(ctx.now).toISOString();
    const lookback = ctx.now - (ctx.state ? STEADY_LOOKBACK_DAYS : FIRST_RUN_LOOKBACK_DAYS) * DAY;
    const events: IntelligenceEvent[] = [];
    const rejected: AdapterResult<GdacsState>['rejected'] = [];

    for (const it of items) {
      const level = str(it['gdacs:alertlevel']);
      const type = str(it['gdacs:eventtype']);
      const eventId = str(it['gdacs:eventid']);
      const point = it['geo:Point'] as Record<string, unknown> | undefined;
      const lat = Number(str(point?.['geo:lat']));
      const lon = Number(str(point?.['geo:long']));
      const title = cleanText(decodeEntities(str(it.title)));
      const url = safeUrl(decodeEntities(str(it.link)).replace(/^http:\/\//, 'https://'));
      if (!eventId || !type || !title || !url || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        rejected.push({ ref: truncate(title || eventId || '(untitled)', 80), reason: 'missing id, type, link or coordinates' });
        continue;
      }
      const regionIds = regionsForExactPoint(lat, lon);
      if (!['Orange', 'Red'].includes(level) && !(level === 'Green' && regionIds.length)) continue;

      const from = parseFeedDate(str(it['gdacs:fromdate']));
      const added = parseFeedDate(str(it['gdacs:dateadded'])) ?? parseFeedDate(str(it.pubDate));
      const modified = parseFeedDate(str(it['gdacs:datemodified']));
      const ref = modified ?? added;
      if (ref && Date.parse(ref) < lookback) continue;

      const iso = ISO3[str(it['gdacs:iso3']).toUpperCase()] ?? null;
      const country = cleanText(decodeEntities(str(it['gdacs:country'])));
      const severity = cleanText(decodeEntities(str(it['gdacs:severity'])));
      const id = contentHash(SOURCE_ID, type, eventId, level);
      events.push({
        id,
        contentHash: id,
        dataOrigin: 'live',
        sourceId: SOURCE_ID,
        sourceName: `GDACS — ${def.name}`,
        sourceClass: 'scientific',
        sourceUrl: url,
        title: truncate(`${level.toUpperCase()} alert — ${EVENT_TYPES[type] ?? type}${country ? ` — ${country}` : ''}${severity ? ` (${severity})` : ''}`, LIMITS.title),
        summary: truncate(cleanText(decodeEntities(str(it.description))), LIMITS.summary) || undefined,
        category: 'disaster',
        regionIds: [...new Set([...regionIds, ...(iso ? regionsForCountry(iso) : [])])],
        countryCodes: iso ? [iso] : [],
        publishedAt: added,
        occurredAt: from,
        collectedAt: nowIso,
        credibility: 'official',
        verificationStatus: 'unreviewed',
        latitude: lat,
        longitude: lon,
        locationPrecision: 'exact',
        metadata: {
          gdacsEventId: eventId,
          eventType: type,
          alertLevel: level,
          alertScore: Number(str(it['gdacs:alertscore'])) || 0,
          episodeId: str(it['gdacs:episodeid']) || null,
          geoBasis: 'source-coordinates',
          licence: 'CC BY 4.0 — GDACS',
        },
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
