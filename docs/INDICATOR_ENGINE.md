# Indicator & Warning Engine (IWE) — Design

**Status: design only. Not implemented (Phase 3).** The UI currently shows RAI `N/E` (not evaluated) and indicators as offline.

## Principles

1. Deterministic first. Indicators are declarative conditions evaluated in the collector; no AI and no user-supplied JavaScript.
2. Absence of data is not evidence of calm. Missing or stale required sources yield `UNKNOWN` / `DATA_UNAVAILABLE`, never `NORMAL`.
3. Every state change records the event IDs that caused it.
4. Experimental signals (`experimental: true`) never feed RAI without a documented evaluation policy.

## Condition language (draft)

```jsonc
{
  "id": "redsea-maritime-official-burst",
  "window": { "hours": 24 },
  "match": {
    "all": [
      { "field": "regionIds", "op": "contains", "value": "red-sea" },
      { "field": "category", "op": "eq", "value": "maritime" },
      { "field": "credibility", "op": "eq", "value": "official" }
    ]
  },
  "trigger": { "countAtLeast": 2, "distinctSourcesAtLeast": 1 },
  "elevated": { "countAtLeast": 1 },
  "baseline": { "method": "rolling-median", "days": 28, "ratioAtLeast": 2.0 }
}
```

Fields and operators are drawn from a fixed allowlist and validated with a schema on write.

## Regional Activity Index (RAI) v0 — proposal

`RAI = min(100, Σ contribution_i) × coverageFactor`, where each triggered or elevated indicator contributes `weight × severityMultiplier × recencyDecay`. Safeguards:

- **Per-source cap:** a single source's evidence contributes at most 30% of a region's score.
- **Dedup:** events sharing a `contentHash` or a clustered story id count once.
- **Corroboration** requires different organizations, not syndicated copies.
- **Coverage factor:** the share of the region's required sources that are healthy. Shown alongside the score (e.g. `RAI 42 · coverage 60%`), so a quiet region with dead feeds can't look calm.

Bands (Baseline / Increased / Elevated / Significant / Exceptional) are display conventions, not validated thresholds. RAI is never presented as a probability.
