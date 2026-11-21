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
- [x] Read-cost optimization: day-bucket event cache (v0.9.4), ~45 reads per run instead of up to ~2,300

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

## Phase 6 — Advanced analysis ✅ (method complete; needs ~90 days of collection to be informative)
- [x] Long-term RAI history (`raiHistory`, one point per run)
- [x] Historical Operations Replay with the hindsight rule (collectedAt ≤ T) and engine re-evaluation per frame
- [x] Backtesting: step simulation, episodes, hits / lead times / misses / false alarms, co-activation, data sufficiency
- [x] Trend charts: record volume, RAI history (small multiples, table view)
- [x] Experimental-signal framework: research records (PDD §7.3); new computable experimental signal
- [x] Deterministic SITREP (8 sections + limitations) with Markdown "Export Intelligence Context"
- [ ] Reconstruct historical source outages in replay (from collectionRuns)

## Phase 7 — Refinement & deployment ✅
- [x] Firebase Hosting deploy: https://watchtower-b9b2a.web.app (owner sign-in required)
- [x] Security headers: CSP, HSTS, frame denial, Permissions-Policy, COOP; Markdown exports neutralise source text
- [x] Playwright E2E (demo build with production headers): every module, key flows, mobile overflow, CSP violations
- [x] Accessibility: axe WCAG 2.1 A/AA clean on every module; contrast fix; skip link; feed focus ring
- [x] Performance: modules are code-split (first-load JS 469 KB → 285 KB); stale-chunk reload after deploys
- [ ] Hosting deploy from CI (currently deployed from the operator's machine)

## Phase 8 — Source expansion (v0.8.0)
- [x] 10 new collectors (3 → 13): UK FCDO, USGS, GDACS, IODA, DoD, UK MOD, IAEA, UN News, BBC World, Al Jazeera
- [x] Headline gazetteer (country/region from explicit mentions, terms recorded) and keyword topic classifier; `general` category
- [x] Exact-coordinate sources on the map (USGS epicentres, GDACS event points)
- [x] Catalog v3: FCDO updates, connectivity drops, Korea non-earthquake seismic events, experimental media volume
- [x] Feed detail shows how location and topic were derived (TXT-GEO tag)
- [ ] GDELT (retry from an Actions runner), ReliefWeb (needs an approved appname), NGA MSI (503), UKMTO, MARAD
- [x] Free-key sources built (v0.9.0): NASA FIRMS new fire clusters, Cloudflare Radar attributed outages; catalog v4 (48)
- [x] FIRMS live since 2026-11-20 (key configured); point-in-country check added after the first run
- [x] Cloudflare Radar live since 2026-11-20; network-location and revision fixes after the first run
- [x] ACLED evaluated and rejected (no API on personal accounts; EULA excludes dashboard use)
- [ ] Cross-source corroboration: mark a media report `corroborated` when an independent source reports the same country and topic
