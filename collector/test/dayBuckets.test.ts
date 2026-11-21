// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { BucketCache, bucketDocId, splitParts, windowStartDate } from '../store/dayBuckets.ts';

const ev = (id: string, collectedAt: string, extra = ''): IntelligenceEvent => ({
  id, contentHash: id, dataOrigin: 'live', sourceId: 's', sourceName: 'S', sourceClass: 'official', sourceUrl: 'https://example.org/',
  title: `t ${id}${extra}`, category: 'official', regionIds: [], countryCodes: [], publishedAt: null, occurredAt: null,
  collectedAt, credibility: 'official', verificationStatus: 'unreviewed', locationPrecision: 'none',
});

describe('day buckets', () => {
  it('window start is 46 days back, by UTC date', () => {
    expect(windowStartDate(Date.parse('2026-11-21T06:00:00Z'))).toBe('2026-10-06');
  });

  it('groups by collection day, answers collectedSince newest-first, and knows its ids', () => {
    const c = new BucketCache('2026-10-06');
    const days = c.upsert([ev('a', '2026-11-20T01:00:00.000Z'), ev('b', '2026-11-21T02:00:00.000Z'), ev('c', '2026-11-21T03:00:00.000Z')]);
    expect([...days].sort()).toEqual(['2026-11-20', '2026-11-21']);
    expect(c.collectedSince('2026-11-20T12:00:00.000Z').map((e) => e.id)).toEqual(['c', 'b']);
    expect(c.has('a')).toBe(true);
    expect(c.has('z')).toBe(false);
    expect(c.covers('2026-10-05T23:59:59Z')).toBe(false);
  });

  it('replacing an event (a revision) keeps one copy', () => {
    const c = new BucketCache('2026-10-06');
    c.upsert([ev('a', '2026-11-20T01:00:00.000Z')]);
    c.upsert([ev('a', '2026-11-20T01:00:00.000Z', ' revised')]);
    expect(c.eventsOn('2026-11-20').map((e) => e.title)).toEqual(['t a revised']);
    expect(c.size).toBe(1);
  });

  it('splits large days into parts under the byte limit and removes parts no longer needed', () => {
    const many = Array.from({ length: 50 }, (_, i) => ev(`e${i}`, '2026-11-21T00:00:00.000Z', 'x'.repeat(300)));
    const parts = splitParts(many, 4_000);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.flat()).toHaveLength(50);
    for (const p of parts) expect(Buffer.byteLength(JSON.stringify(p))).toBeLessThan(4_100);

    const c = new BucketCache('2026-10-06');
    c.upsert(many);
    c.storedParts.set('2026-11-21', 9); // pretend the day once had 9 parts
    const { set, remove } = c.docsFor(['2026-11-21'], '2026-11-21T06:00:00.000Z');
    expect(set[0].id).toBe('2026-11-21');
    expect(set.every((s) => s.doc.parts === set.length)).toBe(true);
    expect(remove).toEqual(Array.from({ length: 9 - set.length }, (_, k) => bucketDocId('2026-11-21', set.length + k)));
  });
});
