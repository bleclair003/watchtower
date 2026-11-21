import type { IntelligenceEvent } from '../../shared/domain/types.ts';

/**
 * Day buckets: a derived cache of recent events, one Firestore document per collection day
 * (UTC, by `collectedAt`), split into parts when a day is large.
 *
 * Why: indicators and baselines need ~31 days of events every run. Reading them one document
 * at a time cost up to 2,000 reads per run (capped, so long windows were silently truncated),
 * which at hourly collection would exceed the Spark free tier (50,000 reads/day) within weeks.
 * Reading ~46 bucket documents instead costs ~46 reads per run, with no cap.
 *
 * The `events` collection remains the source of truth and the full archive; buckets are
 * written in the same batch as the events they contain, and can be rebuilt from `events`.
 */

/** Days of buckets loaded per run: the snapshot window (31 d) plus the adapters' 45-day steady lookback margin. */
export const BUCKET_WINDOW_DAYS = 46;
/** Firestore documents are capped at 1 MiB; parts stay well below. */
export const BUCKET_PART_MAX_BYTES = 700_000;
export const BUCKET_SCHEMA_VERSION = 1;

export interface DayBucketDoc {
  date: string; // YYYY-MM-DD (UTC)
  part: number;
  parts: number;
  version: number;
  events: IntelligenceEvent[];
  updatedAt: string;
}

export const dayOf = (iso: string) => iso.slice(0, 10);
export const bucketDocId = (date: string, part: number) => (part === 0 ? date : `${date}~${part}`);

export function windowStartDate(now: number, days = BUCKET_WINDOW_DAYS): string {
  return new Date(now - days * 86_400_000).toISOString().slice(0, 10);
}

/** Splits one day's events into parts that each fit under the byte limit (order preserved). */
export function splitParts(events: IntelligenceEvent[], maxBytes = BUCKET_PART_MAX_BYTES): IntelligenceEvent[][] {
  const parts: IntelligenceEvent[][] = [[]];
  let size = 0;
  for (const e of events) {
    const n = Buffer.byteLength(JSON.stringify(e)) + 1;
    if (n > maxBytes) throw new Error(`event ${e.id} alone exceeds the bucket part limit`);
    if (size + n > maxBytes && parts[parts.length - 1].length) {
      parts.push([]);
      size = 0;
    }
    parts[parts.length - 1].push(e);
    size += n;
  }
  return parts;
}

/** In-memory view of the loaded window: events by id, grouped by day. */
export class BucketCache {
  private readonly byDay = new Map<string, Map<string, IntelligenceEvent>>();
  private readonly dayOfId = new Map<string, string>();
  /** Number of parts each day currently has in Firestore (to delete leftovers if it shrinks). */
  readonly storedParts = new Map<string, number>();

  readonly windowStart: string;

  constructor(windowStart: string) {
    this.windowStart = windowStart;
  }

  has(id: string) {
    return this.dayOfId.has(id);
  }

  covers(iso: string) {
    return dayOf(iso) >= this.windowStart;
  }

  /** Adds or replaces events; returns the days that changed. */
  upsert(events: IntelligenceEvent[]): Set<string> {
    const changed = new Set<string>();
    for (const e of events) {
      const day = dayOf(e.collectedAt);
      const prevDay = this.dayOfId.get(e.id);
      if (prevDay && prevDay !== day) {
        this.byDay.get(prevDay)?.delete(e.id);
        changed.add(prevDay);
      }
      if (!this.byDay.has(day)) this.byDay.set(day, new Map());
      this.byDay.get(day)!.set(e.id, e);
      this.dayOfId.set(e.id, day);
      changed.add(day);
    }
    return changed;
  }

  eventsOn(day: string): IntelligenceEvent[] {
    return [...(this.byDay.get(day)?.values() ?? [])].sort((a, b) => a.collectedAt.localeCompare(b.collectedAt) || a.id.localeCompare(b.id));
  }

  /** Events collected at or after `sinceIso`, newest collected first (same contract as the old query, without a cap). */
  collectedSince(sinceIso: string): IntelligenceEvent[] {
    const out: IntelligenceEvent[] = [];
    for (const m of this.byDay.values()) for (const e of m.values()) if (e.collectedAt >= sinceIso) out.push(e);
    return out.sort((a, b) => b.collectedAt.localeCompare(a.collectedAt) || a.id.localeCompare(b.id));
  }

  /** Documents to write for the given days: every part, plus how many stale parts to delete. */
  docsFor(days: Iterable<string>, nowIso: string): { set: { id: string; doc: DayBucketDoc }[]; remove: string[] } {
    const set: { id: string; doc: DayBucketDoc }[] = [];
    const remove: string[] = [];
    for (const day of days) {
      const parts = splitParts(this.eventsOn(day));
      parts.forEach((events, part) =>
        set.push({ id: bucketDocId(day, part), doc: { date: day, part, parts: parts.length, version: BUCKET_SCHEMA_VERSION, events, updatedAt: nowIso } }),
      );
      const before = this.storedParts.get(day) ?? 0;
      for (let p = parts.length; p < before; p++) remove.push(bucketDocId(day, p));
      this.storedParts.set(day, parts.length);
    }
    return { set, remove };
  }

  get size() {
    return this.dayOfId.size;
  }
}
