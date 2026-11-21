# Data Model

Canonical TypeScript definitions: [`shared/domain/types.ts`](../shared/domain/types.ts).

## IntelligenceEvent — extensions to the PDD schema

| Field | Change | Why |
|---|---|---|
| `dataOrigin: 'live' \| 'imported' \| 'demo'` | **Added** | Lets code and tests guarantee simulated or retrospective records are never shown as live collection. |
| `sourceClass: 'official' \| 'media' \| 'aggregator' \| 'scientific'` | **Added** | Drives the "official vs media" filter without a join to `sources`. |
| `category`, `credibility` | Now enums (`EVENT_CATEGORIES`, `CREDIBILITY_LEVELS`) | Prevents free-text drift. |
| `locationPrecision` | Now **required** enum | `country` / `region` / `none` **must not** carry lat/lon (enforced by `isPlottable`). |
| `verificationStatus` | Enum: `unreviewed` / `confirmed` / `disputed` / `retracted` | |
| `indicatorIds?` | Added | Back-reference for feed display (Phase 3). |

Time fields:
- `publishedAt`: when the source published the item (`null` if the source gives no date).
- `occurredAt`: when the underlying event reportedly happened (`null` = not stated).
- `collectedAt`: when WATCHTOWER first saw it. **Replay (Phase 6) gates on this field** to avoid hindsight bias.

## Firestore collections

| Collection | Doc ID | Written by | Read by | Notes |
|---|---|---|---|---|
| `events` | `contentHash` (32 hex) | collector | owner | Idempotent: same item → same ID; written with `create()` |
| `sources` | source id | deploy script | owner | Mirrors `SOURCE_REGISTRY` |
| `sourceStatus` | source id | collector | owner | Health + counters |
| `sourceState` | source id | collector | **nobody** | Adapter memory: ETag/Last-Modified, advisory level baseline |
| `collectionRuns` | run id | collector | owner | Diagnostics history; retain 90 days |
| `snapshots` | `dashboard` | collector | owner | `DashboardSnapshot` schema v2 (shared/domain/snapshot.ts): ≤ 400 newest events, source status, last run, indicator evaluations, region scores, ~3 days of RAI history; trimmed to ≤ 900 KB |
| `regions` | region id | deploy script | owner | Mirrors `WATCH_REGIONS` |
| `eventDays` | `YYYY-MM-DD` (parts `YYYY-MM-DD~1` …) | collector | nobody (default deny) | Cache of each collection day's events for cheap indicator evaluation; rebuilt from `events` when `collectorState/eventDays` is missing (v0.9.4) |
| `raiHistory` | run timestamp | collector | owner | One `ScoreHistoryPoint` per run: long-term RAI trend and SITREP comparisons (Phase 6) |
| `indicatorHistory` | `<time>_<indicatorId>` | collector | owner | Append-only log of indicator state transitions (Phase 3) |
| `indicators` | indicator id | owner (UI) | collector, owner | Phase 4: operator-edited definitions (v1 catalog lives in code) |
| `alertRules` | random 20-char id | owner (UI, shape-validated) | collector, owner | `AlertRule` (shared/domain/alerts/types.ts) |
| `alerts` | `hash(ruleId, dedupeKey)` | collector | owner | `AlertRecord`; owner may change only acknowledged/dismissed fields |
| `collectorState` | `alerting` | collector | **nobody** | Per-rule last-notified times (cooldowns) |
| `incidents` | random 20-char id | owner | owner | `Incident` (shared/domain/incidents/types.ts); updates must bump `version` by 1 |
| `briefings` | auto | owner | owner | Phase 6 |
| `userSettings` | uid | owner | owner | |

## Planned indexes (driven by actual queries)

| Query | Index |
|---|---|
| Archive: events by region, newest first | `events(regionIds ARRAY_CONTAINS, publishedAt DESC)` |
| Archive: events by source, newest first | `events(sourceId ASC, publishedAt DESC)` |
| Archive: events by category in range | `events(category ASC, publishedAt DESC)` |
| Alerts: unacknowledged by severity | `alerts(acknowledged ASC, createdAt DESC)` |

The dashboard itself reads `snapshots/dashboard`, not `events`, so it needs no composite index.

## Retention

At ~2 KB per event, the 1 GiB Spark storage holds roughly 400k events. Planned policy: keep events 24 months, collectionRuns 90 days, and prune in the collector.
