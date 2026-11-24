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
- [x] GitHub repo `bleclair003/watchtower` (private until 2026-11-21, now public); hourly Collect workflow verified on Actions (2026-11-20)
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
- [x] Cross-source corroboration: stories (v0.10.0); independent origins, alert follow-ups and unconfirmed marking (v0.72.0, Phase 35)

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
   - [x] Parse carrier and amphibious group positions from the weekly article; approximate areas only, markers at named-area reference points (v0.17.0)
   - [x] FLEET map layer and indicator: carrier or big-deck arrives in a watch region (v0.17.0)
3. **Ship traffic at chokepoints** (IMF PortWatch; aisstream.io rejected)
   - [x] aisstream.io key and coverage probe: no coverage at any chokepoint, rejected
   - [x] IMF PortWatch daily transits for Hormuz, Bab el-Mandeb, Suez, Bosporus, Taiwan Strait, Malacca (owner accepted the terms risk) — v0.18.0
   - [x] Indicators: traffic reduced / severely reduced or falling fast, against the 2025 average and the previous four weeks

### B. Escalation and pressure signals
4. **Sanctions** (OFAC SDN and recent actions, EU consolidated list, UK sanctions list)
   - [x] Diff of each list: new designations by list, day and target country (OFAC, EU, UK) — v0.19.0
   - [x] Indicators: new designations against the baseline; large package (25+)
   - [x] Sanctioned vessels with IMO/MMSI kept for item 4b
