import type { CollectionRun, IntelligenceEvent, SourceStatus } from '../shared/domain/types.ts';
import { getSource } from '../shared/domain/sources.ts';
import { computeBaseActivity } from '../shared/domain/baseActivity.ts';
import { computeConvergence } from '../shared/domain/convergence.ts';
import { findCountryHotspots } from '../shared/domain/countryConvergence.ts';
import { trackHotspots, type ConvergenceMemory } from '../shared/domain/convergenceMemory.ts';
import { CONVERGENCE_SOURCE_ID, convergenceRecord } from './lib/convergenceRecords.ts';
import { loadBases } from './lib/bases.ts';
import { loadInfrastructure } from './lib/infrastructure.ts';
import { computeInfrastructure } from '../shared/domain/infraProximity.ts';
import { computeActors, packRegistry, unpackRegistry } from '../shared/domain/actorsTrack.ts';
import { sourceCadence } from '../shared/domain/quietSources.ts';
import { computeMeters } from '../shared/domain/meters/index.ts';
import type { HolidayCounts } from '../shared/domain/meters/util.ts';
import type { MetersSnapshot } from '../shared/domain/meters/types.ts';
import { appendLong, leadLag, type HistoryPoint } from '../shared/domain/meters/history.ts';
import { LAUNCHES_SOURCE_ID, type LaunchesState } from './adapters/launches.ts';
import { computeHealth } from '../shared/domain/health.ts';
import {
  SNAPSHOT_MAX_BYTES,
  SNAPSHOT_MAX_EVENTS,
  SNAPSHOT_SUMMARY_CHARS,
  SNAPSHOT_SCHEMA_VERSION,
  splitSnapshot,
  type DashboardSnapshot,
} from '../shared/domain/snapshot.ts';
import { CATALOG_VERSION, INDICATOR_CATALOG } from '../shared/domain/indicators/catalog.ts';
import { evaluateAll, requiredLookbackHours } from '../shared/domain/indicators/evaluate.ts';
import { appendScoreHistory, computeAllRegionScores } from '../shared/domain/indicators/rai.ts';
import type { IndicatorDefinition, IndicatorTransition, RegionScore } from '../shared/domain/indicators/types.ts';
import { publicRuleLabel, runAlerting } from './alerts/alerting.ts';
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
import { ODIN_SOURCE_ID, type OdinState } from './adapters/odin.ts';
import { AIRPORT_STATUS_SOURCE_ID, NOTICES_SOURCE_ID, type AirportStatusState, type NoticesState } from './adapters/faa.ts';
import type { TfrState } from './adapters/usDomestic.ts';
import type { RadState } from './adapters/radiation.ts';
import { DONKI_SOURCE_ID, SWPC_SOURCE_ID, type DonkiState, type SwpcState } from './adapters/spaceWeather.ts';
import { EPSS_SOURCE_ID, type EpssState } from './adapters/cyberAgencies.ts';
import type { CisaKevState } from './adapters/cisaKev.ts';
import { buildCyberSnapshot } from '../shared/domain/cyber.ts';
import { GS_SOURCE_ID, type GeneralStaffState } from './adapters/ukraineFront.ts';
import { AF_SOURCE_ID, type AirForceState } from './adapters/uaAirForce.ts';
import { OONI_SOURCE_ID, type OoniState } from './adapters/ooni.ts';
import { NGA_SOURCE_ID, type NgaState } from './adapters/ngaMsi.ts';
import { EMERGENCY_SOURCE_ID, type EmergencyState } from './adapters/adsbEmergencies.ts';
import { UCDP_SOURCE_ID, type UcdpState } from './adapters/ucdp.ts';
import type { TaiwanPlaState } from './adapters/taiwanPla.ts';
import { TAIWAN_PLA_SOURCE_ID } from '../shared/domain/taiwanPla.ts';
import { GNSS_SOURCE_ID, type GnssState } from './adapters/gnssInterference.ts';
import { BGP_SOURCE_ID, DDOS_SOURCE_ID, type BgpState, type DdosState } from './adapters/radarNet.ts';
import { TRAFFIC_SOURCE_ID, type TrafficState } from './adapters/aisTraffic.ts';
import { RADIO_RECEIVERS_SOURCE_ID, type RadioReceiversState } from './adapters/radioReceivers.ts';
import { SHORTWAVE_SOURCE_ID, type ShortwaveState } from './adapters/shortwaveSchedule.ts';
import { LOCAL_RADIO_SOURCE_ID, type LocalRadioState } from './adapters/localRadio.ts';
import { RADIO_GUIDE_MAX_AGE_MS, type RadioGuide } from '../shared/domain/shortwave.ts';
import { claimsFrom } from '../shared/domain/ukraineFront.ts';
import { NETWORK_SOURCE, clusterStations, type RadNetwork } from '../shared/domain/radiation.ts';
import { UNHCR_SOURCE_ID, type UnhcrState } from './adapters/unhcr.ts';
import { MARKETS_SOURCE_ID, type PolymarketState } from './adapters/polymarket.ts';
import { AIS_SOURCE_ID, type AisSanctionedState } from './adapters/aisSanctioned.ts';

