import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import type { FetchResult, Validators } from '../lib/http.ts';

/** Per-request overrides for large or slow official files (defaults: 8 MB, 30 s). */
export interface FetchLimits {
  maxBytes?: number;
  timeoutMs?: number;
}

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
  fetch: (url: string, validators?: Validators, headers?: Record<string, string>, limits?: FetchLimits) => Promise<FetchResult>;
  /** Read-only access to another source's saved state (e.g. the sanctions lists' vessel identifiers). */
  peerState?: <T>(sourceId: string) => Promise<T | null>;
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
  /** Optional note for the run log (public: no secrets), e.g. a tolerated failure. */
  note?: string;
}

export interface SourceAdapter<S = unknown> {
  /** Must match an id in shared/domain/sources.ts. */
  readonly sourceId: string;
  /** Environment variables (API keys) the adapter needs. Without them the source is NOT CONFIGURED, not failed. */
  readonly requiredEnv?: string[];
  /**
   * The source edits items after publication (e.g. Cloudflare adds an end time or revises a
   * cause). Events must then carry `metadata.revisionKey`; a stored event whose key differs is
   * rewritten, keeping its original `collectedAt` and gaining `metadata.revisedAt`.
   */
  readonly revisable?: boolean;
  collect(ctx: AdapterContext<S>): Promise<AdapterResult<S>>;
}

/** On a source's first run, only items newer than this are imported as events. */
export const FIRST_RUN_LOOKBACK_DAYS = 30;
/** On later runs, items older than this are ignored (protects against feed resets). */
export const STEADY_LOOKBACK_DAYS = 45;
