import type { CollectionRun, IntelligenceEvent, SourceStatus } from '../shared/domain/types.ts';
import { getSource } from '../shared/domain/sources.ts';
import { computeHealth } from '../shared/domain/health.ts';
import {
  SNAPSHOT_MAX_BYTES,
  SNAPSHOT_MAX_EVENTS,
  SNAPSHOT_SUMMARY_CHARS,
  SNAPSHOT_SCHEMA_VERSION,
  type DashboardSnapshot,
} from '../shared/domain/snapshot.ts';
import { CATALOG_VERSION, INDICATOR_CATALOG } from '../shared/domain/indicators/catalog.ts';
import { evaluateAll, requiredLookbackHours } from '../shared/domain/indicators/evaluate.ts';
import { appendScoreHistory, computeAllRegionScores } from '../shared/domain/indicators/rai.ts';
import type { IndicatorDefinition, IndicatorTransition, RegionScore } from '../shared/domain/indicators/types.ts';
import { runAlerting } from './alerts/alerting.ts';
import type { SourceAdapter } from './adapters/types.ts';
import type { CollectorStore } from './store/types.ts';
import { politeFetch, type FetchOptions } from './lib/http.ts';
import { redactSecrets } from './lib/secrets.ts';
import { runDailyBrief } from './brief/dailyBrief.ts';
import { validateEvent } from './lib/validate.ts';
import { truncate } from './lib/text.ts';
import { AIRCRAFT_SOURCE_ID, type MilitaryAircraftState } from './adapters/militaryAircraft.ts';
import { FLEET_SOURCE_ID, type FleetState } from './adapters/usniFleet.ts';
import { PORTWATCH_SOURCE_ID, type PortwatchState } from './adapters/portwatch.ts';
import { AIS_SOURCE_ID, type AisSanctionedState } from './adapters/aisSanctioned.ts';

export interface PipelineOptions {
  trigger: CollectionRun['trigger'];
  /** Sources whose status appears in the snapshot (defaults to the adapters run). */
  trackedSourceIds?: string[];
  /** Indicator catalog to evaluate (defaults to the built-in catalog). */
  catalog?: IndicatorDefinition[];
  mode?: CollectionRun['mode'];
  /** Validated Discord webhook URL (from the DISCORD_WEBHOOK_URL secret), or null. */
  discordWebhookUrl?: string | null;
  /** Public URL of the dashboard, used in notification links. */
  appUrl?: string;
  /** Injected for tests (Discord delivery). */
  alertFetch?: typeof fetch;
  /** Daily brief: UTC hour of the first send, and force-send for manual tests. */
  brief?: { hourUtc?: number; force?: boolean };
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
  /** Stored events rewritten because the source revised them (revisable sources only). */
  revised?: number;
  rejected: number;
  error: string | null;
}

