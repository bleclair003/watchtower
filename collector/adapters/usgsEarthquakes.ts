import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { getSource } from '../../shared/domain/sources.ts';
import { regionsForPoint } from '../../shared/domain/regions.ts';
import { contentHash } from '../lib/hash.ts';
import { LIMITS, cleanText, safeUrl, truncate } from '../lib/text.ts';
import type { Validators } from '../lib/http.ts';
import { FIRST_RUN_LOOKBACK_DAYS, STEADY_LOOKBACK_DAYS, type AdapterContext, type AdapterResult, type SourceAdapter } from './types.ts';

const SOURCE_ID = 'usgs-earthquakes';
const DAY = 86_400_000;

export interface UsgsState {
  validators: Validators;
  firstRunAt: string;
}

interface Feature {
  id?: unknown;
  properties?: Record<string, unknown>;
  geometry?: { type?: unknown; coordinates?: unknown };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * USGS real-time earthquake feed (M4.5+, past day), GeoJSON.
 *
 * Coordinates are the USGS-computed epicentre, so these records are `exact`. Watch
 * regions come from the epicentre falling inside a region's watch-area box. No country is
 * assigned: USGS gives a place description, not a country code, and we do not guess one.
 * USGS also labels non-earthquake seismic sources (`type`: explosion, quarry blast,
 * nuclear explosion); the type is kept verbatim.
 */
export const usgsEarthquakes: SourceAdapter<UsgsState> = {
  sourceId: SOURCE_ID,
  async collect(ctx: AdapterContext<UsgsState>): Promise<AdapterResult<UsgsState>> {
    const def = getSource(SOURCE_ID)!;
    const res = await ctx.fetch(def.endpoint!, ctx.state?.validators);
    if (res.kind === 'not-modified') return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: ctx.state! };

    const doc = JSON.parse(res.body) as { features?: Feature[] };
    const features = Array.isArray(doc.features) ? doc.features : [];
    const nowIso = new Date(ctx.now).toISOString();
    const lookback = ctx.now - (ctx.state ? STEADY_LOOKBACK_DAYS : FIRST_RUN_LOOKBACK_DAYS) * DAY;
    const events: IntelligenceEvent[] = [];
    const rejected: AdapterResult<UsgsState>['rejected'] = [];

    for (const f of features) {
      const p = f.properties ?? {};
      const usgsId = typeof f.id === 'string' ? f.id : '';
      const coords = Array.isArray(f.geometry?.coordinates) ? (f.geometry!.coordinates as unknown[]) : [];
      const lon = num(coords[0]);
      const lat = num(coords[1]);
      const depth = num(coords[2]);
      const mag = num(p.mag);
      const time = num(p.time);
      const url = safeUrl(p.url);
      const place = cleanText(typeof p.place === 'string' ? p.place : '');
      if (!usgsId || lat === null || lon === null || time === null || !url) {
        rejected.push({ ref: usgsId || '(no id)', reason: 'missing id, coordinates, time or url' });
        continue;
      }
      if (time < lookback) continue;

      const type = typeof p.type === 'string' ? p.type : 'earthquake';
      const occurredAt = new Date(time).toISOString();
      const label = type === 'earthquake' ? 'Earthquake' : `Seismic event (USGS type: ${type})`;
      const id = contentHash(SOURCE_ID, usgsId);
      events.push({
        id,
        contentHash: id,
        dataOrigin: 'live',
        sourceId: SOURCE_ID,
        sourceName: `USGS — ${def.name}`,
        sourceClass: 'scientific',
        sourceUrl: url,
        title: truncate(`${label} M${mag?.toFixed(1) ?? '?'} — ${place || 'location not stated'}`, LIMITS.title),
        summary: truncate(
          [
            `Magnitude ${mag ?? 'unknown'} ${typeof p.magType === 'string' ? `(${p.magType})` : ''}`.trim(),
            depth !== null ? `depth ${depth.toFixed(0)} km` : null,
            `origin time ${occurredAt}`,
            p.tsunami === 1 ? 'USGS tsunami flag set (means tsunami information may exist; not a warning)' : null,
            typeof p.alert === 'string' ? `PAGER alert: ${p.alert}` : null,
            `review status: ${typeof p.status === 'string' ? p.status : 'unknown'}`,
          ]
            .filter(Boolean)
            .join(' · '),
          LIMITS.summary,
        ),
        category: 'disaster',
        regionIds: regionsForPoint(lat, lon),
        countryCodes: [],
        publishedAt: occurredAt,
        occurredAt,
        collectedAt: nowIso,
        credibility: 'official',
        verificationStatus: 'unreviewed',
        latitude: lat,
        longitude: lon,
        locationPrecision: 'exact',
        metadata: {
          usgsId,
          magnitude: mag,
          depthKm: depth,
          seismicType: type,
          tsunamiFlag: p.tsunami === 1,
          pagerAlert: typeof p.alert === 'string' ? p.alert : null,
          reviewStatus: typeof p.status === 'string' ? p.status : null,
          geoBasis: 'source-coordinates',
        },
      });
    }

    return {
      events,
      rejected,
      itemsSeen: features.length,
      notModified: false,
      state: { validators: res.validators, firstRunAt: ctx.state?.firstRunAt ?? nowIso },
    };
  },
};
