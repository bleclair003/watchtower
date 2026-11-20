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
- [~] Git repository initialized (initial commit created; no GitHub remote yet)
- [ ] Firebase project created (operator action — see DEPLOYMENT.md)

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

## Phase 2 — Live source collection (NEXT)

- [ ] Create Firebase project (Spark) + enable Firestore + Auth (operator)
- [ ] `collector/` package: `SourceAdapter` interface, HTTP client with conditional GET + backoff
- [ ] Adapter: State Dept travel advisories (with level-change detection)
- [ ] Adapter: CISA advisories + KEV
- [ ] Normalization, validation, sanitization, content hashing
- [ ] Firestore writes: `events`, `sourceStatus`, `collectionRuns`, `snapshots/dashboard`
- [ ] `.github/workflows/collect.yml` (hourly cron + `workflow_dispatch`)
- [ ] `FirestoreRepository` + Firebase Auth sign-in (owner only)
- [ ] Firestore security rules + emulator tests
- [ ] Source health computed from real runs; Diagnostics shows real run history
- [ ] Adapter: GDELT (context only), pending rate-limit validation

## Phase 3 — Indicator engine
- [ ] Indicator schema + declarative condition language
- [ ] Deterministic evaluator (in collector) + unit tests
- [ ] Indicator state tracking with evidence references
- [ ] Regional Activity Index v0 with transparent breakdown
- [ ] Indicators page; manual evaluation trigger

## Phase 4 — Alerting
- [ ] Alert rules (graphical builder → declarative JSON)
- [ ] Alert creation, history, acknowledgement, cooldowns, dedupe
- [ ] Discord webhook (secret in Actions)
- [ ] Rule test mode

## Phase 5 — Dossiers
- [ ] Incident model, linking, timelines, analyst notes, verification classes

## Phase 6 — Advanced analysis
- [ ] Baselines, experimental-signal framework, replay, backtesting, SITREP + "Export Intelligence Context"

## Phase 7 — Refinement & deployment
- [ ] Firebase Hosting deploy, Playwright E2E, security review, a11y audit, performance pass
