import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { regionsForCountry } from '../../shared/domain/regions.ts';
import { contentHash } from '../lib/hash.ts';
import { LIMITS, cleanText, truncate } from '../lib/text.ts';
import type { AdapterContext, AdapterResult, SourceAdapter } from './types.ts';

export const LAUNCHES_SOURCE_ID = 'military-launches';
const API = 'https://ll.thespacedevs.com/2.3.0/launches/previous/';
/** The free tier allows about 15 requests an hour; one request every 3 hours is plenty. */
export const LAUNCHES_EVERY_HOURS = 3;
const LOOKBACK_DAYS = 30;

export interface LL2Launch {
  id: string;
  name: string;
  net: string;
  status?: { abbrev?: string; name?: string };
  failreason?: string | null;
  launch_service_provider?: { name?: string };
  mission?: { name?: string; type?: string; description?: string | null; orbit?: { abbrev?: string; name?: string } } | null;
  pad?: { name?: string; country?: { alpha_2_code?: string; name?: string }; location?: { name?: string } } | null;
}

/** Operators whose launches are military by definition. */
const MILITARY_OPERATOR = /Space Forces|Aerospace Forces?|Ministry of Defen[cs]e|Agency for Defense Development|Revolutionary Guard|IRGC|National Aerospace Technology Administration|Korean Committee of Space Technology|Strategic Support Force|Space Force|National Reconnaissance/i;
/** Countries where every launch is state/military (launchers share ballistic-missile technology). */
const ALWAYS_MILITARY = new Set(['KP', 'IR']);
/** Launch sites leased to another state. */
const SITE_OPERATOR: Record<string, string> = { KZ: 'RU' };

export function ownerCountry(l: LL2Launch): string | null {
  const site = l.pad?.country?.alpha_2_code?.toUpperCase();
  if (!site || site.length !== 2) return null;
  return SITE_OPERATOR[site] ?? site;
}

export function isMilitaryLaunch(l: LL2Launch): boolean {
  const country = ownerCountry(l);
  return l.mission?.type === 'Government/Top Secret' || MILITARY_OPERATOR.test(l.launch_service_provider?.name ?? '') || (!!country && ALWAYS_MILITARY.has(country));
}

const DONE = new Set(['Success', 'Failure', 'Partial Failure']);
const COUNTRY_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });

export function launchEvents(launches: LL2Launch[], nowMs: number): IntelligenceEvent[] {
  const nowIso = new Date(nowMs).toISOString();
  return launches.flatMap((l) => {
    const status = l.status?.abbrev ?? '';
    if (!DONE.has(status) || !isMilitaryLaunch(l) || !/^\d{4}-\d{2}-\d{2}T/.test(l.net) || Date.parse(l.net) > nowMs) return [];
    const country = ownerCountry(l);
    const [rocket, payload] = l.name.split(' | ');
    const orbit = l.mission?.orbit?.abbrev && l.mission.orbit.abbrev !== 'N/A' ? `, ${l.mission.orbit.abbrev}` : '';
    const outcome = status === 'Success' ? 'success' : status === 'Failure' ? 'FAILURE' : 'partial failure';
    const id = contentHash(LAUNCHES_SOURCE_ID, l.id);
    const at = new Date(Date.parse(l.net)).toISOString();
    return [{
      id,
      contentHash: id,
      dataOrigin: 'live' as const,
      sourceId: LAUNCHES_SOURCE_ID,
      sourceName: 'Launch Library 2 (The Space Devs) — military and classified launches',
      sourceClass: 'aggregator' as const,
      sourceUrl: `https://ll.thespacedevs.com/2.3.0/launches/${l.id}/`,
      title: truncate(`Military/classified space launch: ${payload ?? l.mission?.name ?? 'payload not named'} on ${rocket}${country ? ` (${COUNTRY_NAMES.of(country) ?? country}${orbit})` : orbit ? ` (${orbit.slice(2)})` : ''} — ${outcome}, ${at.slice(0, 10)}`, LIMITS.title),
      summary: truncate(
        `${cleanText(l.mission?.description ?? '') || 'No mission description published.'} Launched ${at.slice(0, 16).replace('T', ' ')} UTC from ${l.pad?.location?.name ?? l.pad?.name ?? 'an unnamed site'} by ${l.launch_service_provider?.name ?? 'an unnamed provider'}; mission type "${l.mission?.type ?? 'unknown'}".` +
          `${status !== 'Success' && l.failreason ? ` Failure: ${cleanText(l.failreason)}.` : ''} Compiled by The Space Devs (community-maintained).`,
        LIMITS.summary,
      ),
      category: 'military' as const,
      regionIds: country ? regionsForCountry(country) : [],
      countryCodes: country ? [country] : [],
      publishedAt: at,
      occurredAt: at,
      collectedAt: nowIso,
      credibility: 'single-source' as const,
      verificationStatus: 'unreviewed' as const,
      locationPrecision: country ? ('country' as const) : ('none' as const),
      metadata: { subtype: 'military-launch', launchStatus: status, missionType: l.mission?.type ?? null, orbit: l.mission?.orbit?.abbrev ?? null, provider: l.launch_service_provider?.name ?? null },
    }];
  });
}

export interface LaunchesState {
  lastFetchedAt: string;
}

/**
 * Completed military and classified space launches worldwide from Launch Library 2 (free, no
 * key, community-maintained). Every 3 hours; the last 30 days on the first run.
 */
export const militaryLaunches: SourceAdapter<LaunchesState> = {
  sourceId: LAUNCHES_SOURCE_ID,
  async collect(ctx: AdapterContext<LaunchesState>): Promise<AdapterResult<LaunchesState>> {
    if (ctx.state && ctx.now - Date.parse(ctx.state.lastFetchedAt) < LAUNCHES_EVERY_HOURS * 3_600_000) {
      return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: ctx.state };
    }
    const since = new Date(ctx.now - (ctx.state ? 3 : LOOKBACK_DAYS) * 86_400_000).toISOString().slice(0, 19) + 'Z';
    const res = await ctx.fetch(`${API}?net__gte=${since}&limit=100&mode=normal&ordering=-net`, undefined, { Accept: 'application/json' }, { maxBytes: 16 * 1024 * 1024, timeoutMs: 45_000 });
    if (res.kind !== 'ok') throw new Error('Launch Library 2: unexpected 304');
    const body = JSON.parse(res.body) as { results?: LL2Launch[]; detail?: string };
    if (!Array.isArray(body.results)) throw new Error(`Launch Library 2: ${body.detail ?? 'unexpected response'}`);
    return { events: launchEvents(body.results, ctx.now), rejected: [], itemsSeen: body.results.length, notModified: false, state: { lastFetchedAt: new Date(ctx.now).toISOString() } };
  },
};