4b. **Sanctioned vessels in the Baltic and North Sea** (aisstream.io; needs item 4's vessel identifiers)
   - [x] Coverage probe: good in the Baltic (930 ships in 2 min) and North Sea (2,984); none at the chokepoints; no US Navy warships at Norfolk or San Diego
   - [x] 25-second listen per run in parallel with the other sources; matched by IMO (identity messages) or OFAC MMSI; MMSI→IMO links kept across runs — v0.20.0
   - [x] Records and map markers when a sanctioned vessel is seen; experimental indicator for the Eastern Europe region
5. **UN Security Council** (meetings programme, press releases, resolutions)
   - [x] Meetings, adopted resolutions (tallies, abstentions) and failed drafts / vetoes — v0.21.0 (UN Digital Library + press RSS)
   - [x] Indicators: Council attention above baseline; failed draft or veto
   - [ ] "Emergency meeting" label: the Council website refuses scripted requests
6. **Missile and nuclear tests**
   - [x] Launches and nuclear tests from Yonhap (CNS/NTI, CTBTO and Japan MOD refuse scripted clients) — v0.22.0
   - [x] Indicators: launch days; nuclear test reported
7. **Embassy alerts and ordered departures**
   - [x] Ordered / authorized departure and suspended operations from the State Department advisories (embassy sites refuse scripted requests) — v0.23.0
   - [x] Indicator: US embassy drawdown

### C. US domestic and military
8. **DoD contract awards** (daily announcements)
   - [x] Parse awards; flag munitions, missiles, large awards and FMS to watch-region partners — v0.24.0
9. **Federal Register** (free API, no key)
   - [x] Executive orders and presidential actions, new national emergencies, BIS export controls, State terrorist designations — v0.25.0
10. **Congress** (congress.gov API, free key)
   - [x] War-powers resolutions, arms-sale disapprovals, NDAA steps, security hearings — v0.26.0 (needs CONGRESS_API_KEY)

### D. Context layers
11. **Satellite imagery** (NASA GIBS daily tiles, no key)
   - [x] IMAGERY map layer you switch on (true colour, night lights, 2016 baseline), with date and product shown; CSP and attribution — v0.27.0
12. **Military satellite launches** (Launch Library 2)
   - [x] Completed military and classified launches worldwide; North Korea and Iran flagged — v0.28.0
13. **Disease outbreaks** (WHO Disease Outbreak News)
   - [x] Adapter and tagging; indicator for an outbreak in a watch-region country — v0.29.0
14. **Economic stress** (free FX and oil price data)
   - [x] Daily currency moves for watch-region countries; Brent/WTI — v0.30.0
   - [x] Indicators: sharp currency drop; oil price spike — v0.30.0
15. **Refugee flows** (UNHCR API)
   - [x] Displacement figures per country on region pages (slow-moving: context, not alerts) — v0.31.0

### E. Analysis on existing data
16. **What changed** (no new source)
   - [x] Per-region diff against 24 hours ago: new indicators, RAI changes, new stories, new official warnings — v0.32.0
   - [x] On the region pages, the GOC and the daily brief — v0.32.0
17. **Activity near bases**
   - [x] Records near or naming each base this week against its usual level; flag unusual activity on the map and the card — v0.33.0 (flags from 21 days of history)
18. **Watchlist**
   - [x] Your own list of people, units, bases or terms; matching records are highlighted and can trigger alerts (stored per user, Firestore rules updated) — v0.34.0

## Phase 14 — Meters and monitors ✅ (v0.35.0, 2026-11-21; see [METERS.md](METERS.md))

Analysis across the sources already collected. Every meter shows its evidence, the date its data is from, and whether its baseline is still being built; none states a probability. Computed by the collector each run (pure functions in `shared/domain/meters/`) and stored in the snapshot with a short history.

### A. Region composite meters
1. **Escalation ladder** (per region)
   - [x] Highest active rung — rhetoric → posture → kinetic → consequence — with the evidence for each rung
2. **Evacuation risk** (per region)
   - [x] Embassy departure posture, US/UK travel-advice changes, airlift aircraft in the area, currency stress
3. **Quiet buildup vs noise** (per region)
   - [x] News volume against hard posture signals, each relative to its usual level: "hype" or "quiet buildup"

### B. Topic monitors
4. **Air surge**
   - [x] Tanker, airlift and surveillance aircraft per watch area against the usual level
5. **Naval presence**
   - [x] Big-deck ships per theatre (USNI), strait traffic, sanctioned ships seen
6. **Maritime risk** (per strait)
   - [x] Transit drop, oil move and maritime news per strait
7. **Sanctions pressure**
   - [x] New US/EU/UK designations per target country per week, plus sanctioned ships seen
8. **Arms flow**
   - [x] Munitions contract dollars, FMS to watch partners, BIS export rules, congressional arms-sale challenges
9. **Washington attention**
   - [x] National emergencies, presidential security documents, war powers resolutions, security hearings, NTAS
10. **Diplomatic temperature**
   - [x] UNSC meetings and failed drafts, travel-advisory raises, DPRK statements
11. **Strategic weapons**
   - [x] Military and classified launches, DPRK missile reports, IAEA news, nuclear-related actions in Congress
12. **Information blackout**
   - [x] Government-directed or military outages, plus a sudden drop in reporting from a region
13. **Economic stress gauge**
   - [x] Currency, oil and chokepoint traffic per region
14. **Humanitarian strain**
   - [x] WHO outbreak reports, displacement, orange/red disaster alerts, fire clusters in conflict zones
15. **Homeland board**
   - [x] NTAS, security and VIP flight restrictions, FEMA declarations, severe weather, ransomware-linked KEV
16. **Cyber weather**
   - [x] CISA advisories, KEV (ransomware weighted), outages: low / guarded / elevated / high

### C. Counters and clocks
17. **Days since**
   - [x] Last DPRK launch, UNSC emergency meeting, carrier in the Gulf, ordered departure, government shutdown of the internet (carried across runs)
18. **Upcoming calendar**
   - [x] Scheduled military launches and other dated items from collected sources

### D. Quality and confidence
19. **Corroboration**
   - [x] Share of a region's stories corroborated by several publishers or an official source
20. **Visibility**
   - [x] How much of each region WATCHTOWER can see: sources online, data lag, known sensor gaps
21. **Lead/lag lab** (Signal Lab)
   - [x] Which meters moved before RAI rises, once history exists

### E. Presentation
   - [x] Meters page; meter strip on each region page; meter history for sparklines; demo-mode meters (simulated)

## Phase 15 — Outside signals, language and source behaviour (planned 2026-11-21)

Free sources and analysis of data already collected. Each new outside source is checked for terms and access before it is built; each analysis states its method and limits, and none states a probability of its own.

### A. New free signals
1. **Prediction markets and forecasters**
   - [x] Check terms and API access: Polymarket (API allowed, website scraping forbidden), Kalshi (rejected: no storing), Metaculus (needs a token; deferred) — v0.37.0
   - [x] Track odds on watch-region geopolitical questions next to the meters; flag sharp moves; label as betting odds, not WATCHTOWER's view — v0.37.0
2. **Infrastructure proximity alerts**
   - [x] Load free static datasets (power plants incl. nuclear, refineries, dams, major ports) with their licences and dates — v0.38.0 (WRI + Wikidata, 941 sites)
   - [x] Flag fire clusters, military records and strike reports near or naming them (10 km for nuclear, 5 km others); show on the map and in the meters — v0.38.0 (outages are country-level, so they cannot be placed near a site)

### B. Language and narrative (fixed rules, no paid AI)
3. **Language temperature**
   - [x] Open, adjustable escalation and de-escalation word lists; score each region's headlines over time — v0.39.0
4. **People and group tracking**
   - [x] Mentions over time of named groups and leaders per region; first-appearance flags for new names (panels, meter, daily brief) — v0.40.0
5. **Coverage gaps**
   - [x] Stories reported by only one side (e.g. Al Jazeera but not BBC or official feeds, and the reverse) — v0.41.0

### C. How the sources behave
6. **Who's first**
   - [x] Per kind of event, which source reports first (sensor, official, media) and by how many hours — v0.42.0
7. **Source track record**
   - [x] Per source, how often a single-publisher report is later corroborated by others — v0.43.0
8. **Missing regulars**
   - [x] Alert when a source that normally posts daily goes quiet, per source — v0.44.0 (meter and daily brief)

### D. Context and dates
11. **Known dates ahead**
   - [x] Curated calendar of tension-prone dates (elections, national days, anniversaries, regular exercises) added to the meters calendar — v0.45.0
12. **Like-for-like comparisons**
   - [x] Compare Saturdays with Saturdays and holidays with holidays in usual-level baselines (most useful after a few months of history) — v0.46.0

## Phase 16 — Power outages (2026-11-21)

1. **Power-outage monitoring**
   - [x] Research free sources and their terms: ODIN (DOE/ORNL, public API, used), EIA-930 hourly demand (possible later), ENTSO-E (token, unclear reuse terms), PowerOutage.us (paid, scraping barred) — v0.47.0
   - [x] US customers without power by county from ODIN: map layer, state records at 25k/100k/250k/500k/1M — v0.47.0
   - [x] Power-outage meter for every region: Cloudflare power-cut outages, power-cut headlines, and ODIN in the US — v0.47.0

## Phase 17 — Better FAA data (2026-11-21)

1. **FAA airspace**
   - [x] TFR outlines, times, reason and altitude on the map — v0.48.0
   - [x] Airport status: ground stops, delay programs, delays and closures; records for causes other than weather or volume — v0.48.0
   - [x] FAA prohibitions and advisories for US flights abroad, new documents as records — v0.48.0
   - [x] Airspace meter for every region — v0.48.0
   - [ ] FAA NOTAM API (foreign airspace closures, danger areas, GPS interference) — needs FAA developer credentials

## Phase 18 — Radiation detection (2026-11-21)

1. **Ambient gamma dose rate**
   - [x] Germany (BfS ODL), Finland (STUK via FMI), US (16 EPA RadNet monitors), each station against its own usual level — v0.49.0
   - [x] Groups of raised stations as records, RAD map layer, radiation meter — v0.49.0
   - [ ] Ukraine's public stations via the SaveEcoBot radiation API — needs an access key (request form)

## Phase 19 — CME detector and space weather (2026-11-21)

1. **Space weather**
   - [x] CMEs with predicted Earth arrival (NASA DONKI WSA-Enlil) and observed geomagnetic storms — v0.50.0
   - [x] NOAA SWPC scales, three-day outlook, K-index and notable watches, warnings and alerts — v0.50.0
   - [x] Space weather meter, panel and calendar arrivals — v0.50.0

## Phase 20 — CYBER page (2026-11-22)

1. **Cyber as its own page**
   - [x] CYBER page: KEV (30 d) with EPSS, CISA alerts and advisories, national cyber agencies, internet disruptions, cyber meter — v0.51.0
   - [x] National cyber agencies: UK NCSC, Canadian Centre for Cyber Security, JPCERT/CC, CERT-UA — v0.51.0
   - [ ] Ransomware victims (ransomware.live API PRO, free key) — needs a key under its terms

## Phase 21 — Ukraine front (2026-11-22)

1. **Front activity and claims**
   - [x] General Staff daily activity per sector (via Ukrinform), trends, quiet sectors, settlements named — v0.53.0
   - [x] Territorial claims in headlines, by side — v0.53.0
   - [x] Ukraine front intensity meter — v0.53.0
   - [ ] Front lines and areas of control — DeepStateMap API key requested 2026-11-22 (reply expected within ~3 days)

## Phase 22 — Air attacks on Ukraine (2026-11-22)

- [x] Overnight drones and missiles launched / shot down / hit locations (Ukrainian Air Force via Ukrinform), panel section, meter, records — v0.55.0
- [x] Map and page layers moved to their own snapshot document (feed back to 700 records) — v0.54.0

## Phase 23 — Censorship and maritime security (2026-11-22)

- [x] OONI censorship grid (12 countries × 7 services), new-block records, blackout meter component — v0.56.0
- [ ] UKMTO maritime incidents — parked (branch wip/ukmto): data host refuses Node requests (bot protection); ask UKMTO (info@ukmto.org) for permission or a feed

## Phase 24 — Anomaly detection (2026-11-22)

- [x] Shared anomaly module: robust score (median and median absolute deviation), unusual drops, Mann–Kendall trends — v0.57.0
- [x] Indicators with a baseline: thresholds from median + 2 / 3 typical spreads (catalog v20) — v0.57.0
- [x] Usual-level meters scored by how unusual, not only N× usual (air surge, buildup, blackout drop, cyber, after-hours, actors) — v0.57.0
- [x] Ukraine front and air attacks: scores against their own spread, rise/fall trends — v0.57.0
- [x] Unusual readings meter per region: independent measurements unusual at once — v0.57.0
- [x] Baselines ignore the time before a live-only source started (back-fill check) — v0.57.1
- [ ] Radiation, chokepoint transits and OONI shares as signals for the unusual-readings meter
- [ ] Backtest the score cut-offs once 60+ days of history exist

## Phase 25 — Gaps from the World Monitor comparison (2026-11-22)

- [x] NGA navigational warnings (missile firings, exercises, GPS interference, piracy, cables) with warned areas on the map — v0.59.0 (portal under maintenance at release; adapter untested against a live answer)
- [x] Aircraft emergency codes 7500 / 7600 / 7700 (adsb.lol) on the map and in the feed — v0.59.0
- [x] UCDP conflict events (monthly candidate release) on the map, per-region monthly totals — v0.59.0
- [ ] Taiwan MND daily PLA activity and Japan Joint Staff scrambles (check terms)
- [ ] More travel and health advisories (Australia Smartraveller, CDC, Canada)
- [x] GPS interference from aircraft position-quality fields — v0.69.0 (Phase 32)
- [ ] State-affiliated / partisan labels on publishers
- [ ] Open-Meteo climate anomalies; abuse.ch cyber infrastructure; satellites layer (cables and pipelines done in v0.71.0)

## Phase 26 — Several people (2026-11-22)

- [x] Roles: owner (claim), editor, viewer, pending, blocked — enforced by the Firestore rules and tested on the emulator — v0.60.0
- [x] Users page (owner only): approve, change or remove access — v0.60.0
- [x] Only the owner's and editors' watchlists raise alerts — v0.60.0
- [ ] Viewers: copy a dossier as Markdown (the export button is disabled with the rest of the read-only form)
- [ ] Optional: email the owner when someone is waiting (needs a free mail route)
- [x] Time filters on dated map layers (CONFLICT days of the release, NAVWARN issue age) and a 30D feed window — v0.61.0
- [x] SITREP: single aircraft listed only when exceptional; heavy air activity as one line per indicator — v0.62.0

## Phase 27 — Unusual aircraft movement

- [x] Short position history per tanker, surveillance aircraft, bomber, command post and VIP transport (4 h, in the source state) — v0.63.0
- [x] Holds where that kind has not held in 30 days; types new to a watch area in 30 days; 14-day learning period — v0.63.0
- [x] Experimental indicator per region; SITREP lists them as significant — v0.63.0
- [x] Grouping: 3+ strategic aircraft at altitude within 300 km in one run, in a 3° square with no such group in 30 days (own 14-day learning period) — v0.66.0
- [x] Odd hours: 2+ notable aircraft airborne in a watch area in a UTC hour that had none on all but one of the last 14 days (12+ days checked) — v0.66.0


## Phase 28 — Radio listening links (2026-11-22)

WATCHTOWER links to radio; it never plays, records, transcribes or re-streams audio, and never connects to a receiver itself.
Every frequency carries a cited source; Priyom data is credited (CC BY-NC-SA 4.0). A legal note on each radio panel:
listening rules differ by country (UK: Wireless Telegraphy Act 2006 s.48 — broadcasts such as VOLMET only).

**Listen links on records (option 1)**
- [x] Receiver list: the collector fetches the public KiwiSDR list (rx.linkfanel.net mirror of kiwisdr.com/public) once a day, keeps name, address, position, bands, user slots and online state; credited on the Sources page. No receiver is contacted.
- [x] "Tune nearby" links: nearest online KiwiSDR covering the band, opened at the frequency (`?f=8992usb`); a WebSDR fallback (`?tune=`) where one is near
- [x] Aircraft emergencies and aircraft records: link to LiveATC for the nearest large airport (airport table from OurAirports, public domain; LiveATC search URL checked by hand: LiveATC's own page says whether an airport is covered); UK points say why there is none (UK law) — v0.64.0
- [x] US records: Broadcastify state page (fixed state ID table; their terms forbid automated feed lists)

**Radio reference panel per region (option 2)**
- [x] Hand-curated frequency list with a source for each: global (HFGCS 4724/6739/8992/11175/13200/15016 USB, Shannon VOLMET, North Atlantic HF families, maritime distress 2182/4125/6215/8291/12290/16420), Eastern Europe (UVB-76 4625, "The Pip" 5448/3756); unconfirmed frequencies are not listed
- [x] Panel on each region page and a global one on a new RADIO page (not the GOC, which is full): what you would hear, mode, best time of day, "tune nearby" link, source link
- [x] Day/night hint for HF (e.g. HFGCS 11175 by day, 4724 at night) from the viewer's UTC time

**Later (option 3, not started)**
- [ ] Aircraft text messages (ACARS/VDL2/HFDL) from airframes.io once its API is live and its terms allow (non-commercial data use today)
- [ ] HFGCS message counts from a community log, only with that log's permission, as an experimental indicator

## Phase 29 — Conflict-region radio (2026-11-23)

Same rule as Phase 28: links only. Front-line tactical radio (short-range VHF/UHF, often encrypted) is out of reach and out of scope.
The radio data lives in its own Firestore document (`snapshots/radio`), read only by the radio panels and LISTEN links.

- [x] Shortwave schedules: the EiBi season list (free to use and redistribute), fetched once a day, kept to transmissions aimed at or based in a watch region; language and country names from its README — v0.65.0
- [x] Region panel: aimed at the region / from stations in it, "on the schedule now" filter, broadcasters and military/numbers/utility stations apart, each frequency tuned on the receiver nearest the region — v0.65.0
- [x] Local radio: Radio Browser's open directory, searched once a day per watch-region country, news and talk first; region panel and a LISTEN link on records with a country — v0.65.0
- [x] Regional HF air traffic and VOLMET families with a public source each: Middle East (MID HF, MID VOLMET), Red Sea (AFI HF, AFI VOLMET), Korea and Taiwan (EA HF, West Pacific VOLMET), South China Sea (SEA-2 HF, SEA VOLMET) — v0.66.1
- [ ] Numbers stations per region beyond those in the EiBi schedule, where a public source confirms them

## Phase 30 — Alert feedback and scorecard (2026-11-23)

From the feature audit (categories 11 and 26).

- [x] Verdict on each alert: useful, irrelevant, false positive, wrong category, with an optional note; owner and editors only, enforced by the Firestore rules — v0.67.0
- [x] Missed-incident log: things WATCHTOWER missed or caught late (hours late, regions, category, link, note) — v0.67.0
- [x] SCORECARD tab: reviewed share, useful and false-positive shares, WARNING + CRITICAL precision, per level and per rule (with the rule versions behind the alerts and a NOISY flag), missed and late incidents by region and category, collector runs with every source answering — v0.67.0
- [x] New alerts record the indicator catalog version as well as the rule version — v0.67.0
- [ ] Detection delay against the real event time for useful alerts (needs the evidence records' occurred times)
- [ ] Suggest rule changes from verdicts (for example a NOISY rule's commonest irrelevant terms)
- [ ] Use missed incidents as test cases when rules or sources change

## Phase 31 — Map tools (2026-11-23)

From the feature audit (category 12, items 2, 7, 8 and 9; category 23 item 3).

- [x] Shareable links: the address bar holds map position, layers, feed filters, the selected item and a ruler measurement; reloading or bookmarking restores them; every value read from a link is checked — v0.68.0
- [x] The map reopens where you left it (this browser) — v0.68.0
- [x] Map search over what is loaded: regions, bases, aircraft (callsign, registration, hex, type), sanctioned ships (name, IMO, MMSI, destination), US Navy areas and ship names, straits, infrastructure sites, airports; says which layers are off and so not searched — v0.68.0
- [x] Ruler: great-circle distance (km, nm) and bearings between two clicks, snapping to markers — v0.68.0
- [x] PNG snapshot with time, layers, feed window, centre, ruler, the link and map credits — v0.68.0
- [x] Draw an area of interest and alert on activity inside it (audit 12.1) — v0.74.0 (Phase 37)
- [ ] Links for region pages and the replay

## Phase 32 — GPS interference (2026-11-23)

From the feature audit (category 5, items 1, 2 and 6; category 1 item 6 left open).

- [x] Hourly samples of ten 250 nm circles over the watch regions (adsb.lol, adsb.fi per circle when adsb.lol fails); per 1° square and hour: aircraft sightings, degraded (NACp below 8) and GPS lost (readsb gpsOkBefore) — v0.69.0
- [x] GPS map layer: squares by degraded share over 24 hours (under 2%, 2–10%, 10%+), last good positions before GPS was lost, the sampled circles; a card per square with NGA GPS-interference warnings within 500 km and links to adsb.lol and GPSJam — v0.69.0
- [x] Records: a square high in an hourly sample of the last 6 hours that was not high over the 24 hours before, per region, once a day, after a day of history; experimental indicator per region (catalog v22) — v0.69.0
- [ ] Position jumps (aircraft far from where their speed allows): needs consecutive positions of the same aircraft
- [ ] Tell landings from coverage loss (audit 1.6)
- [ ] GPS interference in the SITREP and the unusual-readings meter once a baseline exists

## Phase 33 — Routing and DDoS (2026-11-23)

From the feature audit (category 7, items 2, 6 and 7).

- [x] Route hijacks (Cloudflare Radar, confidence 8+ of 10) and route leaks involving networks registered in watch-region countries (not the US), read hourly; notable only across a border between two watch-region countries (v0.70.1), leaks under 100 blocks routine — v0.70.0
- [x] DDoS: daily network-layer attack traffic aimed at each watch-region country, 28 days; a surge is half the four-week peak or more (median rule replaced in v0.70.1: attacks are bursty) — v0.70.0
- [x] CYBER page panels (C6 routing, C7 DDoS with 28-day lines); experimental indicators per region: route hijack, DDoS surge (catalog v23) — v0.70.0
- [ ] Add hijacks and DDoS surges to the cyber meter once they have history
- [ ] Application-layer (layer 7) attacks, once Cloudflare documents whether its location filter is the target or the origin

## Phase 34 — More map layers (2026-11-23)

From the feature audit (category 4, items 3, 5, 6 and 7; category 3 item 4).

- [x] CABLES: undersea telecom cables, power cables 100 kV+ and oil and gas pipelines in the watch-region seas (OpenStreetMap, ODbL); card with sanctioned ships within 20 km and NGA warnings within 50 km; sanctioned-ship cards list lines within 20 km — v0.71.0
- [x] DISPUTED: disputed, breakaway, buffer and leased areas worldwide (Natural Earth, public domain), card with who administers and who claims — v0.71.0
- [x] Other nuclear facilities (research reactors, enrichment, fuel cycle) and embassies and consulates added to the site file (Wikidata), with the "activity near sites" checks (10 km nuclear, 1 km embassies, location only) — v0.71.0
- [ ] More embassies: only 112 missions have a location on Wikidata
- [ ] Cable landing stations; Red Sea and Asian cables are thin on OpenStreetMap
- [x] Records when a sanctioned ship lingers near an undersea cable — v0.73.0 (Phase 36)

## Phase 35 — Corroboration (2026-11-23)

From the feature audit (category 11 item 3; category 14 items 5 and 6).

- [x] Independent origins: outlets crediting the same news agency (Reuters, AP, AFP, TASS, Xinhua, IRNA …) or carrying near-identical text count once; stories record when a second independent origin reported — v0.72.0
- [x] Alerts resting on one media report are watched for 72 hours: a follow-up alert one level higher when an independent origin reports (once per rule and story, not held by cooldown); otherwise marked unconfirmed — v0.72.0
- [x] Feed: UNCONFIRMED tag on media reports with no independent report after 48 hours; stories say "N outlets · 1 origin" and why — v0.72.0
- [ ] Use corroboration in the scorecard (are corroborated alerts more often useful?)
- [ ] Agencies credited only in the article body are missed: feeds carry headlines and short summaries

## Phase 36 — AIS reliability and cable watch (2026-11-24)

- [x] AIS listening keeps what was heard when the stream drops after starting, retries once when it fails early, and tolerates two failed listens in a row before the source fails (29 of 60 runs failed on 2026-11-23) — v0.73.0
- [x] Sanctioned ships within 2 km of a mapped undersea cable or pipeline, moving under 4 kn or seen near the same line again 30+ minutes later, not within 10 km of a port: records and an experimental indicator (catalog v24) — v0.73.0
- [x] Ports outside the watch-region countries (Finland, Sweden, Denmark, Germany, Norway) for the cable watch and dark-ship check — v0.77.0

## Phase 37 — Watch areas (2026-11-24)

From the feature audit (category 12 item 1; category 23 item 9).

- [x] AREA tool on the GOC map: draw a circle (centre, edge) or a polygon (3–50 corners), name it, choose an alert level, categories and Discord — v0.74.0
- [x] Stored in Firestore (`watchAreas`), written by the owner and editors, read by every member, shape and size checked by the rules; demo mode keeps them in the browser — v0.74.0
- [x] Alerts for new exactly located records inside an area, through the normal inbox, cooldown and Discord path — v0.74.0
- [x] WATCH layer and card (records inside in 24 h and 7 days, what is inside on the loaded layers), AREAS page and a page per area; areas in links — v0.74.0
- [ ] Reshape an area (today: delete and redraw)
- [ ] Records placed at a city could count for small areas around that city (today only exact positions count)

## Phase 38 — Tanker and cargo traffic, shipping lanes (2026-11-24)

From the feature audit (category 2, items 1–3, partly).

- [x] Coverage measured with the AIS probe (120 s): North Sea ~2,900 ships, Baltic ~960, eastern Mediterranean ~100, Black Sea ~60, Korea 22, South China Sea 7; Gulf, Red Sea, Taiwan Strait none — v0.75.0
- [x] SHIPS layer: tankers (AIS 80–89) and cargo ships (70–79) in the Baltic, North Sea, Black Sea and eastern Mediterranean, from the same listen as the sanctioned-ship check; types remembered between runs; 24-hour tracks, one point per run; card with identity, destination, track, sanctions match and nearby cables; up to 800 ships in their own document — v0.75.0
- [x] The sanctioned-ship check (and cable watch) now also covers the Black Sea and eastern Mediterranean — v0.75.0
- [x] LANES layer: global shipping lanes, major to minor (Benden 2022, from the CIA ocean map) — v0.75.0
- [ ] Gulf, Red Sea and Asian traffic: needs a source with receivers there (none free found yet)
- [ ] Traffic density (World Bank, CC BY 4.0: 20–510 MB rasters, 2015–2021) or EMODnet vessel density (Europe, WMS)
- [x] Ships going dark (v0.77.0) and tanker traffic levels in the Gulf of Finland (v0.78.0)
- [ ] Port calls

## Phase 39 — Fintraffic Digitraffic AIS (2026-11-24)

- [x] Finland's official keyless AIS feed (CC BY 4.0): every vessel its coastal receivers hear, plus its vessel database (type, name, IMO, destination); one fetch per run shared by both AIS sources and merged with the aisstream.io window — v0.76.0
- [x] Sanctioned-ship check, cable watch and the SHIPS layer keep working on the Finnish feed when aisstream fails; aisstream failures still counted and logged — v0.76.0
- [x] Ships going dark: a tanker heard every run that stops while still at sea — v0.77.0 (Phase 40)
- [ ] Norway's open AIS (Kystverket) for the North Sea and Barents, if its terms allow

## Phase 40 — Ships going dark (2026-11-24)

From the feature audit (category 2 item 4).

- [x] Tankers and cargo ships that stop broadcasting AIS at sea in Finnish coverage: after 3+ runs of steady contact, under way (2 kn+, not anchored, moored or aground), more than 15 km from a port, silent 1–6 h, with other ships still heard near the last and the projected position; a second record when they return (gap, distance) — v0.77.0
- [x] DARK rings at the last known position (thicker for sanctioned ships), legend count, records, experimental indicator (catalog v25) — v0.77.0
- [x] Port list for FI, SE, DK, DE, NO (Wikidata) used by the dark-ship check and the cable watch — v0.77.0
- [ ] Learn how often each receiver area drops out, to tell outages from ships going dark

## Phase 41 — Tanker traffic levels (2026-11-24)

- [x] Tankers present per Gulf of Finland zone (Primorsk and Vyborg, Ust-Luga, whole gulf) each run from the Fintraffic feed, moving and at anchor, hourly for 60 days — v0.78.0
- [x] Last 24 hours against the zone's earlier days (7+ needed): SURGE or DROP records and an experimental indicator (catalog v26); panel on the Eastern Europe region page — v0.78.0

## Phase 42 — Signal convergence (2026-11-24)

- [x] Located records sorted into signal types (GPS interference, aircraft patterns and emergencies, ships going dark, cable loitering, tanker level changes, navigational warnings, earthquakes M4+, fire clusters, located military or unrest reports) as anomalies, with military flights, sanctioned ships and medium GPS interference as context — v0.79.0
- [x] Hotspots: anomalies of 2+ types from 2+ independent feeds within 150 km in 72 h (WATCH), 3+ feeds (STRONG); computed each run into the layers document — v0.79.0
- [x] CONVERGE map layer (rings, feed-count markers, card listing every signal), legend, region page panel with links to the map — v0.79.0
- [ ] Learn which places are always busy (standing jamming, sea lanes) once there are weeks of hotspots, and mark chronic ones
- [x] Country-level convergence (routing hijacks and leaks, DDoS, outages, censorship, travel advice, market swings, launches, outbreaks, plus located anomalies) over 48 h — v0.80.0
- [x] New and upgraded hotspots become records (source watchtower-convergence), with a 24 h memory; rule builder presets NEW STRONG CONVERGENCE and ANY NEW CONVERGENCE — v0.80.0
- [ ] An indicator for convergence records once there is history
- [ ] Norway's AIS (BarentsWatch, needs the owner's free client registration; Kystverket's raw stream did not accept connections from the operator's machine or GitHub runners on 2026-11-24)

## Phase 43 — Competing hypotheses (2026-11-24)

- [x] Dossier board: up to 8 explanations, each record marked CC / C / N / I / II against each with a one-line reason — v0.81.0
- [x] Ranking by the evidence against each explanation, one origin (credited agency, else source) counted once; weak evidence counted separately; the ranking recomputed from confirmed evidence only, with a warning when the leader changes; records that do not help choose flagged — v0.81.0
- [x] Board in the Markdown export; a convergence record added to a dossier brings the records behind it — v0.81.0
- [ ] Weight marks by relevance as well as credibility (Heuer's optional step)
- [ ] Suggest evidence to look for: what would most separate the top two explanations

