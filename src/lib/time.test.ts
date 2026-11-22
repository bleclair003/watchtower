import { describe, expect, it } from 'vitest';
import { eventTime, formatWhen } from './time';

const NOW = Date.parse('2026-11-22T18:00:00Z');

describe('formatWhen (v0.63.1)', () => {
  it('shows the clock time today, the day this year, the year before that', () => {
    expect(formatWhen('2026-11-22T14:32:10Z', NOW)).toBe('14:32Z');
    expect(formatWhen('2026-11-20T09:05:00Z', NOW)).toBe('20 NOV 09:05Z');
    expect(formatWhen('2025-03-01T09:05:00Z', NOW)).toBe('01 MAR 2025');
    expect(formatWhen(null, NOW)).toBe('—');
  });

  it('prefers when it happened, then published, then collected', () => {
    const c = '2026-11-22T17:00:00Z';
    expect(eventTime({ occurredAt: '2026-11-22T14:00:00Z', publishedAt: '2026-11-22T15:00:00Z', collectedAt: c })).toEqual({ iso: '2026-11-22T14:00:00Z', basis: 'happened' });
    expect(eventTime({ occurredAt: null, publishedAt: '2026-11-22T15:00:00Z', collectedAt: c }).basis).toBe('published');
    expect(eventTime({ collectedAt: c })).toEqual({ iso: c, basis: 'collected' });
  });
});
