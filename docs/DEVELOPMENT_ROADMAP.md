# Development Roadmap & Milestone Checklist

Legend: `[x]` done and tested · `[~]` partial / scaffolded · `[ ]` not started

## Phase 0 — Project foundation ✅

- [x] Project initialized (React 19 + TypeScript + Vite 8) in `watchtower/`
- [x] Tailwind CSS v4 with WATCHTOWER design tokens
- [x] Routing (React Router 7)
- [x] Base layout: AppShell, TopBar, module navigation
- [x] Shared domain model (`shared/domain`) for app + future collectors
- [x] Firebase config structure: `src/config/firebase.ts`, `firebase.json`, draft `firestore.rules`, `firestore.indexes.json`
- [x] `.env.example` template
- [x] README + docs set
- [x] Source feasibility matrix (live probes, 2026-11-20)
- [x] Vitest + React Testing Library configured
- [x] Git repository initialized
- [x] Firebase project created (operator)

## Phase 1 — Global Operations Center ✅ (demo data)

- [x] Operational dashboard layout (watchlist / map / feed / status strip)
- [x] Interactive world map (MapLibre + OpenFreeMap, recoloured)
- [x] Category symbols (9 distinct shapes, shared by map and legend)
- [x] Marker clustering, hover tooltips, click-to-select, cluster zoom
- [x] Area-level aggregation (no invented coordinates) with legend counts
- [x] Optional graticule and watch-area outlines
- [x] UTC + local clocks, connectivity, last refresh, watch count
- [x] Regional watchlist (report counts, 24 h delta; RAI honestly "N/E")
- [x] Region selection filters feed and focuses map
- [x] Intelligence feed with full provenance and published / occurred / collected times
- [x] Feed filters: time window, region, source, official vs. media, category, keyword
- [x] Keyboard: `/` command focus, `J`/`K` feed navigation, `Esc`
- [x] Command console (HELP, MAP GLOBAL, WATCH, FEED, SEARCH, CLEAR, STATUS, SOURCES, SETTINGS, GOC)
- [x] System status strip (honest "not deployed" states)
- [x] Source Directory page
- [x] Diagnostics page
- [x] Settings: scanlines, glow, flicker (off by default), map grid, areas; reduced-motion respected
- [x] Responsive layout (desktop 3-column; stacked on narrow screens)
- [x] Clearly labelled demonstration dataset (banner, DEMO tags, `[SIMULATED]` titles, no source links)
- [x] Visible map failure states (style fetch error, 20 s init watchdog, error counter)

## Phase 2 — Live source collection ✅ (verified on emulators; production hookup pending operator steps)

- [x] `collector/`: `SourceAdapter` contract, polite HTTP (UA, conditional GET, backoff, size and time limits)
- [x] Adapter: State Dept travel advisories with level-change detection (RAISED / LOWERED / reissued / NEW)
- [x] Adapter: CISA advisories (subtype classification, routine flag)
- [x] Adapter: CISA KEV (ETag → 304, ransomware flag)
- [x] Normalization, validation gate, HTML/URL sanitization, content hashing, FIPS→ISO mapping
- [x] Firestore writes: `events`, `sourceStatus`, `sourceState`, `collectionRuns`, `snapshots/dashboard`
- [x] Idempotency (verified: second run imports 0), failure isolation, health escalation, secret redaction
- [x] `.github/workflows/collect.yml` (hourly + manual), `ci.yml`, `grant-owner.yml`
- [x] `FirestoreRepository` (1 read per load) + Google sign-in + owner custom-claim gate
- [x] Firestore security rules + emulator tests (6 tests, mutation-checked)
- [x] Live source health, overdue detection, real Diagnostics
- [x] Production project `watchtower-b9b2a`: Firestore (nam5, Standard), Google auth, web app, rules published (2026-11-20)
- [x] Owner claim granted; first production collection run (75 events, 0 errors) and live dashboard verified (2026-11-20)
- [x] Private GitHub repo `bleclair003/watchtower`; hourly Collect workflow verified on Actions (2026-11-20)
- [ ] Adapter: GDELT (context only), pending rate-limit validation from Actions
- [ ] Incremental snapshot rebuild (read-cost optimization)

## Phase 3 — Indicator engine ✅
- [x] Indicator schema + declarative condition language (allow-listed fields, no code)
- [x] Deterministic evaluator (shared; runs in collector and browser) + unit tests
- [x] State tracking with evidence references, stateSince / lastTriggeredAt, transition log (`indicatorHistory`)
- [x] Data-availability states (UNKNOWN / DATA_UNAVAILABLE) that never read as calm
- [x] Baselines with history-sufficiency check
- [x] Regional Activity Index v0: coverage, per-source cap, transparent breakdown, 24 h change
- [x] Catalog v1: 16 indicators (State Dept ×12, CISA/KEV ×3, experimental ×1)
- [x] Indicators page, watchlist RAI + breakdown, feed evidence tags, status/diagnostics
- [x] Manual evaluation: `--evaluate-only` CLI and in-browser preview
- [ ] Operator editing of indicators (with Phase 4 rule builder)

## Phase 4 — Alerting ✅
- [x] Alert rules: graphical builder (rows + JSON mode) → declarative JSON, three edge-based trigger kinds
- [x] First-look semantics for newly created rules (fire once on existing state)
- [x] Alert creation with deterministic ids (no repeats for unchanged inputs), write-before-notify
- [x] Inbox with acknowledge / dismiss, severity filter, delivery status; open-alert counter in top bar
- [x] Per-rule cooldowns and batched (one message per rule per run) Discord notifications
- [x] Discord webhook via Actions secret; URL validation, mention/markdown neutralization, 429 handling, no secret logging
- [x] Rule test mode (browser preview; nothing created or sent) + "Test alert delivery" workflow
- [x] Security rules: validated rule shape, alerts read-only except ack/dismiss; collector state hidden
- [x] Discord webhook secret added; *Test alert delivery* succeeded (2026-11-20)

## Phase 5 — Dossiers ✅
- [x] Incident model with denormalized, traceable evidence records
- [x] Operator assessments (confirmed / unconfirmed / disputed / context), separate from source credibility
- [x] Three-clock timeline (occurred / published / collected) with fallbacks flagged and lags shown
- [x] Explainable related-record suggestions (shared terms / country / region / time)
- [x] Analyst notes, linked dossiers, attached indicators, regional context (RAI + indicator states)
- [x] + DOSSIER from any feed item (new or existing dossier)
- [x] Markdown evidence-packet export (PDD §12.2)
- [x] Security rules with shape/size validation and optimistic concurrency (version + 1)
- [ ] Automatic clustering suggestions for new events; per-dossier edit history

## Phase 6 — Advanced analysis
- [ ] Baselines, experimental-signal framework, replay, backtesting, SITREP + "Export Intelligence Context"

## Phase 7 — Refinement & deployment
- [ ] Firebase Hosting deploy, Playwright E2E, security review, a11y audit, performance pass
