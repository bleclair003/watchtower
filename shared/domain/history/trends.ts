import type { IntelligenceEvent } from '../types.ts';

export interface Bucket {
  start: number;
  count: number;
}

/**
 * Counts events per time bucket over [from, to), by publication time
 * (falling back to collection time). Empty buckets are kept as zero so a
 * quiet period is visible rather than collapsed.
 */
export function bucketCounts(events: IntelligenceEvent[], from: number, to: number, bucketHours: number, filter?: (e: IntelligenceEvent) => boolean): Bucket[] {
  const size = bucketHours * 3_600_000;
  const n = Math.max(1, Math.ceil((to - from) / size));
  const buckets: Bucket[] = Array.from({ length: n }, (_, i) => ({ start: from + i * size, count: 0 }));
  for (const e of events) {
    if (filter && !filter(e)) continue;
    const t = Date.parse(e.publishedAt ?? e.collectedAt);
    if (t < from || t >= to) continue;
    buckets[Math.floor((t - from) / size)].count++;
  }
  return buckets;
}
