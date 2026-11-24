import { parseGpCsv, SAT_GROUPS, SATELLITES_SOURCE_ID, satGroupUrl, type SatellitesSnapshot, type StoredSat } from '../../shared/domain/satellites.ts';
import type { Validators } from '../lib/http.ts';
import type { AdapterContext, AdapterResult, SourceAdapter } from './types.ts';

/**
 * Satellite elements from CelesTrak (v0.84.0). Makes no records: the elements go to the layers document and
 * the browser computes positions and passes. CelesTrak updates every 2 hours, asks for CSV, and firewalls
 * clients that repeat failing requests, so WATCHTOWER reads at most every 12 hours and, after a failure,
 * waits the same 12 hours instead of retrying (the previous elements are kept, and their age is shown).
 */

export const SAT_MIN_INTERVAL_MS = 12 * 3_600_000;

export interface SatellitesState {
  latest: SatellitesSnapshot | null;
  /** Last attempt, successful or not (the 12-hour wait counts from here). */
  attemptAt: string | null;
  lastError?: string | null;
  validators?: Record<string, Validators>;
}

export const satellites: SourceAdapter<SatellitesState> = {
  sourceId: SATELLITES_SOURCE_ID,
  async collect(ctx: AdapterContext<SatellitesState>): Promise<AdapterResult<SatellitesState>> {
    const prev = ctx.state;
    const nowIso = new Date(ctx.now).toISOString();
    if (prev?.attemptAt && ctx.now - Date.parse(prev.attemptAt) < SAT_MIN_INTERVAL_MS) {
      return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: prev, note: prev.lastError ? `last read failed (${prev.lastError}); waiting 12 h` : 'read less than 12 h ago' };
    }
    const sats: StoredSat[] = [];
    const validators: Record<string, Validators> = { ...(prev?.validators ?? {}) };
    try {
      for (const g of SAT_GROUPS) {
        const res = await ctx.fetch(satGroupUrl(g.id), validators[g.id], { Accept: 'text/csv' }, { maxBytes: 2_000_000 });
        if (res.kind === 'not-modified') {
          sats.push(...(prev?.latest?.sats.filter((s) => s.g === g.id) ?? []));
          continue;
        }
        const els = parseGpCsv(res.body);
        if (!els.length) throw new Error(`group ${g.id}: no elements`);
        validators[g.id] = res.validators;
        sats.push(...els.map((el) => ({ g: g.id, el })));
      }
    } catch (err) {
      // Do not retry soon: CelesTrak blocks clients that repeat failing requests.
      const message = String((err as Error).message ?? err).slice(0, 120);
      return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: { ...(prev ?? { latest: null }), attemptAt: nowIso, lastError: message }, note: `CelesTrak read failed (${message}); keeping the previous elements, next try in 12 h` };
    }
    const latest: SatellitesSnapshot = {
      fetchedAt: nowIso,
      sats,
      groups: SAT_GROUPS.map((g) => {
        const mine = sats.filter((s) => s.g === g.id);
        const newest = mine.map((s) => s.el.EPOCH).sort().at(-1) ?? null;
        return { id: g.id, count: mine.length, newestEpoch: newest };
      }),
    };
    return {
      events: [],
      rejected: [],
      itemsSeen: sats.length,
      notModified: false,
      state: { latest, attemptAt: nowIso, lastError: null, validators },
      note: latest.groups.map((g) => `${g.id} ${g.count}`).join(', '),
    };
  },
};
