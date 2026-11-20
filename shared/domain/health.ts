import type { SourceHealth, SourceStatus } from './types.ts';

/**
 * Source health rules — shared so the collector (when writing) and the browser
 * (when displaying an ageing snapshot) reach the same verdict.
 *
 *  NOT_CONFIGURED  never attempted
 *  OFFLINE         ≥ 3 consecutive failed attempts
 *  DEGRADED        1–2 consecutive failures, or parse errors on the last run
 *  STALE           last success older than 3 × the polling interval
 *  ONLINE          otherwise
 *
 * A successful fetch that returned no new items is ONLINE: quiet ≠ broken.
 */
export const OFFLINE_AFTER_FAILURES = 3;
export const STALE_AFTER_INTERVALS = 3;

export function computeHealth(
  status: Pick<SourceStatus, 'lastAttemptAt' | 'lastSuccessAt' | 'consecutiveFailures' | 'parseErrors'>,
  pollIntervalMinutes: number | null,
  now: number,
): SourceHealth {
  if (!status.lastAttemptAt) return 'NOT_CONFIGURED';
  if (status.consecutiveFailures >= OFFLINE_AFTER_FAILURES) return 'OFFLINE';
  if (status.consecutiveFailures > 0 || status.parseErrors > 0) return 'DEGRADED';
  if (pollIntervalMinutes && status.lastSuccessAt) {
    const age = now - Date.parse(status.lastSuccessAt);
    if (age > STALE_AFTER_INTERVALS * pollIntervalMinutes * 60_000) return 'STALE';
  }
  return 'ONLINE';
}
