import { describe, expect, it } from 'vitest';
import { SOURCE_REGISTRY } from '@shared/domain/sources';
import { isCollectionOverdue, mergeSourceStatus } from './sourceHealth';

const NOW = Date.parse('2026-11-20T12:00:00Z');

describe('mergeSourceStatus', () => {
  it('returns one row per registered source; unreported sources are NOT_CONFIGURED', () => {
    const rows = mergeSourceStatus([], NOW);
    expect(rows).toHaveLength(SOURCE_REGISTRY.length);
    expect(rows.every((r) => r.health === 'NOT_CONFIGURED')).toBe(true);
  });

  it('re-evaluates health at view time so a silent collector shows STALE', () => {
    const reported = [{
      sourceId: 'state-travel-advisories', health: 'ONLINE' as const,
      lastAttemptAt: '2026-11-20T06:00:00Z', lastSuccessAt: '2026-11-20T06:00:00Z', lastNewItemAt: null,
      consecutiveFailures: 0, parseErrors: 0, lastError: null,
    }];
    expect(mergeSourceStatus(reported, Date.parse('2026-11-20T07:00:00Z')).find((r) => r.sourceId === 'state-travel-advisories')!.health).toBe('ONLINE');
    expect(mergeSourceStatus(reported, NOW).find((r) => r.sourceId === 'state-travel-advisories')!.health).toBe('STALE');
  });
});

describe('isCollectionOverdue', () => {
  it('flags snapshots older than 3 hours, never a missing one', () => {
    expect(isCollectionOverdue(null, NOW)).toBe(false);
    expect(isCollectionOverdue('2026-11-20T10:00:00Z', NOW)).toBe(false);
    expect(isCollectionOverdue('2026-11-20T08:00:00Z', NOW)).toBe(true);
  });
});