/** Strip anything that might be sensitive or huge from an error before persisting it. */
function sanitizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return truncate(redactSecrets(msg).replace(/https?:\/\/[^\s]*[?&](key|token|sig)=[^\s&]*/gi, '[redacted-url]'), 300);
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
    mode: opts.mode ?? 'collect',
    recordsFetched: 0,
    recordsImported: 0,
    recordsRejected: 0,
    duplicatesSuppressed: 0,
    errors: [],
  };
  const reports: SourceRunReport[] = [];
  const importedThisRun: IntelligenceEvent[] = [];
  // Wall-clock timings for the run log (the injected `now` is fixed in tests).
  const clock = () => performance.now();
  const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
  const phases: [string, number][] = [];
  const tAdapters = clock();

  for (const adapter of adapters) {
    const tAdapter = clock();
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
        fetch: (url, validators, headers, limits) => politeFetch(url, { ...opts.fetchOptions, validators, extraHeaders: headers, ...limits }),
        peerState: <T,>(id: string) => store.getSourceState<T>(id),
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

      if (adapter.revisable) {
        const existing = [...valid.values()].filter((e) => !fresh.has(e.id));
        const stored = new Map((await store.getEvents(existing.map((e) => e.id))).map((e) => [e.id, e]));
        const revised = existing.flatMap((e) => {
          const prev = stored.get(e.id);
          if (!prev || prev.metadata?.revisionKey === e.metadata?.revisionKey) return [];
          return [{ ...e, collectedAt: prev.collectedAt, metadata: { ...e.metadata, revisedAt: new Date(now()).toISOString() } }];
        });
        if (revised.length) {
          await store.replaceEvents(revised);
          report.duplicates -= revised.length;
          report.revised = revised.length;
        }
      }
      importedThisRun.push(...toWrite);
      report.imported = toWrite.length;

      await store.putSourceState(adapter.sourceId, result.state);
      const status: SourceStatus = {
        ...prevStatus,
        lastAttemptAt: attemptAt,
        lastSuccessAt: attemptAt,
        firstSuccessAt: prevStatus.firstSuccessAt ?? prevStatus.lastSuccessAt ?? attemptAt,
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
          ? `${report.notModified ? '304 not modified' : `${report.itemsSeen} seen`} · ${report.imported} new · ${report.duplicates} dup${report.revised ? ` · ${report.revised} revised` : ''} · ${report.rejected} rejected`
          : report.error) +
        ` · ${secs(clock() - tAdapter)}`,
    );
  }
  phases.push(['sources', clock() - tAdapters]);

  const tracked = opts.trackedSourceIds ?? adapters.map((a) => a.sourceId);
  const tSnapshot = clock();
  const { snapshot, transitions, previousScores, previousEvaluatedAt } = await buildSnapshot(store, run, tracked, opts.catalog ?? INDICATOR_CATALOG, now(), log);
  phases.push(['snapshot+indicators', clock() - tSnapshot]);
  const tAfter = clock();

  // Alerting: only this run's CHANGES can fire, so unchanged inputs never re-alert.
  try {
    const alerting = await runAlerting(store, {
      now: now(),
      newEvents: importedThisRun,
      transitions,
      previousScores,
      currentScores: snapshot.regionScores ?? [],
      currentEvaluations: snapshot.indicatorEvaluations ?? [],
      previousEvaluatedAt,
      discordWebhookUrl: opts.discordWebhookUrl ?? null,
      appUrl: opts.appUrl,
      fetchImpl: opts.alertFetch,
      sleep: async () => {},
      log,
    });
    run.alertsCreated = alerting.created;
    run.notificationsSent = alerting.notificationsSent;
    snapshot.activeAlertRules = alerting.activeRules;
    snapshot.alertRuleProblems = alerting.problems;
    for (const e of alerting.errors) run.errors.push({ sourceId: 'alert-delivery', message: sanitizeError(e) });
    for (const p of alerting.problems) log(`ALRT rule "${p.ruleName}" invalid, skipped: ${p.problems.join('; ')}`);
  } catch (err) {
    run.errors.push({ sourceId: 'alert-engine', message: sanitizeError(err) });
    log(`ALRT FAILED: ${sanitizeError(err)}`);
  }
  snapshot.discordConfigured = Boolean(opts.discordWebhookUrl);

  // Latest aircraft positions for the map (kept by the adapter in its source state).
  if (tracked.includes(AIRCRAFT_SOURCE_ID)) {
    try {
      const air = await store.getSourceState<MilitaryAircraftState>(AIRCRAFT_SOURCE_ID);
      if (air?.latest) snapshot.aircraft = air.latest;
    } catch (err) {
      log(`AIR  positions not added to the snapshot: ${sanitizeError(err)}`);
    }
  }
  if (tracked.includes(FLEET_SOURCE_ID)) {
    try {
      const fleet = await store.getSourceState<FleetState>(FLEET_SOURCE_ID);
      if (fleet?.latest) snapshot.fleet = fleet.latest;
    } catch (err) {
      log(`FLT  fleet positions not added to the snapshot: ${sanitizeError(err)}`);
    }
  }
  if (tracked.includes(PORTWATCH_SOURCE_ID)) {
    try {
      const pw = await store.getSourceState<PortwatchState>(PORTWATCH_SOURCE_ID);
      if (pw?.latest) snapshot.chokepoints = pw.latest;
    } catch (err) {
      log(`CHK  chokepoint data not added to the snapshot: ${sanitizeError(err)}`);
    }
  }
  if (tracked.includes(AIS_SOURCE_ID)) {
    try {
      const ais = await store.getSourceState<AisSanctionedState>(AIS_SOURCE_ID);
      if (ais?.latest) snapshot.sanctionedShips = ais.latest;
    } catch (err) {
      log(`SHP  sanctioned-ship data not added to the snapshot: ${sanitizeError(err)}`);
    }
  }

  // Daily brief: once a day, after the snapshot is complete, so it reflects this run.
  // Only when the caller configures it (the collector CLI always does; unit tests opt in).
  if (opts.mode !== 'evaluate-only' && opts.brief) {
    try {
      const r = await runDailyBrief(store, snapshot, {
        now: now(),
        webhookUrl: opts.discordWebhookUrl ?? null,
        appUrl: opts.appUrl,
        hourUtc: opts.brief?.hourUtc,
        force: opts.brief?.force,
        fetchImpl: opts.alertFetch,
        log,
      });
      run.briefSent = r.sent;
      if (!r.sent && r.error) run.errors.push({ sourceId: 'daily-brief', message: sanitizeError(r.error) });
    } catch (err) {
      run.errors.push({ sourceId: 'daily-brief', message: sanitizeError(err) });
      log(`BRIEF FAILED: ${sanitizeError(err)}`);
    }
  }

  phases.push(['alerts+brief+layers', clock() - tAfter]);
  run.finishedAt = new Date(now()).toISOString();
  snapshot.lastRun = run;
  const tWrite = clock();
  await store.putRun(run);
  await store.putSnapshot(snapshot);
  phases.push(['final writes', clock() - tWrite]);
  log(`TIME ${phases.map(([n, ms]) => `${n} ${secs(ms)}`).join(' · ')}`);
  return { run, reports, snapshot };
}

