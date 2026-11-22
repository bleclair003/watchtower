import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { NAV_KIND_LABEL, readWarning, warningsFromBody, type NavWarning } from '../../shared/domain/navWarnings.ts';
import { contentHash } from '../lib/hash.ts';
import { LIMITS, truncate } from '../lib/text.ts';
import { FIRST_RUN_LOOKBACK_DAYS, type AdapterContext, type AdapterResult, type SourceAdapter } from './types.ts';

/**
 * NGA Maritime Safety Information broadcast warnings (Phase 25). Active warnings of the notable kinds
 * (missile and rocket firings, live firing, military exercises, GPS interference, piracy, mines, cable
 * work) are kept for the map; each is recorded once, when first seen. U.S. government work.
 */
export const NGA_SOURCE_ID = 'nga-msi';
export const NGA_URL = 'https://msi.nga.mil/api/publications/broadcast-warn?output=json&status=active';
const PORTAL = 'https://msi.nga.mil/NavWarnings';
const DAY = 86_400_000;
/** Warnings change a few times a day: read every 3 hours. */
export const NGA_EVERY_MS = 3 * 3_600_000;

export interface NgaState {
  warnings: NavWarning[];
  activeTotal: number;
  fetchedAt: string;
  /** Warning keys already recorded (kept while active). */
  seen: string[];
}

const CATEGORY: Record<NavWarning['kind'], IntelligenceEvent['category']> = {
  missile: 'military',
  firing: 'military',
  exercise: 'military',
  gnss: 'aviation',
  piracy: 'maritime',
  mine: 'maritime',
  cable: 'maritime',
  other: 'maritime',
};

export function warningRecord(w: NavWarning, nowIso: string): IntelligenceEvent {
  const id = contentHash(NGA_SOURCE_ID, w.key);
  const where = w.lat !== null ? '' : ' (no position in the text)';
  return {
    id,
    contentHash: id,
    dataOrigin: 'live',
    sourceId: NGA_SOURCE_ID,
    sourceName: 'NGA Maritime Safety Information',
    sourceClass: 'official',
    sourceUrl: PORTAL,
    title: truncate(`${w.series} ${w.number}/${String(w.year).slice(-2)}: ${NAV_KIND_LABEL[w.kind]}${where} — ${w.text}`, LIMITS.title),
    summary: truncate(`Navigational warning ${w.key}, ${NAV_KIND_LABEL[w.kind]}. ${w.text} (U.S. NGA, public domain.)`, LIMITS.summary),
    category: CATEGORY[w.kind],
    regionIds: w.regionIds,
    countryCodes: [],
    publishedAt: w.issuedAt ?? nowIso,
    occurredAt: null,
    collectedAt: nowIso,
    credibility: 'official',
    verificationStatus: 'unreviewed',
    ...(w.lat !== null && w.lon !== null ? { latitude: w.lat, longitude: w.lon, locationPrecision: 'region' as const } : { locationPrecision: 'none' as const }),
    metadata: { subtype: 'nav-warning', navKind: w.kind, warningKey: w.key, points: w.points.length, geoBasis: w.lat !== null ? 'warning-area-centre' : 'none' },
  };
}

export const ngaMsi: SourceAdapter<NgaState> = {
  sourceId: NGA_SOURCE_ID,
  async collect(ctx: AdapterContext<NgaState>): Promise<AdapterResult<NgaState>> {
    const nowIso = new Date(ctx.now).toISOString();
    if (ctx.state && ctx.now - Date.parse(ctx.state.fetchedAt) < NGA_EVERY_MS) return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: ctx.state };
    const res = await ctx.fetch(NGA_URL, undefined, { Accept: 'application/json' });
    if (res.kind !== 'ok') return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: ctx.state ?? { warnings: [], activeTotal: 0, fetchedAt: nowIso, seen: [] } };
    let body: unknown;
    try {
      body = JSON.parse(res.body);
    } catch {
      throw new Error('NGA MSI: answer is not JSON (the portal may be under maintenance)');
    }
    const raw = warningsFromBody(body);
    const rejected: AdapterResult<NgaState>['rejected'] = [];
    const all: NavWarning[] = [];
    for (const r of raw) {
      const w = readWarning(r);
      if (w) all.push(w);
      else rejected.push({ ref: `${r.navArea ?? '?'} ${r.msgNumber ?? '?'}/${r.msgYear ?? '?'}`, reason: 'no number, year or text' });
    }
    const notable = all.filter((w) => w.kind !== 'other');
    const seen = new Set(ctx.state?.seen ?? []);
    const firstRun = !ctx.state;
    const events: IntelligenceEvent[] = [];
    for (const w of notable) {
      if (seen.has(w.key)) continue;
      // First run: only warnings issued in the back-fill window become records (older ones are still mapped).
      const issued = w.issuedAt ? Date.parse(w.issuedAt) : ctx.now;
      if (!firstRun || issued >= ctx.now - FIRST_RUN_LOOKBACK_DAYS * DAY) events.push(warningRecord(w, nowIso));
    }
    const activeKeys = new Set(all.map((w) => w.key));
    const nextSeen = [...new Set([...seen, ...notable.map((w) => w.key)])].filter((k) => activeKeys.has(k));
    return { events, rejected, itemsSeen: raw.length, notModified: false, state: { warnings: notable, activeTotal: all.length, fetchedAt: nowIso, seen: nextSeen } };
  },
};
