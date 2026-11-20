import type { CollectionRun, IntelligenceEvent, SourceStatus } from '../shared/domain/types.ts';
import { getSource } from '../shared/domain/sources.ts';
import { computeHealth } from '../shared/domain/health.ts';
import {
  SNAPSHOT_MAX_BYTES,
  SNAPSHOT_MAX_EVENTS,
  SNAPSHOT_SCHEMA_VERSION,
  type DashboardSnapshot,
} from '../shared/domain/snapshot.ts';
import type { SourceAdapter } from './adapters/types.ts';
import type { CollectorStore } from './store/types.ts';
import { politeFetch, type FetchOptions } from './lib/http.ts';
import { validateEvent } from './lib/validate.ts';
import { truncate } from './lib/text.ts';

export interface PipelineOptions {
  trigger: CollectionRun['trigger'];
  now?: () => number;
  fetchOptions?: Omit<FetchOptions, 'validators'>;
  log?: (msg: string) => void;
}

export interface SourceRunReport {
  sourceId: string;
  ok: boolean;
  notModified: boolean;
  itemsSeen: number;
  candidates: number;
  imported: number;
  duplicates: number;
  rejected: number;
  error: string | null;
}

/** Strip anything that might be sensitive or huge from an error before persisting it. */
function sanitizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return truncate(msg.replace(/https?:\/\/[^\s]*[?&](key|token|sig)=[^\s&]*/gi, '[redacted-url]'), 300);
}

/**
 * One collection cycle:
 *   for each adapter → fetch/parse (adapter) → validate → de-duplicate → write
 *   → update source status/state → record run → rebuild dashboard snapshot.
 *
 * Idempotent: re-running with unchanged sources writes no new events.
 * A failing source never prevents other sources from being collected.
 */
export async function runCollection(
  adapters: SourceAdapter<never>[],
  store: CollectorStore,
  opts: PipelineOptions,
): Promise<{ run: CollectionRun; reports: SourceRunReport[]; snapshot: DashboardSnapshot }> {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? (() => {});
  const startedAt = new Date(now()).toISOString();
  const run: CollectionRun = {
    id: `${startedAt.replace(/[:.]/g, '-')}_${opts.trigger}`,
    startedAt,
    finishedAt: null,
    trigger: opts.trigger,
    recordsFetched: 0,
    recordsImported: 0,
    recordsRejected: 0,
    duplicatesSuppressed: 0,
    errors: [],
  };
  const reports: SourceRunReport[] = [];

  for (const adapter of adapters) {
    const def = getSource(adapter.sourceId);
    const report: SourceRunReport = {
      sourceId: adapter.sourceId, ok: false, notModified: false, itemsSeen: 0,
      candidates: 0, imported: 0, duplicates: 0, rejected: 0, error: null,
    };
    const attemptAt = new Date(now()).toISOString();
    const prevStatus: SourceStatus = (await store.getSourceStatus(adapter.sourceId)) ?? {
      sourceId: adapter.sourceId, health: 'NOT_CONFIGURED', lastAttemptAt: null, lastSuccessAt: null,
      lastNewItemAt: null, consecutiveFailures: 0, parseErrors: 0, lastError: null,
    };

    try {
      const state = await store.getSourceState<never>(adapter.sourceId);
      const result = await adapter.collect({
        now: now(),
        state,
        fetch: (url, validators) => politeFetch(url, { ...opts.fetchOptions, validators }),
      });
      report.itemsSeen = result.itemsSeen;
      report.notModified = result.notModified;

      // Validate, and de-duplicate within the batch itself.
      const valid = new Map<string, IntelligenceEvent>();
      for (const e of result.events) {
        const reason = validateEvent(e, now());
        if (reason) {
          report.rejected++;
          log(`  reject ${adapter.sourceId}: ${reason} — ${truncate(e.title, 60)}`);
        } else if (valid.has(e.id)) report.duplicates++;
        else valid.set(e.id, e);
      }
      report.rejected += result.rejected.length;
      report.candidates = valid.size;

      const fresh = await store.filterNewEventIds([...valid.keys()]);
      report.duplicates += valid.size - fresh.size;
      const toWrite = [...valid.values()].filter((e) => fresh.has(e.id));
      if (toWrite.length) await store.putEvents(toWrite);
      report.imported = toWrite.length;

      await store.putSourceState(adapter.sourceId, result.state);
      const status: SourceStatus = {
        ...prevStatus,
        lastAttemptAt: attemptAt,
        lastSuccessAt: attemptAt,
        lastNewItemAt: toWrite.length ? attemptAt : prevStatus.lastNewItemAt,
        consecutiveFailures: 0,
        parseErrors: result.rejected.length,
        lastError: null,
        health: 'ONLINE',
      };
      status.health = computeHealth(status, def?.pollIntervalMinutes ?? null, now());
      await store.putSourceStatus(status);
      report.ok = true;
    } catch (err) {
      report.error = sanitizeError(err);
      run.errors.push({ sourceId: adapter.sourceId, message: report.error });
      const status: SourceStatus = {
        ...prevStatus,
        lastAttemptAt: attemptAt,
        consecutiveFailures: prevStatus.consecutiveFailures + 1,
        lastError: report.error,
        health: 'DEGRADED',
      };
      status.health = computeHealth(status, def?.pollIntervalMinutes ?? null, now());
      await store.putSourceStatus(status);
    }

    run.recordsFetched += report.itemsSeen;
    run.recordsImported += report.imported;
    run.recordsRejected += report.rejected;
    run.duplicatesSuppressed += report.duplicates;
    reports.push(report);
    log(
      `${report.ok ? 'OK  ' : 'FAIL'} ${adapter.sourceId.padEnd(26)} ` +
        (report.ok
          ? `${report.notModified ? '304 not modified' : `${report.itemsSeen} seen`} · ${report.imported} new · ${report.duplicates} dup · ${report.rejected} rejected`
          : report.error),
    );
  }

  run.finishedAt = new Date(now()).toISOString();
  await store.putRun(run);
  const snapshot = await buildSnapshot(store, run, adapters.map((a) => a.sourceId), now());
  await store.putSnapshot(snapshot);
  return { run, reports, snapshot };
}

/** Builds the dashboard snapshot, trimming events until it fits the Firestore document limit. */
export async function buildSnapshot(
  store: CollectorStore,
  run: CollectionRun,
  sourceIds: string[],
  now: number,
): Promise<DashboardSnapshot> {
  const statuses = (await Promise.all(sourceIds.map((id) => store.getSourceStatus(id)))).filter(
    (s): s is SourceStatus => s !== null,
  );
  let events = await store.recentEvents(SNAPSHOT_MAX_EVENTS);
  const snapshot: DashboardSnapshot = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt: new Date(now).toISOString(),
    events,
    sourceStatus: statuses,
    lastRun: run,
    totalEventsStored: await store.countEvents(),
  };
  while (Buffer.byteLength(JSON.stringify(snapshot)) > SNAPSHOT_MAX_BYTES && events.length > 0) {
    events = events.slice(0, Math.floor(events.length * 0.9));
    snapshot.events = events;
  }
  return snapshot;
}
