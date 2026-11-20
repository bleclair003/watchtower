import type { SourceStatus } from '@shared/domain/types';
import { SOURCE_REGISTRY } from '@shared/domain/sources';
import { computeHealth } from '@shared/domain/health';

/**
 * One status row per registered source. Health is RE-COMPUTED at view time,
 * so a source the collector last saw as ONLINE turns STALE in the UI if the
 * collector itself stops running.
 */
export function mergeSourceStatus(reported: SourceStatus[], now: number): SourceStatus[] {
  return SOURCE_REGISTRY.map((def) => {
    const s = reported.find((r) => r.sourceId === def.id);
    if (!s) {
      return {
        sourceId: def.id, health: 'NOT_CONFIGURED', lastAttemptAt: null, lastSuccessAt: null,
        lastNewItemAt: null, consecutiveFailures: 0, parseErrors: 0, lastError: null,
      };
    }
    return { ...s, health: computeHealth(s, def.pollIntervalMinutes, now) };
  });
}

/** The collector is considered overdue if its snapshot is older than this. */
export const COLLECTION_OVERDUE_HOURS = 3;

export function isCollectionOverdue(generatedAt: string | null, now: number): boolean {
  return generatedAt !== null && now - Date.parse(generatedAt) > COLLECTION_OVERDUE_HOURS * 3_600_000;
}