/** Sources fetched at once. One slot can be held for ~25 s by the AIS listening window. */
export const SOURCE_CONCURRENCY = 5;

/** Runs `fn` over `items` with at most `limit` in flight; results keep the input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

export interface PipelineOptions {
  trigger: CollectionRun['trigger'];
  /** Sources fetched concurrently (default SOURCE_CONCURRENCY). */
  sourceConcurrency?: number;
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
  note?: string;
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

  // Phase 1 (concurrent): each source fetches and parses. Sources are on different hosts and
  // spend their time waiting on the network, so several run at once. Nothing is written here.
  const collectOne = async (adapter: SourceAdapter<never>) => {
    const t = clock();
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
      return { attemptAt, prevStatus, result, error: null as unknown, ms: clock() - t };
    } catch (error) {
      return { attemptAt, prevStatus, result: null, error, ms: clock() - t };
    }
  };
  const collected = await mapLimit(adapters, opts.sourceConcurrency ?? SOURCE_CONCURRENCY, collectOne);

  // Phase 2 (in order): validate, de-duplicate and write, one source at a time, as before.
  for (const [i, adapter] of adapters.entries()) {
    const { attemptAt, prevStatus, result: collectedResult, error: collectError, ms } = collected[i];
    const def = getSource(adapter.sourceId);
    const report: SourceRunReport = {
      sourceId: adapter.sourceId, ok: false, notModified: false, itemsSeen: 0,
      candidates: 0, imported: 0, duplicates: 0, rejected: 0, error: null,
    };

    try {
      if (!collectedResult) throw collectError;
      const result = collectedResult;
      report.itemsSeen = result.itemsSeen;
      report.notModified = result.notModified;
      report.note = result.note;

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
          ? `${report.note ? `${report.note} · ` : ''}${report.notModified ? '304 not modified' : `${report.itemsSeen} seen`} · ${report.imported} new · ${report.duplicates} dup${report.revised ? ` · ${report.revised} revised` : ''} · ${report.rejected} rejected`
          : report.error) +
        ` · ${secs(ms)}`,
    );
  }
  phases.push(['sources', clock() - tAdapters]);

  const tracked = opts.trackedSourceIds ?? adapters.map((a) => a.sourceId);
  const tSnapshot = clock();
  const { snapshot, loaded, transitions, previousScores, previousEvaluatedAt } = await buildSnapshot(store, run, tracked, opts.catalog ?? INDICATOR_CATALOG, now(), log);
  phases.push(['snapshot+indicators', clock() - tSnapshot]);
  const tAfter = clock();

  // Signal convergence (v0.79.0 map hotspots, v0.80.0 countries), before alerting: a new or upgraded
  // hotspot becomes a record, so alert rules can fire on it in this run.
  try {
    const gen = Date.parse(snapshot.generatedAt);
    const gnssState = tracked.includes(GNSS_SOURCE_ID) ? await store.getSourceState<GnssState>(GNSS_SOURCE_ID) : null;
    const gnssFresh = gnssState?.latest && gen - Date.parse(gnssState.latest.fetchedAt) < 3 * 3_600_000 ? gnssState.latest : null;
    const conv = { ...computeConvergence(loaded, gnssFresh, gen), countries: findCountryHotspots(loaded, gen) };
    snapshot.convergence = conv;
    const prev = await store.getSourceState<ConvergenceMemory>(CONVERGENCE_SOURCE_ID);
    const { memory, changes } = trackHotspots(prev, conv.hotspots, conv.countries, gen);
    const records = changes.map((c) => convergenceRecord(c, snapshot.generatedAt, opts.appUrl)).filter((e) => {
      const reason = validateEvent(e, now());
      if (reason) log(`  reject ${CONVERGENCE_SOURCE_ID}: ${reason}`);
      return !reason;
    });
    const fresh = await store.filterNewEventIds(records.map((e) => e.id));
    const toWrite = records.filter((e) => fresh.has(e.id));
    if (toWrite.length) await store.putEvents(toWrite);
    await store.putSourceState(CONVERGENCE_SOURCE_ID, memory);
    importedThisRun.push(...toWrite);
    run.recordsImported += toWrite.length;
    const strong = (xs: { level: string }[]) => xs.filter((h) => h.level === 'strong').length;
    log(
      `CNV  ${conv.hotspots.length} map hotspots (${strong(conv.hotspots)} strong) from ${conv.signalsChecked} located signals (72 h) · ` +
        `${conv.countries.length} country hotspots (${strong(conv.countries)} strong, 48 h) · ${toWrite.length} new or upgraded recorded`,
    );
  } catch (err) {
    log(`CNV  convergence not computed: ${sanitizeError(err)}`);
  }

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
      recentEvents: loaded,
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
    // Names stay out of the public run log; the problems are shown in full on the Alerts page.
    for (const p of alerting.problems) log(`ALRT ${p.ruleId === 'watchlist' ? 'watchlist' : publicRuleLabel(p.ruleId)} invalid, skipped (${p.problems.length} problem(s))`);
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
  if (tracked.includes(ODIN_SOURCE_ID)) {
    try {
      const odin = await store.getSourceState<OdinState>(ODIN_SOURCE_ID);
      // Only a recent reading: outages change by the hour, so a stale one is left out.
      if (odin?.latest && Date.parse(odin.latest.fetchedAt) > Date.parse(snapshot.generatedAt) - 3 * 3_600_000) snapshot.powerOutages = odin.latest;
    } catch (err) {
      log(`PWR  power outage data not added to the snapshot: ${sanitizeError(err)}`);
    }
  }
  // FAA layers (Phase 17). Airport status changes by the minute, so only a recent reading is used.
  try {
    const [tfr, airports, notices] = await Promise.all([
      tracked.includes('faa-tfr') ? store.getSourceState<TfrState>('faa-tfr') : null,
      tracked.includes(AIRPORT_STATUS_SOURCE_ID) ? store.getSourceState<AirportStatusState>(AIRPORT_STATUS_SOURCE_ID) : null,
      tracked.includes(NOTICES_SOURCE_ID) ? store.getSourceState<NoticesState>(NOTICES_SOURCE_ID) : null,
    ]);
    if (tfr?.latest) snapshot.tfrs = tfr.latest;
    if (airports?.latest && Date.parse(airports.latest.fetchedAt) > Date.parse(snapshot.generatedAt) - 3 * 3_600_000) snapshot.airportStatus = airports.latest;
    if (notices?.latest) snapshot.airspaceNotices = notices.latest;
  } catch (err) {
    log(`FAA  FAA layers not added to the snapshot: ${sanitizeError(err)}`);
  }
  // Radiation networks (Phase 18): summaries and raised stations from readings of the last 6 hours (RadNet 30).
  try {
    const nets = (Object.keys(NETWORK_SOURCE) as RadNetwork[]).filter((n) => tracked.includes(NETWORK_SOURCE[n]));
    const states = await Promise.all(nets.map((n) => store.getSourceState<RadState>(NETWORK_SOURCE[n])));
    const live = states.filter((s): s is RadState => !!s?.latest && Date.parse(s.latest.summary.fetchedAt) > Date.parse(snapshot.generatedAt) - (s.latest.summary.network === 'radnet' ? 30 : 6) * 3_600_000);
    if (live.length) {
      const flagged = live.flatMap((s) => s.latest!.flagged).slice(0, 60);
      snapshot.radiation = { networks: live.map((s) => s.latest!.summary), flagged, clusters: clusterStations(flagged) };
    }
  } catch (err) {
    log(`RAD  radiation not added to the snapshot: ${sanitizeError(err)}`);
  }
  // Space weather (Phase 19): NOAA scales and messages (recent only) with NASA's CME arrivals.
  try {
    const [swpc, donki] = await Promise.all([
      tracked.includes(SWPC_SOURCE_ID) ? store.getSourceState<SwpcState>(SWPC_SOURCE_ID) : null,
      tracked.includes(DONKI_SOURCE_ID) ? store.getSourceState<DonkiState>(DONKI_SOURCE_ID) : null,
    ]);
    const gen = Date.parse(snapshot.generatedAt);
    const sw = swpc && gen - Date.parse(swpc.lastFetchedAt) <= 6 * 3_600_000 ? swpc : null;
    const nd = donki && gen - Date.parse(donki.lastFetchedAt) <= 24 * 3_600_000 ? donki : null;
    if (sw || nd) {
      snapshot.spaceWeather = {
        fetchedAt: sw?.lastFetchedAt ?? nd!.lastFetchedAt,
        now: sw?.now ?? null,
        forecast: sw?.forecast ?? [],
        kp: sw?.kp ?? null,
        arrivals: (nd?.arrivals ?? []).filter((a) => Date.parse(a.arrival) >= gen - 12 * 3_600_000),
        cmes7d: nd?.cmes7d ?? 0,
        fastest7d: nd?.fastest7d ?? null,
        storms: nd?.storms ?? [],
        messages: sw?.messages ?? [],
      };
    }
  } catch (err) {
    log(`SWX  space weather not added to the snapshot: ${sanitizeError(err)}`);
  }
  // CYBER page (Phase 20): built from loaded records and the KEV catalog's last 30 days, so it does not
  // depend on which records fit in the feed snapshot.
  try {
    const [kev, epss] = await Promise.all([
      tracked.includes('cisa-kev') ? store.getSourceState<CisaKevState>('cisa-kev') : null,
      tracked.includes(EPSS_SOURCE_ID) ? store.getSourceState<EpssState>(EPSS_SOURCE_ID) : null,
    ]);
    snapshot.cyber = buildCyberSnapshot(loaded, kev?.recent ?? [], epss?.scores ?? {}, epss?.lastFetchedAt ?? null, Date.parse(snapshot.generatedAt));
  } catch (err) {
    log(`CYB  cyber page data not added to the snapshot: ${sanitizeError(err)}`);
  }
  // Ukraine front (Phase 21): General Staff reports (state) and territorial claims in loaded headlines.
  try {
    const [gs, af] = await Promise.all([
      tracked.includes(GS_SOURCE_ID) ? store.getSourceState<GeneralStaffState>(GS_SOURCE_ID) : null,
      tracked.includes(AF_SOURCE_ID) ? store.getSourceState<AirForceState>(AF_SOURCE_ID) : null,
    ]);
    const reports = gs?.reports ?? [];
    const full = reports.filter((r) => r.fullDay).slice(0, 30);
    const partial = reports.find((r) => !r.fullDay) ?? null;
    snapshot.ukraineFront = { reports: full, today: partial && (!full[0] || partial.day > full[0].day) ? partial : null, claims: claimsFrom(loaded, Date.parse(snapshot.generatedAt)), air: (af?.reports ?? []).slice(0, 30) };
  } catch (err) {
    log(`UAF  Ukraine front not added to the snapshot: ${sanitizeError(err)}`);
  }
  // OONI censorship readings (Phase 23).
  try {
    const oo = tracked.includes(OONI_SOURCE_ID) ? await store.getSourceState<OoniState>(OONI_SOURCE_ID) : null;
    if (oo?.countries.length) snapshot.censorship = { countries: oo.countries };
  } catch (err) {
    log(`CEN  censorship readings not added to the snapshot: ${sanitizeError(err)}`);
  }
  // Phase 25: navigational warnings (while fresh), aircraft emergencies (last 90 minutes) and UCDP conflict events.
  try {
    const [nga, emg, ged, gnss] = await Promise.all([
      tracked.includes(NGA_SOURCE_ID) ? store.getSourceState<NgaState>(NGA_SOURCE_ID) : null,
      tracked.includes(EMERGENCY_SOURCE_ID) ? store.getSourceState<EmergencyState>(EMERGENCY_SOURCE_ID) : null,
      tracked.includes(UCDP_SOURCE_ID) ? store.getSourceState<UcdpState>(UCDP_SOURCE_ID) : null,
      tracked.includes(GNSS_SOURCE_ID) ? store.getSourceState<GnssState>(GNSS_SOURCE_ID) : null,
    ]);
    const gen = Date.parse(snapshot.generatedAt);
    if (nga?.fetchedAt && gen - Date.parse(nga.fetchedAt) < 48 * 3_600_000) snapshot.navWarnings = { warnings: nga.warnings, activeTotal: nga.activeTotal, fetchedAt: nga.fetchedAt, asOf: nga.asOf ?? null, via: nga.via ?? 'api' };
    if (emg?.latest && gen - Date.parse(emg.latest.fetchedAt) < 90 * 60_000) snapshot.aircraftEmergencies = emg.latest;
    if (ged?.latest) snapshot.conflictEvents = ged.latest;
    // GPS interference: the last hourly sample, while under three hours old.
    if (gnss?.latest && gen - Date.parse(gnss.latest.fetchedAt) < 3 * 3_600_000) snapshot.gnss = gnss.latest;
  } catch (err) {
    log(`P25  warnings, emergencies or conflict events not added to the snapshot: ${sanitizeError(err)}`);
  }
  // v0.70.0: route hijacks and leaks (last 7 days) and DDoS levels (last daily read, under 3 days old).
  try {
    const [bgp, ddos] = await Promise.all([
      tracked.includes(BGP_SOURCE_ID) ? store.getSourceState<BgpState>(BGP_SOURCE_ID) : null,
      tracked.includes(DDOS_SOURCE_ID) ? store.getSourceState<DdosState>(DDOS_SOURCE_ID) : null,
    ]);
    const gen = Date.parse(snapshot.generatedAt);
    const ddosFresh = ddos && gen - Date.parse(ddos.fetchedAt) < 3 * 86_400_000 ? ddos : null;
    if (bgp || ddosFresh) {
      snapshot.netAttacks = {
        fetchedAt: bgp?.fetchedAt ?? null,
        hijacks: bgp?.hijacks ?? [],
        leaks: bgp?.leaks ?? [],
        ddos: ddosFresh ? { fetchedAt: ddosFresh.fetchedAt, countries: ddosFresh.countries, noData: ddosFresh.noData } : null,
      };
    }
  } catch (err) {
    log(`NET  routing or DDoS data not added to the snapshot: ${sanitizeError(err)}`);
  }
  // v0.82.0: PLA activity around Taiwan (daily; shown while under 4 days old).
  if (tracked.includes(TAIWAN_PLA_SOURCE_ID)) {
    try {
      const pla = await store.getSourceState<TaiwanPlaState>(TAIWAN_PLA_SOURCE_ID);
      if (pla?.latest && Date.parse(snapshot.generatedAt) - Date.parse(pla.latest.fetchedAt) < 4 * 86_400_000) snapshot.taiwanPla = pla.latest;
    } catch (err) {
      log(`PLA  Taiwan PLA activity not added to the snapshot: ${sanitizeError(err)}`);
    }
  }
  // v0.75.0: tanker and cargo traffic lives in its own document (snapshots/ships), written after a new window.
  if (tracked.includes(TRAFFIC_SOURCE_ID)) {
    try {
      const tr = await store.getSourceState<TrafficState>(TRAFFIC_SOURCE_ID);
      if (tr?.latest && tr.latest.fetchedAt >= run.startedAt) await store.putShipTraffic(tr.latest);
    } catch (err) {
      log(`SHIP tanker and cargo traffic not written: ${sanitizeError(err)}`);
    }
  }
  // Phase 28: public shortwave receivers for "tune nearby" links (a week old at most).
  if (tracked.includes(RADIO_RECEIVERS_SOURCE_ID)) {
    try {
      const rx = await store.getSourceState<RadioReceiversState>(RADIO_RECEIVERS_SOURCE_ID);
      if (rx?.latest && Date.parse(snapshot.generatedAt) - Date.parse(rx.latest.fetchedAt) < 7 * 86_400_000) snapshot.radioReceivers = rx.latest;
    } catch (err) {
      log(`RAD  receiver list not added to the snapshot: ${sanitizeError(err)}`);
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
  if (tracked.includes(UNHCR_SOURCE_ID)) {
    try {
      const u = await store.getSourceState<UnhcrState>(UNHCR_SOURCE_ID);
      if (u?.latest) snapshot.displacement = u.latest;
    } catch (err) {
      log(`DSP  displacement figures not added to the snapshot: ${sanitizeError(err)}`);
    }
  }
  if (tracked.includes(MARKETS_SOURCE_ID)) {
    try {
      const pm = await store.getSourceState<PolymarketState>(MARKETS_SOURCE_ID);
      if (pm?.latest) snapshot.predictionMarkets = pm.latest;
    } catch (err) {
      log(`PM   market odds not added to the snapshot: ${sanitizeError(err)}`);
    }
  }

  // Meters and monitors (Phase 14): computed over everything loaded, written in the final writes.
  let meters: MetersSnapshot | null = null;
  let meterHistory: HistoryPoint[] | null = null;
  let holidayCounts: HolidayCounts | null = null;
  try {
    const t = now();
    const [previousMeters, launches, longRaw, holidayRaw] = await Promise.all([
      store.getMetersSnapshot(),
      tracked.includes(LAUNCHES_SOURCE_ID) ? store.getSourceState<LaunchesState>(LAUNCHES_SOURCE_ID) : Promise.resolve(null),
      store.getCollectorState<{ packed: string }>(METER_HISTORY_KEY),
      store.getCollectorState<{ packed: string }>(HOLIDAY_COUNTS_KEY),
    ]);
    const storedHolidays: HolidayCounts = holidayRaw ? (JSON.parse(holidayRaw.packed) as HolidayCounts) : {};
    const holidaySink: HolidayCounts = {};
    const historyStart = loaded.reduce((m, e) => Math.min(m, Date.parse(e.collectedAt)), Infinity);
    meters = computeMeters({
      now: t,
      events: loaded,
      historyStart: Number.isFinite(historyStart) ? historyStart : null,
      sourceStatus: snapshot.sourceStatus,
      regionScores: snapshot.regionScores ?? [],
      indicatorEvaluations: snapshot.indicatorEvaluations ?? [],
      scoreHistory: snapshot.scoreHistory ?? [],
      aircraft: snapshot.aircraft ?? null,
      fleet: snapshot.fleet ?? null,
      chokepoints: snapshot.chokepoints ?? null,
      powerOutages: snapshot.powerOutages ?? null,
      tfrs: snapshot.tfrs ?? null,
      airportStatus: snapshot.airportStatus ?? null,
      airspaceNotices: snapshot.airspaceNotices ?? null,
      radiation: snapshot.radiation ?? null,
      spaceWeather: snapshot.spaceWeather ?? null,
      ukraineFront: snapshot.ukraineFront ?? null,
      sanctionedShips: snapshot.sanctionedShips ?? null,
      displacement: snapshot.displacement ?? null,
      predictionMarkets: snapshot.predictionMarkets ?? null,
      infrastructure: snapshot.infrastructure ?? null,
      actors: snapshot.actors ?? null,
      upcomingLaunches: launches?.upcoming ?? [],
      previous: previousMeters,
      holidayCounts: storedHolidays,
      holidaySink,
    });
    holidayCounts = mergeHolidayCounts(storedHolidays, holidaySink, t);
    // Quiet daily sources, for the brief.
    snapshot.quietSources = sourceCadence(loaded, snapshot.sourceStatus, t, Number.isFinite(historyStart) ? historyStart : null)
      .filter((s) => s.quiet)
      .map((s) => ({ sourceId: s.sourceId, name: s.name, hoursSinceNew: s.hoursSinceNew ?? 0, usualPerDay: s.usualPerDay }));
    meterHistory = appendLong(longRaw ? (JSON.parse(longRaw.packed) as HistoryPoint[]) : [], meters.history[meters.history.length - 1]);
    meters.leadLag = leadLag(meterHistory, t);
    const raised = meters.meters.filter((m) => m.level !== null && m.level >= 3 && m.family !== 'quality').length;
    log(`MTR  ${meters.meters.length} meters · ${raised} elevated or high · ${meters.historyDays} d history · ${meterHistory.length} long-history points`);
  } catch (err) {
    meters = null;
    log(`MTR  meters not computed: ${sanitizeError(err)}`);
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
  // Layers were attached after the first trim in buildSnapshot: trim again so the document still fits.
  const trimmed = fitSnapshot(snapshot);
  if (trimmed > 0) log(`SNAP ${trimmed} oldest record(s) left out of the snapshot to stay under ${SNAPSHOT_MAX_BYTES.toLocaleString('en-US')} bytes (layers are stored separately)`);
  await store.putSnapshot(snapshot);
  if (meters && meterHistory) {
    try {
      await store.putMetersSnapshot(meters);
      await store.putCollectorState(METER_HISTORY_KEY, { packed: JSON.stringify(meterHistory), updatedAt: run.finishedAt });
      if (holidayCounts) await store.putCollectorState(HOLIDAY_COUNTS_KEY, { packed: JSON.stringify(holidayCounts), updatedAt: run.finishedAt });
    } catch (err) {
      log(`MTR  meters not written: ${sanitizeError(err)}`);
    }
  }
  // Radio guide (Phase 29): its own document, rewritten only when a part changed.
  if (tracked.includes(SHORTWAVE_SOURCE_ID) || tracked.includes(LOCAL_RADIO_SOURCE_ID)) {
    try {
      const fresh = (iso: string | undefined) => !!iso && Date.parse(run.finishedAt!) - Date.parse(iso) < RADIO_GUIDE_MAX_AGE_MS;
      const [sw, lr, stored] = await Promise.all([
        tracked.includes(SHORTWAVE_SOURCE_ID) ? store.getSourceState<ShortwaveState>(SHORTWAVE_SOURCE_ID) : null,
        tracked.includes(LOCAL_RADIO_SOURCE_ID) ? store.getSourceState<LocalRadioState>(LOCAL_RADIO_SOURCE_ID) : null,
        store.getRadioGuide(),
      ]);
      const guide: RadioGuide = {
        generatedAt: run.finishedAt!,
        shortwave: sw?.latest && fresh(sw.latest.fetchedAt) ? sw.latest : null,
        localRadio: lr?.latest && fresh(lr.latest.fetchedAt) ? lr.latest : null,
      };
      if (!stored || stored.shortwave?.fetchedAt !== guide.shortwave?.fetchedAt || stored.localRadio?.fetchedAt !== guide.localRadio?.fetchedAt) {
        await store.putRadioGuide(guide);
        log(`RAD  radio guide written: ${guide.shortwave?.broadcasts.length ?? 0} shortwave rows, ${guide.localRadio?.stations.length ?? 0} local stations, ${Buffer.byteLength(JSON.stringify(guide)).toLocaleString('en-US')} bytes`);
      }
    } catch (err) {
      log(`RAD  radio guide not written: ${sanitizeError(err)}`);
    }
  }
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
/**
 * Drops the oldest records (10% at a time) until the serialized snapshot is under SNAPSHOT_MAX_BYTES
 * (Firestore caps a document at 1 MiB). Returns how many records were left out.
 */
export function fitSnapshot(snapshot: DashboardSnapshot): number {
  const before = snapshot.events.length;
  // Only the dashboard document counts: layers are stored in their own document (splitSnapshot).
  while (Buffer.byteLength(JSON.stringify(splitSnapshot(snapshot).main)) > SNAPSHOT_MAX_BYTES && snapshot.events.length > 0) {
    snapshot.events = snapshot.events.slice(0, Math.floor(snapshot.events.length * 0.9));
  }
  return before - snapshot.events.length;
}

/** Collector-only long meter history (packed, one point per 3 hours, 120 days). */
export const METER_HISTORY_KEY = 'meterHistory';
/** Collector-only daily counts on holidays per usual-level series, kept 3 years (like-for-like baselines). */
export const HOLIDAY_COUNTS_KEY = 'holidayCounts';
const HOLIDAY_KEEP_DAYS = 3 * 366;

/** Stored holiday counts plus this run's (newer wins), dropping days older than three years. */
export function mergeHolidayCounts(stored: HolidayCounts, fresh: HolidayCounts, now: number): HolidayCounts {
  const cutoff = new Date(now - HOLIDAY_KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  const out: HolidayCounts = {};
  for (const key of new Set([...Object.keys(stored), ...Object.keys(fresh)])) {
    const days = Object.entries({ ...stored[key], ...fresh[key] }).filter(([d]) => d >= cutoff);
    if (days.length) out[key] = Object.fromEntries(days.sort(([a], [b]) => a.localeCompare(b)));
  }
  return out;
}
/** Collector-only registry of every candidate name seen in headlines (for first-appearance flags). */
export const NAME_REGISTRY_KEY = 'nameRegistry';

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
  loaded: IntelligenceEvent[];
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

  // Activity near bases: records naming or near each installation this week against earlier weeks.
  try {
    const { refs, matcher } = loadBases();
    snapshot.baseActivity = computeBaseActivity(refs, loaded, now, matcher);
    const b = snapshot.baseActivity;
    log(`BAS  ${b.items.length} installation(s) with records this week · ${b.items.filter((i) => i.unusual).length} unusual · ${b.historyDays} d history${b.flagsActive ? '' : ' (flags start at 21 d)'}`);
  } catch (err) {
    log(`BAS  base activity not computed: ${sanitizeError(err)}`);
  }

  // People and groups; new names (the registry of names already seen is collector-only state).
  try {
    const stored = await store.getCollectorState<{ packed: string }>(NAME_REGISTRY_KEY);
    const historyStart = loaded.reduce((m, e) => Math.min(m, Date.parse(e.collectedAt)), Infinity);
    const { snapshot: actors, registry } = computeActors(loaded, now, Number.isFinite(historyStart) ? historyStart : null, stored ? unpackRegistry(stored.packed) : null);
    snapshot.actors = actors;
    await store.putCollectorState(NAME_REGISTRY_KEY, { packed: packRegistry(registry), updatedAt: new Date(now).toISOString() });
    log(`ACT  ${actors.actors.length} tracked actors named · ${actors.newNames.length} new name(s) · ${registry.names.size} names known`);
  } catch (err) {
    log(`ACT  people and groups not computed: ${sanitizeError(err)}`);
  }

  // Critical infrastructure near or named in records (72 h).
  try {
    const infra = computeInfrastructure(loadInfrastructure(), loaded, now);
    snapshot.infrastructure = infra;
    log(`INF  ${infra.flagged.length} of ${infra.sitesChecked} infrastructure sites with records near or naming them (72 h)`);
  } catch (err) {
    log(`INF  infrastructure check failed: ${sanitizeError(err)}`);
  }

  const events = [...loaded]
    .sort((a, b) => eventTime(b).localeCompare(eventTime(a)))
    .slice(0, SNAPSHOT_MAX_EVENTS)
    .map((e) => (e.summary && e.summary.length > SNAPSHOT_SUMMARY_CHARS ? { ...e, summary: `${e.summary.slice(0, SNAPSHOT_SUMMARY_CHARS - 1)}…` } : e));
  snapshot.events = events;
  fitSnapshot(snapshot);
  return {
    snapshot,
    loaded,
    transitions,
    previousScores: previous?.regionScores ?? [],
    previousEvaluatedAt: previous?.indicatorEvaluations?.[0]?.evaluatedAt ?? null,
  };
}
