import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { FEED_LABEL } from '../../shared/domain/convergence.ts';
import { countryFeedLabel } from '../../shared/domain/countryConvergence.ts';
import type { HotspotChange } from '../../shared/domain/convergenceMemory.ts';
import { GOVERNMENT_LABEL, JOINT_WINDOW_HOURS, type JointRaise } from '../../shared/domain/travelAdvice.ts';
import { contentHash } from './hash.ts';
import { LIMITS, truncate } from './text.ts';
import { regionsForCountry } from '../../shared/domain/regions.ts';

const regionIdsFor = (c: string) => regionsForCountry(c);

/** Records for new or upgraded convergence hotspots (v0.80.0); alert rules match them like any record. */
export const CONVERGENCE_SOURCE_ID = 'watchtower-convergence';
export const DEFAULT_APP_URL = 'https://watchtower-hq.web.app';

const names = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    return null;
  }
})();
const countryName = (c: string) => {
  try {
    return names?.of(c) ?? c;
  } catch {
    return c;
  }
};
const fmt = (lat: number, lon: number) => `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;

export function convergenceRecord(c: HotspotChange, nowIso: string, appUrl = DEFAULT_APP_URL): IntelligenceEvent {
  const h = c.hotspot;
  const level = h.level === 'strong' ? 'STRONG' : 'WATCH';
  const anomalies = h.types.filter((t) => t.role === 'anomaly');
  const kinds = anomalies.map((t) => `${t.label.toLowerCase()} ×${t.count}`).join(', ');
  const base = appUrl.replace(/\/+$/, '');
  const verb = c.change === 'upgraded' ? 'now' : 'new';
  const memberIds = h.signals.flatMap((s) => (s.eventId ? [s.eventId] : [])).slice(0, 30);
  const common = {
    dataOrigin: 'live' as const,
    sourceId: CONVERGENCE_SOURCE_ID,
    sourceName: 'WATCHTOWER signal convergence',
    sourceClass: 'aggregator' as const,
    category: 'general' as const,
    publishedAt: nowIso,
    occurredAt: h.first,
    collectedAt: nowIso,
    credibility: 'experimental' as const,
    verificationStatus: 'unreviewed' as const,
    regionIds: h.regionIds,
  };
  const caveat = 'Different kinds of signal from separate feeds at about the same time: a reason to look closer, not evidence that they are linked.';
  if (c.kind === 'point') {
    const p = c.hotspot;
    const id = contentHash(CONVERGENCE_SOURCE_ID, 'point', p.lat.toFixed(1), p.lon.toFixed(1), c.firstAt, c.change, p.level);
    const feeds = p.feeds.map((f) => FEED_LABEL[f] ?? f).join(', ');
    return {
      ...common,
      id,
      contentHash: id,
      sourceUrl: `${base}/?at=${p.lat.toFixed(3)},${p.lon.toFixed(3)},6&sel=conv:${encodeURIComponent(p.id)}`,
      title: truncate(`Signal convergence ${level} (${verb}) near ${fmt(p.lat, p.lon)}: ${p.feeds.length} independent feeds within ${p.radiusKm} km`, LIMITS.title),
      summary: truncate(`${kinds}. Feeds: ${feeds}. ${p.signalCount} signals since ${p.first.slice(0, 16).replace('T', ' ')} UTC. ${caveat}`, LIMITS.summary),
      countryCodes: [],
      latitude: p.lat,
      longitude: p.lon,
      locationPrecision: 'city',
      metadata: {
        subtype: 'convergence-hotspot',
        level: p.level,
        change: c.change,
        feeds: p.feeds,
        types: anomalies.map((t) => t.type),
        radiusKm: p.radiusKm,
        signalEventIds: memberIds,
        geoBasis: 'hotspot centre (mean of the anomaly positions)',
      },
    };
  }
  const k = c.hotspot;
  const id = contentHash(CONVERGENCE_SOURCE_ID, 'country', k.country, c.firstAt, c.change, k.level);
  const feeds = k.feeds.map(countryFeedLabel).join(', ');
  return {
    ...common,
    id,
    contentHash: id,
    sourceUrl: k.regionIds[0] ? `${base}/regions/${k.regionIds[0]}` : `${base}/`,
    title: truncate(`Country signal convergence ${level} (${verb}): ${countryName(k.country)}, ${k.feeds.length} independent feeds in 48 h`, LIMITS.title),
    summary: truncate(`${kinds}. Feeds: ${feeds}. ${k.signalCount} signals since ${k.first.slice(0, 16).replace('T', ' ')} UTC. ${caveat}`, LIMITS.summary),
    countryCodes: [k.country],
    locationPrecision: 'country',
    metadata: {
      subtype: 'country-convergence',
      level: k.level,
      change: c.change,
      feeds: k.feeds,
      types: anomalies.map((t) => t.type),
      signalEventIds: memberIds,
      geoBasis: 'country of the signals',
    },
  };
}

/**
 * v0.83.0: two or more governments raised their travel advice for the same country within 72 hours.
 * The id covers the country, the governments and the day of the first raise, so the same joint raise is
 * recorded once, and a third government joining makes a new (STRONG) record.
 */
export function jointRaiseRecord(j: JointRaise, nowIso: string, appUrl = DEFAULT_APP_URL): IntelligenceEvent {
  const id = contentHash(CONVERGENCE_SOURCE_ID, 'joint-raise', j.country, j.governments.join(','), j.first.slice(0, 10));
  const govs = j.governments.map((g) => GOVERNMENT_LABEL[g] ?? g);
  const base = appUrl.replace(/\/+$/, '');
  return {
    id,
    contentHash: id,
    dataOrigin: 'live',
    sourceId: CONVERGENCE_SOURCE_ID,
    sourceName: 'WATCHTOWER signal convergence',
    sourceClass: 'aggregator',
    sourceUrl: regionIdsFor(j.country)[0] ? `${base}/regions/${regionIdsFor(j.country)[0]}` : `${base}/`,
    title: truncate(`Travel advice raised by ${govs.length} governments for ${countryName(j.country)} within ${JOINT_WINDOW_HOURS} h (${govs.join(', ')})`, LIMITS.title),
    summary: truncate(
      `${j.titles.join(' · ')}. Governments raise their advice on information they often cannot publish; several within days is a stronger signal than one. They also share information, so this is agreement, not independent proof.`,
      LIMITS.summary,
    ),
    category: 'diplomatic',
    regionIds: regionIdsFor(j.country),
    countryCodes: [j.country],
    publishedAt: nowIso,
    occurredAt: j.first,
    collectedAt: nowIso,
    credibility: 'experimental',
    verificationStatus: 'unreviewed',
    locationPrecision: 'country',
    metadata: { subtype: 'joint-advice-raise', level: j.level, change: 'new', governments: j.governments, signalEventIds: j.eventIds.slice(0, 30), geoBasis: 'country of the advisories' },
  };
}

