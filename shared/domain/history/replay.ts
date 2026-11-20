import type { IntelligenceEvent, SourceStatus } from '../types.ts';
import { evaluateAll } from '../indicators/evaluate.ts';
import { computeAllRegionScores } from '../indicators/rai.ts';
import type { IndicatorDefinition, IndicatorEvaluation, RegionScore } from '../indicators/types.ts';

/**
 * Historical Operations Replay (PDD §11) — hindsight-safe reconstruction.
 *
 * At replay time T, a record is AVAILABLE only if WATCHTOWER had actually
 * collected it by T (collectedAt ≤ T). Publication time alone is not enough:
 * an item published in October but first collected in November was not known
 * to WATCHTOWER in October, and must not appear there.
 */
export function availableAt(events: IntelligenceEvent[], t: number): IntelligenceEvent[] {
  return events.filter((e) => Date.parse(e.collectedAt) <= t);
}

/** Collected more than 24 h after publication (typically a first-run backfill). */
export function isLateCollection(e: IntelligenceEvent): boolean {
  return e.publishedAt !== null && Date.parse(e.collectedAt) - Date.parse(e.publishedAt) > 24 * 3_600_000;
}

/**
 * Source health at time T, reconstructed conservatively: a source counts as
 * collected (and healthy) at T only if its first successful collection was at
 * or before T. Outages are NOT reconstructed in this version — documented as a
 * replay limitation, so a historical outage would be replayed as healthy.
 */
export function statusesAt(current: SourceStatus[], t: number): SourceStatus[] {
  const iso = new Date(t).toISOString();
  return current
    .filter((s) => {
      const first = s.firstSuccessAt ?? s.lastSuccessAt;
      return first !== null && first !== undefined && Date.parse(first) <= t;
    })
    .map((s) => ({ ...s, health: 'ONLINE', lastAttemptAt: iso, lastSuccessAt: iso, consecutiveFailures: 0, parseErrors: 0, lastError: null }));
}

export interface ReplayFrame {
  at: string;
  events: IntelligenceEvent[];
  evaluations: IndicatorEvaluation[];
  scores: RegionScore[];
  /** True when WATCHTOWER had not collected any source yet at T. */
  beforeCollection: boolean;
}

/** Re-runs the deterministic indicator engine as it would have run at T. */
export function replayAt(catalog: IndicatorDefinition[], events: IntelligenceEvent[], current: SourceStatus[], t: number): ReplayFrame {
  const evs = availableAt(events, t);
  const statuses = statusesAt(current, t);
  const { evaluations } = evaluateAll(catalog, evs, statuses, t);
  return {
    at: new Date(t).toISOString(),
    events: evs,
    evaluations,
    scores: computeAllRegionScores(catalog, evaluations, t),
    beforeCollection: statuses.length === 0,
  };
}

/** Earliest moment WATCHTOWER collected anything (null if never). */
export function collectionStart(current: SourceStatus[]): number | null {
  const firsts = current.map((s) => s.firstSuccessAt ?? s.lastSuccessAt).filter((x): x is string => !!x).map(Date.parse);
  return firsts.length ? Math.min(...firsts) : null;
}
