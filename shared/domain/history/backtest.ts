import type { IntelligenceEvent, SourceStatus } from '../types.ts';
import { evaluateIndicator } from '../indicators/evaluate.ts';
import type { IndicatorDefinition, IndicatorEvaluation, IndicatorState } from '../indicators/types.ts';
import { availableAt, statusesAt } from './replay.ts';

/**
 * Backtesting (PDD §11 "Backtesting questions").
 *
 * Indicators are re-evaluated at fixed steps using ONLY the data available at
 * each step (hindsight-safe), producing state series. Those are compared with
 * operator-defined OUTCOMES (e.g. the start of a dossier) to answer: did it
 * trigger, how early, how often without an outcome, and which indicators move
 * together. With little collection history, results are reported with an
 * explicit sufficiency figure rather than as conclusions.
 */
export interface StatePoint {
  at: number;
  state: IndicatorState;
}

export interface Episode {
  indicatorId: string;
  start: number;
  /** Last step at which the indicator was still active. */
  end: number;
}

export interface Outcome {
  id: string;
  label: string;
  at: number;
}

const HOUR = 3_600_000;

export function simulateIndicator(
  def: IndicatorDefinition,
  events: IntelligenceEvent[],
  statuses: SourceStatus[],
  from: number,
  to: number,
  stepHours: number,
): StatePoint[] {
  const points: StatePoint[] = [];
  let prev: IndicatorEvaluation | null = null;
  for (let t = from; t <= to; t += stepHours * HOUR) {
    const ev = evaluateIndicator(def, availableAt(events, t), statusesAt(statuses, t), t, prev);
    points.push({ at: t, state: ev.state });
    prev = ev;
  }
  return points;
}

/** Contiguous runs of the given active states. */
export function episodes(indicatorId: string, series: StatePoint[], active: IndicatorState[] = ['TRIGGERED']): Episode[] {
  const out: Episode[] = [];
  let cur: Episode | null = null;
  for (const p of series) {
    if (active.includes(p.state)) {
      if (cur) cur.end = p.at;
      else cur = { indicatorId, start: p.at, end: p.at };
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export interface IndicatorScorecard {
  indicatorId: string;
  episodes: number;
  /** Outcomes preceded by an episode starting within the horizon (lead time in hours). */
  hits: { outcomeId: string; leadHours: number }[];
  misses: string[];
  /** Episodes with no outcome within `horizon` after their start. */
  falseAlarms: number;
  /** Share of evaluated steps with usable data (not UNKNOWN / DATA_UNAVAILABLE / DISABLED). */
  evaluableShare: number;
}

export function scoreIndicator(
  indicatorId: string,
  series: StatePoint[],
  outcomes: Outcome[],
  horizonHours: number,
  active: IndicatorState[] = ['TRIGGERED'],
): IndicatorScorecard {
  const eps = episodes(indicatorId, series, active);
  const horizon = horizonHours * HOUR;
  const hits: IndicatorScorecard['hits'] = [];
  const misses: string[] = [];
  for (const o of outcomes) {
    const before = eps.filter((e) => e.start <= o.at && e.start >= o.at - horizon);
    if (before.length) hits.push({ outcomeId: o.id, leadHours: Math.round((o.at - Math.min(...before.map((e) => e.start))) / HOUR) });
    else misses.push(o.id);
  }
  const falseAlarms = eps.filter((e) => !outcomes.some((o) => o.at >= e.start && o.at <= e.start + horizon)).length;
  const evaluable = series.filter((p) => ['NORMAL', 'ELEVATED', 'TRIGGERED'].includes(p.state)).length;
  return { indicatorId, episodes: eps.length, hits, misses, falseAlarms, evaluableShare: series.length ? evaluable / series.length : 0 };
}

/** Pairwise co-activation: Jaccard overlap of the steps at which each indicator was active. */
export function coActivation(series: Record<string, StatePoint[]>, active: IndicatorState[] = ['TRIGGERED', 'ELEVATED']) {
  const sets = Object.fromEntries(
    Object.entries(series).map(([id, s]) => [id, new Set(s.filter((p) => active.includes(p.state)).map((p) => p.at))]),
  );
  const ids = Object.keys(sets).filter((id) => sets[id].size > 0);
  const pairs: { a: string; b: string; jaccard: number; overlapSteps: number }[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const A = sets[ids[i]];
      const B = sets[ids[j]];
      const inter = [...A].filter((x) => B.has(x)).length;
      if (!inter) continue;
      pairs.push({ a: ids[i], b: ids[j], jaccard: Math.round((inter / new Set([...A, ...B]).size) * 100) / 100, overlapSteps: inter });
    }
  }
  return pairs.sort((x, y) => y.jaccard - x.jaccard);
}

/** How much real history the backtest window actually contains. */
export function dataSufficiency(from: number, to: number, collectionStart: number | null) {
  const windowDays = (to - from) / (24 * HOUR);
  const coveredDays = collectionStart === null ? 0 : Math.max(0, (to - Math.max(from, collectionStart)) / (24 * HOUR));
  return {
    windowDays: Math.round(windowDays * 10) / 10,
    coveredDays: Math.round(coveredDays * 10) / 10,
    adequate: coveredDays >= 90,
  };
}
