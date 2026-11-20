# WATCHTOWER — Architecture

Status: Phases 0–2 implemented (Phase 2 verified against local emulators). This document also records the **Task A architecture review** of PDD v1.0.

## 1. System overview

```text
 PUBLIC SOURCES (RSS / Atom / JSON APIs)
            │  hourly, best-effort
            ▼
 ┌─────────────────────────────── GitHub Actions (Node 24 + TS) ─┐
 │  collector/                                                   │
 │   adapters/<source>.ts → normalize → validate → dedupe (hash) │
 │   → classify (region, category, credibility)                  │
 │   → write events + sourceStatus + collectionRuns              │
 │   → evaluate indicators (Phase 3) → alerts + Discord (Phase 4)│
 │   → rebuild dashboard snapshot doc                            │
 └───────────────────────────────┬───────────────────────────────┘
                                 │ Admin SDK (service account / WIF)
                                 ▼
                     Firebase Firestore (Spark)
                                 │ client SDK, owner-only rules
                                 ▼
 ┌──────────────── React SPA on Firebase Hosting (Spark) ────────┐
 │ IntelRepository ← DemoRepository (now) / FirestoreRepository  │
 │ DataContext · DashboardContext · SettingsContext              │
 │ GOC · Sources · Diagnostics · Settings · (Indicators, Alerts, │
 │ Dossiers, SITREP, Replay in later phases)                     │
 └───────────────────────────────────────────────────────────────┘
```

All privileged work (collection, indicator evaluation, alert dispatch) happens in GitHub Actions. The browser is a read-mostly client and holds no secrets.

## 2. Repository layout

```text
watchtower/
  shared/domain/        Pure TS domain model shared by app + collectors
    types.ts            IntelligenceEvent, SourceDefinition, Indicator*, …
    regions.ts          Watch regions + coarse bounding boxes
    sources.ts          Source registry with feasibility results
  src/
    config/             Presentation config (categories), Firebase web config
    data/               IntelRepository boundary + demo fixtures
    lib/                Pure logic: filters, geo projection, map style, commands, time, sanitize
    state/              React contexts (data, dashboard filters, settings)
    hooks/              useNow, useOnline
    components/
      layout/           AppShell, TopBar, CommandConsole
      map/              WorldMap (MapLibre), MapLegend
      goc/              RegionalWatchlist, IntelFeed, FeedItem, FeedFilters, SystemStatusPanel
      ui/               Panel, Tag/Lamp, CategoryGlyph
    pages/              Route-level screens
  collector/            Scheduled collection (Node 24 type-stripping, no build step)
    run.ts              CLI entry (exit 0 ok · 2 source failed · 1 fatal)
    pipeline.ts         fetch → validate → dedupe → write → status → run record → snapshot
    adapters/           One file per source, common SourceAdapter contract
    lib/                http (polite fetch), feed (RSS/Atom), dates, text sanitization, hash, fips, validate
    store/              CollectorStore: Firestore (Admin SDK) + in-memory (tests / --dry-run)
    test/               Unit tests + trimmed real-feed fixtures
  scripts/grant-owner.ts  Grants the `owner` custom claim (Admin SDK)
  rules-tests/          Firestore security-rules tests (emulator)
  .github/workflows/    collect.yml (hourly), ci.yml, grant-owner.yml
  docs/                 Project documentation
  firebase.json, firestore.rules, firestore.indexes.json
```

Rule of thumb: anything that must behave identically in the browser and in collectors lives in `shared/`. Anything that touches React lives in `src/`. `src/lib` holds pure, unit-tested functions; components stay thin.

## 3. Key design decisions

| Decision | Rationale |
|---|---|
| **Repository boundary** (`IntelRepository`) | UI never talks to Firestore directly. Demo fixtures and Firestore are interchangeable; tests use fixtures. |
| **`dataOrigin` field on every event** (`live` / `imported` / `demo`) | Makes "never present simulated data as real" enforceable in code and tests rather than by convention. |
| **`locationPrecision` + no-coordinates rule** | Country/region-level reports are aggregated onto watch areas, never pinned to an invented point. Enforced by `isPlottable()` and tested. |
| **Basemap style fetched and transformed client-side** | OpenFreeMap's dark style is recoloured to the phosphor palette by a pure, tested function; no custom tile hosting needed. |
| **MapLibre worker URL set explicitly** | MapLibre v6 resolves its worker relative to its own module, which breaks under Vite. `src/lib/maplibreSetup.ts` bundles the worker via `?worker&url`. |
| **Command console is a parser over real actions** | `parseCommand()` returns typed commands; unbuilt modules return explicit errors. No canned terminal output. |
| **Firebase SDK deferred to Phase 2** | Nothing reads Firestore yet; installing it now would add ~100 KB of unused code. Config scaffolding exists. |
| **Fonts self-hosted** (`@fontsource`) | No third-party font requests; OFL-licensed. |

## 3a. Phase 2 implementation notes

