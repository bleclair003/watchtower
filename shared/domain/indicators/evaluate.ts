import type { IntelligenceEvent, SourceStatus } from '../types.ts';
import { getSource } from '../sources.ts';
import { computeHealth } from '../health.ts';
import { matches } from './conditions.ts';
import type { BaselineResult, IndicatorDefinition, IndicatorEvaluation, IndicatorState, IndicatorTransition } from './types.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Adapters import this much history on their first run, so a source's record is complete back to firstSuccess − this. */
export const FIRST_RUN_BACKFILL_DAYS = 30;
export const MAX_EVIDENCE = 25;
/** Tolerated clock skew for events dated slightly in the future. */
const FUTURE_SKEW = 6 * HOUR;

const eventTime = (e: IntelligenceEvent) => Date.parse(e.publishedAt ?? e.collectedAt);

/** Longest history any indicator needs; the collector loads this much. */
export function requiredLookbackHours(defs: IndicatorDefinition[]): number {
  return Math.max(...defs.map((d) => d.windowHours + (d.baseline ? d.baseline.days * 24 : 0)));
}

function gateOnSources(
  def: IndicatorDefinition,
  statuses: SourceStatus[],
  now: number,
): { state: 'DATA_UNAVAILABLE' | 'UNKNOWN'; reason: string } | { state: null; historyStart: number } {
  let historyStart = -Infinity;
  for (const id of def.requiredSourceIds) {
    const status = statuses.find((s) => s.sourceId === id);
    if (!status || !status.lastSuccessAt) {
      return { state: 'DATA_UNAVAILABLE', reason: `Required source ${id} has never been collected.` };
    }
    const health = computeHealth(status, getSource(id)?.pollIntervalMinutes ?? null, now);
    if (health === 'OFFLINE' || health === 'STALE') {
      return { state: 'UNKNOWN', reason: `Required source ${id} is ${health}; the window may be missing data.` };
    }
    const first = Date.parse(status.firstSuccessAt ?? status.lastSuccessAt) - FIRST_RUN_BACKFILL_DAYS * DAY;
    historyStart = Math.max(historyStart, first);
  }
  return { state: null, historyStart };
}

function dedupe(events: IntelligenceEvent[]): IntelligenceEvent[] {
  const seen = new Set<string>();
  return events.filter((e) => (seen.has(e.contentHash) ? false : (seen.add(e.contentHash), true)));
}

/**
 * Deterministic evaluation of one indicator. Pure: same inputs → same output.
 * `previous` carries stateSince / lastTriggeredAt across runs.
 */
