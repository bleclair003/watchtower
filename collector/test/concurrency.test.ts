// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mapLimit, runCollection } from '../pipeline.ts';
import { MemoryStore } from '../store/memory.ts';

describe('concurrent source fetching', () => {
  it('mapLimit keeps input order and never runs more than the limit at once', async () => {
    let active = 0;
    let peak = 0;
    const out = await mapLimit([30, 5, 20, 1, 10, 15], 3, async (ms) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, ms));
      active--;
      return ms * 2;
    });
    expect(out).toEqual([60, 10, 40, 2, 20, 30]);
    expect(peak).toBe(3);
  });

  it('a failing source does not stop the others, and reports stay in source order', async () => {
    const hex = (sourceId: string) => [...sourceId].map((c) => c.charCodeAt(0).toString(16)).join('').padEnd(32, '0').slice(0, 32);
    const ev = (sourceId: string) => ({
      id: hex(sourceId), contentHash: hex(sourceId), dataOrigin: 'live' as const, sourceId, sourceName: sourceId, sourceClass: 'official' as const,
      sourceUrl: 'https://example.org/', title: `Item from ${sourceId}`, category: 'official' as const, regionIds: [], countryCodes: [],
      publishedAt: '2026-11-21T10:00:00.000Z', occurredAt: null, collectedAt: '2026-11-21T10:00:00.000Z', credibility: 'official' as const,
      verificationStatus: 'unreviewed' as const, locationPrecision: 'none' as const,
    });
    const slow = { sourceId: 'un-news', collect: async () => { await new Promise((r) => setTimeout(r, 30)); return { events: [ev('un-news')], rejected: [], itemsSeen: 1, notModified: false, state: {} }; } };
    const broken = { sourceId: 'bbc-world', collect: async () => { throw new Error('HTTP 503'); } };
    const fast = { sourceId: 'iaea-news', collect: async () => ({ events: [ev('iaea-news')], rejected: [], itemsSeen: 1, notModified: false, state: {} }) };
    const store = new MemoryStore();
    const { reports } = await runCollection([slow, broken, fast] as never, store, { trigger: 'manual', now: () => Date.parse('2026-11-21T11:00:00Z') });
    expect(reports.map((r) => [r.sourceId, r.ok, r.imported])).toEqual([['un-news', true, 1], ['bbc-world', false, 0], ['iaea-news', true, 1]]);
    expect(reports[1].error).toMatch(/HTTP 503/);
  });
});
