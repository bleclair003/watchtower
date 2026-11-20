import { CREDIBILITY_LEVELS, EVENT_CATEGORIES, type IntelligenceEvent } from '../../shared/domain/types.ts';
import { WATCH_REGIONS } from '../../shared/domain/regions.ts';
import { LIMITS } from './text.ts';

const REGION_IDS = new Set(WATCH_REGIONS.map((r) => r.id));
const PRECISE = new Set(['exact', 'city']);

function isIso(v: unknown): boolean {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v)) && /^\d{4}-\d{2}-\d{2}T/.test(v);
}

/**
 * Final gate before anything is written. Returns a rejection reason, or null
 * if the event is acceptable. Enforces the project's non-negotiables:
 * provenance, no demo data in live storage, no invented coordinates.
 */
export function validateEvent(e: IntelligenceEvent, now: number): string | null {
  if (!/^[a-f0-9]{32}$/.test(e.id) || e.id !== e.contentHash) return 'id must equal 32-hex contentHash';
  if (e.dataOrigin !== 'live') return 'collector may only write live records';
  if (!e.sourceId || !e.sourceName) return 'missing source identity';
  try {
    const u = new URL(e.sourceUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'sourceUrl must be http(s)';
  } catch {
    return 'sourceUrl missing or invalid';
  }
  if (!e.title.trim() || e.title.length > LIMITS.title) return 'title empty or too long';
  if (e.summary && e.summary.length > LIMITS.summary) return 'summary too long';
  if (!EVENT_CATEGORIES.includes(e.category)) return `unknown category ${e.category}`;
  if (!CREDIBILITY_LEVELS.includes(e.credibility)) return `unknown credibility ${e.credibility}`;
  if (e.regionIds.some((r) => !REGION_IDS.has(r))) return 'unknown region id';
  if (e.countryCodes.some((c) => !/^[A-Z]{2}$/.test(c))) return 'country codes must be ISO alpha-2';
  if (!isIso(e.collectedAt)) return 'collectedAt invalid';
  if (e.publishedAt !== null && !isIso(e.publishedAt)) return 'publishedAt invalid';
  // Allow modest clock skew but never far-future publication dates.
  if (e.publishedAt && Date.parse(e.publishedAt) > now + 36 * 3_600_000) return 'publishedAt in the future';
  const hasCoords = e.latitude !== undefined || e.longitude !== undefined;
  if (hasCoords && !PRECISE.has(e.locationPrecision)) return 'coordinates attached to imprecise location';
  if (PRECISE.has(e.locationPrecision)) {
    if (typeof e.latitude !== 'number' || typeof e.longitude !== 'number') return 'precise location missing coordinates';
    if (Math.abs(e.latitude) > 90 || Math.abs(e.longitude) > 180) return 'coordinates out of range';
  }
  return null;
}
