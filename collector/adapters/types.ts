import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import type { FetchResult, Validators } from '../lib/http.ts';

/**
 * Contract every source adapter implements.
 *
 * An adapter turns one source's raw response into normalized, validated
 * IntelligenceEvents. It does NOT write to the database, compute health or
 * de-duplicate against stored data — the pipeline does that uniformly.
 */
export interface AdapterContext<S> {
  /** Current time (ms). Injected so tests are deterministic. */
  now: number;
  /** Persisted per-source state from the previous run, or null on first run. */
  state: S | null;
  /** Polite fetch bound to the collector's HTTP policy. */
  fetch: (url: string, validators?: Validators) => Promise<FetchResult>;
}

export interface AdapterResult<S> {
  /** Candidate events (pipeline validates and de-duplicates them). */
  events: IntelligenceEvent[];
  /** Items the adapter saw but refused, with a reason (counted as rejected). */
  rejected: { ref: string; reason: string }[];
  /** Number of raw items parsed from the source. */
  itemsSeen: number;
  /** True when the source answered 304 Not Modified. */
  notModified: boolean;
  /** State to persist for the next run. */
  state: S;
}

export interface SourceAdapter<S = unknown> {
  /** Must match an id in shared/domain/sources.ts. */
  readonly sourceId: string;
  collect(ctx: AdapterContext<S>): Promise<AdapterResult<S>>;
}

/** On a source's first run, only items newer than this are imported as events. */
export const FIRST_RUN_LOOKBACK_DAYS = 30;
/** On later runs, items older than this are ignored (protects against feed resets). */
export const STEADY_LOOKBACK_DAYS = 45;
