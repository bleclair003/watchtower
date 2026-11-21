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

## Phase 10 — Analyst features (started 2026-11-21)
1. **Stories** — group reports of the same event across outlets; show which sources reported it and whether it is multi-source
   - [x] Deterministic grouping of same-story headlines (time window, shared terms, shared place), explainable per story
   - [x] Corroboration level per story: single-source / multi-source (independent publishers) / includes official reporting
   - [x] Feed shows one entry per story with its sources; toggle back to all items
   - [x] Tests on real headlines; checked on real collected data (emulator) — v0.10.0
2. **Daily brief to Discord** — morning summary: RAI changes, triggered indicators, new official warnings, top stories, links
   - [x] Brief builder (deterministic, from the dashboard snapshot; reuses stories and relevance) — v0.11.0
   - [x] Scheduled delivery (once a day at/after 11:00 UTC) through the existing webhook, with retries and failure logging
3. **Region pages** — one page per watch region
   - [x] RAI history and score breakdown (RAI points per indicator), all region indicators, latest reports as stories, region map (7 days), countries and categories — v0.12.0
   - [x] REGIONS index, links from the GOC watchlist, `REGION <code>` command

## Phase 11 — United States (domestic) watch (v0.13.0)
- [x] Eighth watch region, `united-states`: events inside the US, with emphasis on the military and homeland security
- [x] Domestic tagging: US places (states, cities, installations), source modes, US borders for points, US bases abroad mapped to host countries
- [x] 9 new sources: FAA security/VIP flight restrictions, DHS NTAS, FEMA, NWS Extreme, Air Force, Marines, Military Times, Defense News, NPR National (+ BBC US & Canada)
- [x] Catalog v5: NTAS advisory, installation incident, National Guard deployment, security flight-restriction burst, major disaster
- [ ] NORAD/NORTHCOM feeds (need the correct feed ids), Army/Navy/National Guard (feeds blocked or empty)

## Phase 12 — Military installations on the map (started 2026-11-21)
- [x] United States: 831 DoD MIRTA installations, branch colours, BASES toggle, click card with facts, related records and FAA restrictions (v0.14.0)
- [x] Worldwide: 2,775 current installations outside the US from Wikidata (CC0); rings coloured by US-operated abroad / foreign-operated / national (v0.15.0)
- [x] Filter bases by operating country, or hide all (v0.15.1)
- [ ] Fill notable gaps (Camp Lemonnier, Djibouti, South China Sea island bases) via Wikidata edits or a second source
- [ ] Installation boundaries (MIRTA polygons) on selection


## Phase 13 — More signals (planned 2026-11-21)
Every source is checked on real responses first (licence, rate limits, terms). A source that fails is recorded here as blocked and left out. Each item ships with tests, docs, a changelog entry and a production check.
Budget: GitHub Actions minutes are the binding limit (~1,600 of 2,000 a month at 30-minute collection). Measure each new source's run time and keep the monthly total under 1,900.

### A. Military movement
1. **Military aircraft** (adsb.lol / airplanes.live military endpoints, no key)
   - [x] Verify the endpoints, terms and rate limits: adsb.lol primary (ODbL), adsb.fi fallback; airplanes.live needs contact first
   - [x] Snapshot every collection run; one record per notable aircraft, area and day (tanker, surveillance, bomber, airlift); positions only, no stored tracks
   - [x] AIR map layer with class colours and a click card; limits stated (snapshot, transponders off) — v0.16.0
   - [x] Indicators: tanker/surveillance/bomber and airlift activity per region against a 14-day baseline (experimental)
2. **US Navy fleet positions** (USNI News Fleet Tracker, weekly)
   - [ ] Parse carrier and amphibious group positions from the weekly article; approximate areas only, no invented coordinates
   - [ ] FLEET map layer and indicator: carrier group arrives in a watch region
3. **Ship traffic at chokepoints** (aisstream.io, free key)
   - [ ] Sign-up and terms check (user creates the key; stored as an Actions secret)
   - [ ] Short listen window per run (budget-checked); transit counts for Hormuz, Bab el-Mandeb, Taiwan Strait, Bosporus, Suez
   - [ ] Indicator: transit count drops against the baseline

### B. Escalation and pressure signals
4. **Sanctions** (OFAC SDN and recent actions, EU consolidated list, UK sanctions list)
   - [ ] Daily diff of each list: new designations by country and programme
   - [ ] Indicator: new sanctions designations targeting a watch-region country
5. **UN Security Council** (meetings programme, press releases, resolutions)
   - [ ] Emergency and unscheduled meetings, vetoes, adopted resolutions
   - [ ] Indicators: emergency session on a watch-region country; veto cast
6. **Missile and nuclear tests**
   - [ ] CNS North Korea missile test database (check access) plus official test notices
   - [ ] Indicator: missile or nuclear test reported
7. **Embassy alerts and ordered departures**
   - [ ] Per-embassy US security alerts for watch-region countries (find feeds that work)
   - [ ] Indicator: ordered or authorised departure

### C. US domestic and military
8. **DoD contract awards** (daily announcements)
   - [ ] Parse awards; flag munitions, missiles and large awards (amount threshold)
9. **Federal Register** (free API, no key)
   - [ ] Executive orders, export controls (BIS), national emergency declarations, defence notices
10. **Congress** (congress.gov API, free key)
   - [ ] War-powers resolutions, NDAA steps, defence and intelligence hearings

### D. Context layers
11. **Satellite imagery** (NASA GIBS daily tiles, no key)
   - [ ] IMAGERY map layer you switch on, with date and product shown; check the CSP and attribution
12. **Military satellite launches** (Launch Library 2)
   - [ ] Upcoming and recent launches, with military payloads flagged
13. **Disease outbreaks** (WHO Disease Outbreak News)
   - [ ] Adapter and tagging; indicator for an outbreak in a watch-region country
14. **Economic stress** (free FX and oil price data)
   - [ ] Daily currency moves for watch-region countries; Brent/WTI
   - [ ] Indicators: sharp currency drop; oil price spike
15. **Refugee flows** (UNHCR API)
   - [ ] Displacement figures per country on region pages (slow-moving: context, not alerts)

### E. Analysis on existing data
16. **What changed** (no new source)
   - [ ] Per-region diff against 24 hours ago: new indicators, RAI changes, new stories, new official warnings
   - [ ] On the region pages, the GOC and the daily brief
17. **Activity near bases**
   - [ ] Records near or naming each base this week against its usual level; flag unusual activity on the map and the card
18. **Watchlist**
   - [ ] Your own list of people, units, bases or terms; matching records are highlighted and can trigger alerts (stored per user, Firestore rules updated)
