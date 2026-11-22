import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { getRegion } from '../../shared/domain/regions.ts';
import { VIOLENCE_LABEL, latestCandidate, monthName, readCandidate, type ConflictSnapshot, type RegionConflictTotal } from '../../shared/domain/conflictEvents.ts';
import { contentHash } from '../lib/hash.ts';
import { LIMITS, truncate } from '../lib/text.ts';
import type { AdapterContext, AdapterResult, SourceAdapter } from './types.ts';

/**
 * UCDP GED candidate events (Phase 25). Checks the downloads page twice a day; when a new monthly file
 * appears it is read once (about 2 MB) and one summary record per watch region is written.
 * CC BY 4.0, cite UCDP.
 */
export const UCDP_SOURCE_ID = 'ucdp-ged';
export const UCDP_DOWNLOADS = 'https://ucdp.uu.se/downloads/';
export const UCDP_CITE = 'Data: UCDP Georeferenced Event Dataset (candidate), Uppsala Conflict Data Program, CC BY 4.0 (Sundberg & Melander 2013; Hegre et al. 2020).';

export interface UcdpState {
  latest: ConflictSnapshot | null;
  /** Last look at the downloads page (ISO). */
  checkedAt?: string;
}
/** The file is monthly: look twice a day. */
export const UCDP_EVERY_MS = 12 * 3_600_000;

export function regionRecord(t: RegionConflictTotal, snap: ConflictSnapshot, nowIso: string): IntelligenceEvent {
  const id = contentHash(UCDP_SOURCE_ID, snap.release, t.regionId);
  const name = getRegion(t.regionId)?.name ?? t.regionId;
  const types = ([1, 2, 3] as const).filter((ty) => t.deathsByType[ty - 1] > 0).map((ty) => `${t.deathsByType[ty - 1].toLocaleString('en-US')} ${VIOLENCE_LABEL[ty]}`);
  return {
    id,
    contentHash: id,
    dataOrigin: 'live',
    sourceId: UCDP_SOURCE_ID,
    sourceName: 'UCDP — Uppsala Conflict Data Program',
    sourceClass: 'scientific',
    sourceUrl: UCDP_DOWNLOADS,
    title: truncate(`UCDP: ${t.events.toLocaleString('en-US')} conflict events and ${t.deaths.toLocaleString('en-US')} deaths (best estimate) in ${name}, ${monthName(snap.month)}`, LIMITS.title),
    summary: truncate(`Coded incidents of organised violence in ${name} in ${monthName(snap.month)} (UCDP candidate release ${snap.release}). Deaths by type: ${types.join(', ') || 'none'}. Candidate data are preliminary and revised in later releases. ${UCDP_CITE}`, LIMITS.summary),
    category: 'military',
    regionIds: [t.regionId],
    countryCodes: [],
    publishedAt: nowIso,
    occurredAt: `${snap.month}-01T00:00:00.000Z`,
    collectedAt: nowIso,
    credibility: 'corroborated',
    verificationStatus: 'unreviewed',
    locationPrecision: 'region',
    metadata: { subtype: 'conflict-month', release: snap.release, month: snap.month, events: t.events, deaths: t.deaths, geoBasis: 'source-region-total' },
  };
}

export const ucdp: SourceAdapter<UcdpState> = {
  sourceId: UCDP_SOURCE_ID,
  async collect(ctx: AdapterContext<UcdpState>): Promise<AdapterResult<UcdpState>> {
    const nowIso = new Date(ctx.now).toISOString();
    const prev = ctx.state?.latest ?? null;
    if (ctx.state?.checkedAt && ctx.now - Date.parse(ctx.state.checkedAt) < UCDP_EVERY_MS) return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: ctx.state };
    const page = await ctx.fetch(UCDP_DOWNLOADS, undefined, { Accept: 'text/html' });
    if (page.kind !== 'ok') return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: { latest: prev, checkedAt: nowIso } };
    const found = latestCandidate(page.body);
    if (!found) throw new Error('UCDP: no monthly candidate file linked from the downloads page');
    if (prev && prev.release === found.release) return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: { latest: prev, checkedAt: nowIso } };
    const file = await ctx.fetch(found.url, undefined, { Accept: 'text/csv' }, { maxBytes: 12_000_000, timeoutMs: 60_000 });
    if (file.kind !== 'ok') return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: { latest: prev } };
    const parts = readCandidate(file.body, found.month);
    const snap: ConflictSnapshot = { release: found.release, month: found.month, fetchedAt: nowIso, sourceUrl: found.url, ...parts };
    const events = snap.regions.filter((t) => t.events > 0).map((t) => regionRecord(t, snap, nowIso));
    return { events, rejected: [], itemsSeen: parts.worldEvents, notModified: false, state: { latest: snap, checkedAt: nowIso } };
  },
};