export function evaluateIndicator(
  def: IndicatorDefinition,
  events: IntelligenceEvent[],
  statuses: SourceStatus[],
  now: number,
  previous?: IndicatorEvaluation | null,
): IndicatorEvaluation {
  const nowIso = new Date(now).toISOString();
  const base = {
    indicatorId: def.id,
    regionId: def.regionId,
    evaluatedAt: nowIso,
    configVersion: def.configVersion,
    matchedCount: 0,
    distinctSources: 0,
    elevatedAt: def.elevated.countAtLeast,
    triggeredAt: def.triggered.countAtLeast,
    baseline: { status: def.baseline ? 'insufficient-history' : 'not-configured', meanPerWindow: null, historyDays: 0 } as BaselineResult,
    evidenceEventIds: [] as string[],
  };
  const finish = (state: IndicatorState, reason: string, rest: Partial<IndicatorEvaluation> = {}): IndicatorEvaluation => ({
    ...base,
    ...rest,
    state,
    reason,
    stateSince: previous && previous.state === state ? previous.stateSince : nowIso,
    lastTriggeredAt: state === 'TRIGGERED' && previous?.state !== 'TRIGGERED' ? nowIso : (previous?.lastTriggeredAt ?? null),
  });

  if (!def.enabled) return finish('DISABLED', 'Indicator is disabled.');
  const gate = gateOnSources(def, statuses, now);
  if (gate.state) return finish(gate.state, gate.reason);

  const windowStart = now - def.windowHours * HOUR;
  const candidates = dedupe(events.filter((e) => matches(def.match, e)));
  const inWindow = candidates
    .filter((e) => {
      const t = eventTime(e);
      return t > windowStart && t <= now + FUTURE_SKEW;
    })
    .sort((a, b) => eventTime(b) - eventTime(a));
  const matchedCount = inWindow.length;
  const distinctSources = new Set(inWindow.map((e) => e.sourceId)).size;

  // Baseline: mean matching events per window over the preceding `days`.
  let baseline: BaselineResult = base.baseline;
  let elevatedAt = def.elevated.countAtLeast;
  let triggeredAt = def.triggered.countAtLeast;
  if (def.baseline) {
    const periodStart = windowStart - def.baseline.days * DAY;
    const usableStart = Math.max(periodStart, gate.historyStart);
    const historyMs = Math.max(0, windowStart - usableStart);
    const windowsInHistory = historyMs / (def.windowHours * HOUR);
    const prior = candidates.filter((e) => {
      const t = eventTime(e);
      return t > usableStart && t <= windowStart;
    }).length;
    const mean = windowsInHistory >= 1 ? prior / windowsInHistory : null;
    const sufficient = gate.historyStart <= periodStart;
    baseline = {
      status: sufficient ? 'sufficient' : 'insufficient-history',
      meanPerWindow: mean === null ? null : Math.round(mean * 100) / 100,
      historyDays: Math.round((historyMs / DAY) * 10) / 10,
    };
    if (sufficient && mean !== null) {
      triggeredAt = Math.max(triggeredAt, Math.ceil(def.baseline.triggerRatio * mean));
      elevatedAt = Math.max(elevatedAt, Math.ceil(def.baseline.elevatedRatio * mean));
    }
  }

  const minSrc = (t: { distinctSourcesAtLeast?: number }) => t.distinctSourcesAtLeast ?? 1;
  const rest = {
    matchedCount,
    distinctSources,
    elevatedAt,
    triggeredAt,
    baseline,
    evidenceEventIds: inWindow.slice(0, MAX_EVIDENCE).map((e) => e.id),
  };
  const baselineNote =
    baseline.status === 'insufficient-history' ? ` Baseline not applied: only ${baseline.historyDays} d of history.` : '';
  const counts = `${matchedCount} matching in ${def.windowHours} h from ${distinctSources} source(s)`;

  if (matchedCount >= triggeredAt && distinctSources >= minSrc(def.triggered)) {
    return finish('TRIGGERED', `${counts}; trigger threshold ${triggeredAt}.${baselineNote}`, rest);
  }
  if (matchedCount >= elevatedAt && distinctSources >= minSrc(def.elevated)) {
    return finish('ELEVATED', `${counts}; elevated threshold ${elevatedAt}, trigger ${triggeredAt}.${baselineNote}`, rest);
  }
  return finish('NORMAL', `${counts}; below elevated threshold ${elevatedAt}.${baselineNote}`, rest);
}

/** Evaluates a catalog and reports state transitions relative to the previous run. */
export function evaluateAll(
  defs: IndicatorDefinition[],
  events: IntelligenceEvent[],
  statuses: SourceStatus[],
  now: number,
  previous: IndicatorEvaluation[] = [],
): { evaluations: IndicatorEvaluation[]; transitions: IndicatorTransition[] } {
  const prevById = new Map(previous.map((p) => [p.indicatorId, p]));
  const evaluations = defs.map((d) => evaluateIndicator(d, events, statuses, now, prevById.get(d.id)));
  const transitions: IndicatorTransition[] = evaluations
    .filter((ev) => prevById.get(ev.indicatorId)?.state !== ev.state)
    .map((ev) => ({
      indicatorId: ev.indicatorId,
      regionId: ev.regionId,
      from: prevById.get(ev.indicatorId)?.state ?? null,
      to: ev.state,
      at: ev.evaluatedAt,
      reason: ev.reason,
      evidenceEventIds: ev.evidenceEventIds,
      configVersion: ev.configVersion,
    }));
  return { evaluations, transitions };
}