- **Auth model:** Google sign-in plus an `owner: true` **custom claim** set by the Admin SDK. Rules check the claim, so no UID or email appears in the repo. Spoofed claims (e.g. the string `"true"`) are rejected, and this is tested.
- **The browser is read-only** for collected data: only the Admin SDK can write events, snapshots, status and runs. Collector-internal `sourceState` (ETags, advisory baselines) is unreadable by clients.
- **The Firebase SDK is lazy-loaded** (dynamic import), so demo mode never downloads it.
- **Sign-in flow:** popup, falling back to redirect when the popup is blocked; redirect in emulator mode. The emulator build also offers an email/password test sign-in that does not exist in live builds.
- **Health is recomputed in the browser** from the snapshot's timestamps. If the collector stops, sources visibly decay to STALE, and the status strip shows OVERDUE after 3 h.
- **State Dept change detection:** the adapter stores the last-seen level per advisory and emits RAISED / LOWERED / reissued / NEW events. Tags are **FIPS 10-4, not ISO** (`RS` = Russia, `IS` = Israel) and are mapped by a tested table.
- **Planned optimization:** rebuild the snapshot incrementally (merge new events into the previous snapshot) instead of re-querying 400 events each run. This would cut collector reads by roughly 90%.

## 4. Task A — architecture review of PDD v1.0

### 4.1 Feasibility verdict

The stack (React/Vite SPA + Firebase Spark + GitHub Actions + public feeds) **can run at $0** for a single operator, with the changes below. Nothing in Phases 0–5 requires a paid service. The real constraints are Firestore's daily read quota, GitHub's best-effort cron, and source rate limits — not cost.

### 4.2 Technical dependencies

| Dependency | Free model | Risk |
|---|---|---|
| Firebase Firestore (Spark) | Daily quotas (reads/writes/deletes) and 1 GiB storage; hard-stops at quota, never bills | **Read quota** is the binding constraint for a dashboard that polls |
| Firebase Auth (Spark) | Free for email/Google sign-in at this scale | None significant |
| Firebase Hosting (Spark) | Storage + daily transfer allowance | Map tiles come from OpenFreeMap, not Hosting, so transfer is tiny |
| GitHub Actions | Unlimited minutes for public repos; monthly allowance for private | Cron is best-effort (delays of 5–30+ min are normal); **public-repo schedules auto-disable after 60 days without repository activity** |
| OpenFreeMap | Free, no key, no registration | Volunteer-run, no SLA. Map failure is surfaced in the UI; feed and watchlist keep working |
| MapLibre GL JS | BSD-3 | ~1 MB chunk (290 KB gzip), isolated in its own cached chunk |
| Source feeds | Public | Format changes, rate limits (GDELT), empty feeds (CENTCOM), blocks (FAA NOTAM search) |

Quota figures change; check the current Firebase and GitHub pricing pages when deploying (see DEPLOYMENT.md).

### 4.3 Recommended changes (adopted)

1. **Dashboard snapshot document.** The collector writes a precomputed `snapshots/dashboard` document (latest ~300 event summaries, source health, region counts, indicator states). Initial dashboard load then costs **1–3 reads instead of ~500**, which keeps a frequently opened dashboard well inside the daily read quota. The full `events` collection remains the source of truth for archive search and dossiers (paginated, bounded queries only).
2. **Indicators and alerts evaluate in the collector, not the browser.** Alerts must fire while the browser is closed, and evaluation needs privileged writes. The browser only edits rule *configuration* (`alertRules`), validated by security rules, and a declarative rule schema replaces any user-supplied code.
3. **Keyless auth for Actions → Firestore where practical.** Prefer Google Workload Identity Federation (no long-lived key in GitHub). A service-account JSON stored as an encrypted Actions secret is an acceptable Phase 2 starting point.
4. **Keep-alive for scheduled workflows.** If the repo is public, add a monthly job that records a heartbeat commit (or simply rely on regular development commits) so GitHub doesn't silently disable the schedule. Diagnostics will show "last scheduled run" and flag staleness either way.
5. **Conditional fetching.** Store `ETag` / `Last-Modified` per source and send `If-None-Match` / `If-Modified-Since`; the State Dept feed alone is ~550 KB.
6. **Content hashing for idempotency.** `contentHash = sha256(sourceId + canonical URL + normalized title)`; the event document ID *is* the hash, so re-ingestion is a no-op write that Firestore rejects cheaply via `create()` semantics.
7. **Region assignment from structured data first.** State Dept items carry ISO country tags; map country → watch region via `WatchRegion.countryCodes`. Keyword/gazetteer matching (for war.gov, UN News) is a second, lower-confidence pass and records its method in `metadata.regionMethod`.

### 4.4 Considered but not adopted

- **Serving the snapshot as a static JSON file from Hosting** (commit-and-deploy from Actions). Even cheaper on reads, but it makes the data public and couples deploys to collection. Revisit if Firestore reads become a problem.
- **Cloud Functions / scheduled functions.** Requires the Blaze (billing-enabled) plan. Rejected by the cost constraint.
- **Browser push notifications after close.** Needs a push service plus a server to send. FCM is free but sending requires a server credential, which only Actions could hold. Deferred to after Phase 4; Discord covers out-of-app alerts.

### 4.5 Architectural risks

| Risk | Mitigation |
|---|---|
| Source format drift breaks an adapter silently | Per-source schema validation, parse-error counters, `DEGRADED` health, Diagnostics page |
| A single noisy source dominates RAI | Per-source contribution cap and de-duplication in the RAI design (INDICATOR_ENGINE.md) |
| Media echo of one report counted as corroboration | Corroboration requires *independent origin* (different organizations, not syndicated copies); GDELT is volume context only |
| Missing data read as "calm" | `UNKNOWN` / `DATA_UNAVAILABLE` indicator states; RAI shows coverage % alongside the score |
| GitHub cron delays | Never claim real-time; show actual last-run times; idempotent catch-up on next run |
| OpenFreeMap outage | Explicit map failure banner; non-map panels unaffected |
