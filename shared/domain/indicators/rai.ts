import { WATCH_REGIONS } from '../regions.ts';
import type {
  IndicatorDefinition,
  IndicatorEvaluation,
  IndicatorState,
  RaiBand,
  RegionScore,
  RegionScoreContribution,
  ScoreHistoryPoint,
} from './types.ts';

/**
 * Regional Activity Index (RAI) v0.
 *
 * A 0–100 measure of UNUSUAL ACTIVITY IN THE MONITORED SOURCES for a region.
 * It is not a probability of war, attack or any other event.
 *
 *   max      = Σ weight × severityMultiplier   over evaluable indicators
 *   points_i = weight_i × severityMultiplier_i × stateFactor_i
 *   RAI      = round(100 × Σ capped points / max)
 *
 * Safeguards:
 *  - Only NORMAL / ELEVATED / TRIGGERED indicators are "evaluable"; UNKNOWN or
 *    DATA_UNAVAILABLE never count as calm — they lower COVERAGE instead, which
 *    is always shown next to the score. Zero coverage → no score ("N/E").
 *  - Per-source cap: indicators sharing a primary source may contribute at most
 *    SOURCE_CAP_SHARE of max, so one source cannot drive a region to the top band.
 *  - Experimental indicators never contribute.
 */
export const SEVERITY_MULTIPLIER = { low: 1, medium: 1.5, high: 2 } as const;
export const STATE_FACTOR: Partial<Record<IndicatorState, number>> = { TRIGGERED: 1, ELEVATED: 0.4, NORMAL: 0 };
export const SOURCE_CAP_SHARE = 0.6;
const EVALUABLE = new Set<IndicatorState>(['NORMAL', 'ELEVATED', 'TRIGGERED']);

export const RAI_BANDS: { min: number; band: RaiBand; label: string }[] = [
  { min: 80, band: 'EXCEPTIONAL', label: 'Exceptional activity' },
  { min: 60, band: 'SIGNIFICANT', label: 'Significant activity' },
  { min: 40, band: 'ELEVATED', label: 'Elevated activity' },
  { min: 20, band: 'INCREASED', label: 'Increased activity' },
  { min: 0, band: 'BASELINE', label: 'Baseline' },
];

export function bandFor(score: number): RaiBand {
  return RAI_BANDS.find((b) => score >= b.min)!.band;
}

export function computeRegionScore(
  regionId: string,
  defs: IndicatorDefinition[],
  evaluations: IndicatorEvaluation[],
  now: number,
): RegionScore {
  const relevant = defs.filter((d) => d.regionId === regionId && d.enabled && !d.experimental);
  const byId = new Map(evaluations.map((e) => [e.indicatorId, e]));
  const evaluable = relevant.filter((d) => EVALUABLE.has(byId.get(d.id)?.state ?? 'UNKNOWN'));
  const evaluatedAt = new Date(now).toISOString();
  const coverage = relevant.length ? evaluable.length / relevant.length : 0;

  if (evaluable.length === 0) {
    return { regionId, score: null, band: null, coverage, activeIndicators: 0, contributions: [], evaluatedAt };
  }

  const max = evaluable.reduce((s, d) => s + d.weight * SEVERITY_MULTIPLIER[d.severity], 0);
  const contributions: RegionScoreContribution[] = evaluable.map((d) => {
    const state = byId.get(d.id)!.state;
    const raw = d.weight * SEVERITY_MULTIPLIER[d.severity] * (STATE_FACTOR[state] ?? 0);
    return { indicatorId: d.id, name: d.name, state, weight: d.weight, severity: d.severity, raw, applied: raw, capped: false };
  });

  // Per-source cap.
  const cap = SOURCE_CAP_SHARE * max;
  const groups = new Map<string, RegionScoreContribution[]>();
  evaluable.forEach((d, i) => {
    const key = d.requiredSourceIds[0] ?? d.id;
    groups.set(key, [...(groups.get(key) ?? []), contributions[i]]);
  });
  for (const group of groups.values()) {
    const sum = group.reduce((s, c) => s + c.raw, 0);
    if (sum > cap) {
      const scale = cap / sum;
      for (const c of group) {
        c.applied = c.raw * scale;
        c.capped = c.raw > 0;
      }
    }
  }

  const score = max > 0 ? Math.round((100 * contributions.reduce((s, c) => s + c.applied, 0)) / max) : 0;
  return {
    regionId,
    score,
    band: bandFor(score),
    coverage,
    activeIndicators: contributions.filter((c) => c.state === 'TRIGGERED' || c.state === 'ELEVATED').length,
    contributions,
    evaluatedAt,
  };
}

export function computeAllRegionScores(defs: IndicatorDefinition[], evaluations: IndicatorEvaluation[], now: number): RegionScore[] {
  return WATCH_REGIONS.map((r) => computeRegionScore(r.id, defs, evaluations, now));
}

/** Keeps ~3 days of hourly points. */
export const SCORE_HISTORY_MAX_POINTS = 80;

export function appendScoreHistory(history: ScoreHistoryPoint[], scores: RegionScore[], now: number): ScoreHistoryPoint[] {
  const point: ScoreHistoryPoint = {
    at: new Date(now).toISOString(),
    scores: Object.fromEntries(scores.map((s) => [s.regionId, s.score])),
  };
  return [...history, point].slice(-SCORE_HISTORY_MAX_POINTS);
}

/**
 * Change versus ~24 h ago, using the history point closest to now − 24 h
 * within ±4 h. Null when no comparable point exists (never invented).
 */
export function scoreDelta24h(history: ScoreHistoryPoint[], regionId: string, current: number | null, now: number): number | null {
  if (current === null) return null;
  const target = now - 24 * 3_600_000;
  let best: ScoreHistoryPoint | null = null;
  for (const p of history) {
    const d = Math.abs(Date.parse(p.at) - target);
    if (d <= 4 * 3_600_000 && (!best || d < Math.abs(Date.parse(best.at) - target))) best = p;
  }
  const prev = best?.scores[regionId];
  return typeof prev === 'number' ? current - prev : null;
}