/** Hours of event history loaded per run: the longest indicator lookback plus margin. */
export function snapshotLookbackHours(catalog: IndicatorDefinition[]): number {
  return Math.max(14 * 24, requiredLookbackHours(catalog) + 24);
}
/**
 * Upper bound for the fallback events query. The Firestore store normally serves the window
 * from day buckets (~46 reads, no cap); this cap only applies outside the bucket window.
 */
export const EVENT_QUERY_LIMIT = 20_000;

const eventTime = (e: { publishedAt: string | null; collectedAt: string }) => e.publishedAt ?? e.collectedAt;

/**
 * Loads recent events ONCE, evaluates indicators and the RAI over them, logs
 * state transitions, and assembles the dashboard snapshot from the same data.
 * An indicator-engine failure is recorded on the run, never silently dropped,
 * and never prevents the snapshot (with fresh events) from being written.
 */
export async function buildSnapshot(
  store: CollectorStore,
  run: CollectionRun,
  sourceIds: string[],
  catalog: IndicatorDefinition[],
  now: number,
  log: (msg: string) => void = () => {},
): Promise<{
  snapshot: DashboardSnapshot;
  transitions: IndicatorTransition[];
  previousScores: RegionScore[];
  previousEvaluatedAt: string | null;
}> {
  const statuses = (await Promise.all(sourceIds.map((id) => store.getSourceStatus(id)))).filter(
    (s): s is SourceStatus => s !== null,
  );
  const since = new Date(now - snapshotLookbackHours(catalog) * 3_600_000).toISOString();
  const loaded = await store.eventsCollectedSince(since, EVENT_QUERY_LIMIT);
  const previous = await store.getSnapshot();

  const snapshot: DashboardSnapshot = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt: new Date(now).toISOString(),
    events: [],
    sourceStatus: statuses,
    lastRun: run,
    totalEventsStored: await store.countEvents(),
    indicatorCatalogVersion: CATALOG_VERSION,
    indicatorEvaluations: previous?.indicatorEvaluations ?? [],
    regionScores: previous?.regionScores ?? [],
    scoreHistory: previous?.scoreHistory ?? [],
  };

  let transitions: IndicatorTransition[] = [];
  try {
    const evaluated = evaluateAll(catalog, loaded, statuses, now, previous?.indicatorEvaluations ?? []);
    const evaluations = evaluated.evaluations;
    transitions = evaluated.transitions;
    const scores = computeAllRegionScores(catalog, evaluations, now);
    if (transitions.length) await store.putIndicatorTransitions(transitions);
    snapshot.indicatorEvaluations = evaluations;
    snapshot.regionScores = scores;
    snapshot.scoreHistory = appendScoreHistory(previous?.scoreHistory ?? [], scores, now);
    await store.putRaiPoint(snapshot.scoreHistory[snapshot.scoreHistory.length - 1]);
    const active = evaluations.filter((e) => e.state === 'TRIGGERED' || e.state === 'ELEVATED').length;
    log(`IWE  ${evaluations.length} indicators evaluated · ${active} active · ${transitions.length} state change(s)`);
  } catch (err) {
    const message = sanitizeError(err);
    run.errors.push({ sourceId: 'indicator-engine', message });
    log(`IWE  FAILED: ${message} (previous indicator states retained)`);
  }

  let events = [...loaded]
    .sort((a, b) => eventTime(b).localeCompare(eventTime(a)))
    .slice(0, SNAPSHOT_MAX_EVENTS)
    .map((e) => (e.summary && e.summary.length > SNAPSHOT_SUMMARY_CHARS ? { ...e, summary: `${e.summary.slice(0, SNAPSHOT_SUMMARY_CHARS - 1)}…` } : e));
  snapshot.events = events;
  while (Buffer.byteLength(JSON.stringify(snapshot)) > SNAPSHOT_MAX_BYTES && events.length > 0) {
    events = events.slice(0, Math.floor(events.length * 0.9));
    snapshot.events = events;
  }
  return {
    snapshot,
    transitions,
    previousScores: previous?.regionScores ?? [],
    previousEvaluatedAt: previous?.indicatorEvaluations?.[0]?.evaluatedAt ?? null,
  };
}
