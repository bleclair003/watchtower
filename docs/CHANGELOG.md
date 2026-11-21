# Changelog

## [0.18.0] — 2026-11-21 — Chokepoint traffic (IMF PortWatch)

### Added
- Source 27, **IMF PortWatch daily chokepoint transits** for the Strait of Hormuz, Bab el-Mandeb, Suez Canal, Bosporus, Taiwan Strait and Malacca Strait. One small query a day; the 2025 averages and chokepoint points monthly.
- Status per chokepoint from the last 7 days: **reduced** (under 70% of the 2025 average), **severely reduced** (under 40%), or **sudden drop** (40% below the previous four weeks).
- **STRAITS** map layer on the GOC: a diamond per chokepoint coloured by status and labelled with the change. The card has a 90-day trend against the 2025 average, with hover for daily counts.
- Records weekly while a chokepoint is disrupted, and once when it returns to normal.
- Catalog v8 (84 indicators): **chokepoint traffic reduced** (weight 1) and **severely reduced or falling fast** (weight 3) for the Middle East (Hormuz), Red Sea (Bab el-Mandeb), Eastern Europe (Bosporus) and Taiwan Strait.
- First run (2026-11-21): Hormuz severely reduced (2.3 ships a day vs 85.5 in 2025, −97%), Bosporus reduced (48.6 vs 92.4, −47%).

### Decided
- aisstream.io was evaluated with a real key and rejected: no coverage at any of the five chokepoints (see the source registry). The probe was removed.
- IMF terms prohibit automated bulk download without permission. The owner chose to use PortWatch anyway, with a minimal footprint and attribution; recorded in the source registry.


## [0.17.1] — 2026-11-21 — Aircraft regions by country and open water

### Fixed (found on live data)
- Aircraft records were assigned to a watch region whenever the position fell inside the region's box, and the boxes also cover neighbouring countries: an Italian C-27J over Slovakia was recorded as Eastern Europe. An aircraft now counts for a region only when it is over one of the region's countries, or over open water inside the box. Over any other country it is not recorded.
- Borders for every non-watch country added (`collector/geo/other-countries.json`, Natural Earth 1:50m, public domain, built by `scripts/build-other-countries.ts`). Somaliland counts with Somalia.
- The one stored record affected was corrected in place by `scripts/retag-aircraft.ts`, with a note; nothing was deleted.

### Limits
- Over US coastal waters an aircraft does not count for the United States region (US borders only).


## [0.17.0] — 2026-11-21 — US Navy fleet (USNI News)

### Added
- Source 26, the **USNI News Fleet and Marine Tracker** (weekly), read from the main USNI News feed, which carries the full text. Each tracker is parsed into named areas ("Arabian Sea", "Sasebo, Japan") and the ships listed in them.
- **FLEET** map layer on the GOC: a ship marker with a wide faint halo at each named area's reference point, brighter where a carrier or big-deck amphibious ship is listed, labelled with hull numbers. The card lists the ships, the tracker date and its age, and links to the article. Areas too vague to place ("Japan", "Pacific Ocean") are not drawn.
- Records when a carrier or big-deck amphibious ship appears in a new area compared with the previous tracker (about one to five a week).
- Catalog v7 (76 indicators): **US carrier or big-deck arrival** for the Middle East, Red Sea, Eastern Europe, South China Sea, Taiwan Strait and Korean Peninsula (21-day window; 1 = elevated, 2 = triggered; weight 2).
- Feed parser: reads RSS `content:encoded`.

### Limits
- Weekly and approximate: positions are up to a week old, by named area only. Some weeks are missing from the feeds. Submarines and most auxiliaries are not listed.


## [0.16.0] — 2026-11-21 — Military aircraft (ADS-B)

### Added
- Source 25, **military aircraft on ADS-B** (adsb.lol, ODbL; falls back to adsb.fi). Each collection run takes a snapshot of every aircraft the network flags as military, about 40 to 90 with a position worldwide.
- **AIR** map layer on the GOC: plane icons pointing along their track, coloured by class (tanker, surveillance/command, bomber, airlift, fighter, helicopter, other). Callsigns from regional zoom. A card shows callsign, type, altitude, speed, position age and a link to the live track. Positions older than 90 minutes are not drawn.
- Records for tankers, surveillance/command aircraft, bombers and airlift inside the watch areas: one per aircraft, area and day. Airlift is not recorded for the US, where it is constant.
- Catalog v6 (70 indicators), all experimental (weight 0): tanker/surveillance/bomber activity per region, and airlift activity per region except the US, each against a 14-day baseline.

### Limits
- Only aircraft that broadcast ADS-B are seen; many military flights do not. Coverage is thin over the Gulf, Red Sea and Taiwan Strait.
- KC-46, KC-10, A330 MRTT and E-4B share airliner type codes, so they show as "other".


## [0.15.1] — 2026-11-21 — Filter bases by operating country

### Added
- Operator filter next to BASES on the GOC map: all operators, or one country (each listed with its count, largest first). DoD sites count as US. Where Wikidata records no operator, the host country is assumed and the card says so. Former states (Soviet Union, Yugoslavia) are not listed. BASES off still hides every base. The choice is saved per device.
- Installation card: OPERATOR COUNTRY line.


## [0.15.0] — 2026-11-21 — Military installations worldwide

### Added
- 2,775 current military installations outside the US from Wikidata (CC0), drawn as rings coloured by who operates them: US-operated abroad (94 sites, e.g. Ramstein, Kadena), other foreign-operated (e.g. Russia at Khmeimim and Tartus), national or not recorded. On the GOC map and the region pages.
- Installation card for worldwide sites: type, host country, operators (may include former), Wikipedia/Wikidata/OpenStreetMap links, related records.
- `scripts/build-installations-world.ts` (one query per class; the endpoint times out on a single query).

### Changed
- Installation markers fade when zoomed out. Short-name matching now uses the host country (was US-only), and knows international base names ("Air Base", "RAF").


## [0.14.0] — 2026-11-21 — Military installations (United States)

### Added
- BASES map layer: 831 US military installations from the DoD MIRTA dataset (2024, CC BY 4.0), coloured by branch, faded when inactive, labelled when zoomed in. Also on the USA region page.
- Installation card: dataset facts, FAA flight restrictions and WATCHTOWER records that name it or lie within 50 km, each with the reason; Wikipedia and OpenStreetMap links.
- `scripts/build-installations.ts` rebuilds the data file from the official source.

### Fixed (found while checking real data)
- Short-name matching would have linked "Clear", "Hill", "March" and "Hawaii" to unrelated stories, and English "Norfolk" to Naval Station Norfolk. Short names now count only in US records, and common words, surnames and big-city names are excluded.


## [0.13.0] — 2026-11-21 — United States (domestic) watch

### Added
- Eighth watch region, United States (domestic): events inside the US, with emphasis on the military and homeland security. A bare "US" in a headline never counts; US places, US-based sources and US borders do. US bases abroad map to their host countries.
- 9 sources (24 total): FAA security/VIP flight restrictions, DHS NTAS, FEMA declarations, NWS Extreme alerts, Air Force and Marine Corps news, Military Times, Defense News, NPR National; BBC US & Canada feed.
- Catalog v5 (57 indicators): NTAS advisory, military-installation incident (2 independent sources to trigger), National Guard deployment, security flight-restriction burst, major disaster.
- Region page: a States panel for the US.

### Fixed (found on live data)
- A Central/South America trip and a US base in Japan (Kadena) were first counted as domestic.


## [0.12.0] — 2026-11-21 — Region pages

### Added
- REGIONS index and one page per watch region: RAI with 24 h change and score breakdown in RAI points, recent RAI runs, every region indicator, a 7-day map, latest relevant reports grouped as stories, countries and categories. Linked from the GOC watchlist and the `REGION <code>` command. No extra database reads.
- OPINION tag on opinion columns (feed and region pages); the daily brief already excludes them.


## [0.11.0] — 2026-11-21 — Daily brief

### Added
- Daily brief to Discord: RAI and 24 h change, active indicators, notable official warnings, top stories (multi-source first, opinion and off-topic excluded), collector health. Sent once a day at/after 11:00 UTC, with retries; deterministic and source-linked.
- Collect workflow: `send_brief` option for a manual test send; dashboard URL for links in Discord messages.
- Dry runs print the brief.


## [0.10.2] — 2026-11-21 — Relevant topics only

### Changed
- News items are now shown only when their headline is about a relevant topic: security, politics, law and rights, humanitarian, economy and energy, disasters. Previously only sport, entertainment and similar pieces were hidden. Watch regions do not decide relevance. 17 of 78 live news items were hidden on the first check.


## [0.10.1] — 2026-11-21 — Off-topic news hidden

### Added
- Sport, entertainment, arts, science and lifestyle news items are marked OFF-TOPIC and hidden by default in the feed, the map, the region report counts and SITREP. A feed toggle shows them, with the reason on each. Security stories, watch-region stories and classified topics are never hidden.


## [0.10.0] — 2026-11-21 — Stories

### Added
- Stories: the feed groups reports of the same event from different headline feeds into one entry. It shows the publishers, a corroboration label (1 publisher / N publishers / official included), the shared words that grouped them, and every report with its link. A STORIES ON/OFF toggle switches back to all items. Computed in the browser, so it costs no Firestore reads.
- Checked against live headlines: page-template groups from one official publisher, and place-name-only matches, were found and excluded.


## [0.9.4] — 2026-11-21 — Firestore read cost

### Fixed
- Each run re-read every event from the last 31 days (up to 2,000, and truncated beyond that). With 15 sources, hourly collection would have exceeded the Spark free tier of 50,000 reads/day within about 2–3 weeks, and the cap would have cut baselines short. The collector now keeps a day-bucket cache (`eventDays`): ~45 reads per steady run, measured on the emulator, with no cap.
- New-item checks read only ids outside the cache.

### Added
- Each run logs its Firestore document reads.

### Changed
- Collection every 30 minutes (external scheduler at :00 and :30); GitHub fallback every 6 hours at minute 15.


## [0.9.3] — 2026-11-21 — Health check fixes

### Fixed
- GitHub's schedule skipped five hourly collections in a row. Collect can now be started hourly by an external scheduler (workflow_dispatch with `trigger: schedule`); GitHub's cron is a 4-hourly fallback.
- IODA: outages seen only on the Google Transparency Report signal are no longer imported (multi-day false "outages" in Finland and Norfolk Island).
- Outage and fire-cluster titles include their start date, so repeated events for one country are distinguishable.


## [0.9.2] — 2026-11-20 — Cloudflare Radar live

### Fixed
- First live Radar run (15 outages): 8 had no location because network-scoped outages keep their country in the network details; 3 of those were attributed to military action. Countries now come from both places.
- Links to Cloudflare's internal tracker are replaced by the public Outage Center page.

### Added
- Revisable sources: a source can declare that it edits items after publication. Changed records are rewritten in place, keeping the original `collectedAt` and adding `metadata.revisedAt`. Cloudflare Radar uses this.


## [0.9.1] — 2026-11-20 — FIRMS live; country check

### Fixed
- First live FIRMS run (12,373 detections → 15 new clusters): 9 "Korea" clusters were in north-east China, plus one each in Sudan and Turkey, because watch areas are rectangles. Clusters are now kept only inside the region's own countries (Natural Earth 1:50m borders, collector-only), and carry a country code. The 15 stored records were re-tagged in place, with a correction note; none deleted.


## [0.9.0] — 2026-11-21 — Free-key sources

### Added
- NASA FIRMS adapter: new satellite fire clusters (novelty filter removes gas flares and continuing fires).
- Cloudflare Radar adapter: analyst-annotated internet outages with an attributed cause.
- Catalog v4 (48 indicators): attributed shutdown or military-action outage per region; experimental new-fire-cluster volume.
- Secret registry: API keys come only from the environment and are redacted from errors and logs. Sources without a key are skipped as NOT CONFIGURED.

### Rejected
- ACLED: no API on personal accounts; the EULA excludes this kind of dashboard use.


## [0.8.0] — 2026-11-20 — Source expansion

### Added
- 10 collectors (13 total): UK FCDO travel advice, USGS earthquakes, GDACS, IODA internet outages, U.S. DoD news, UK MOD, IAEA, UN News, BBC World (4 feeds), Al Jazeera.
- Generic RSS/Atom adapter; headline gazetteer and keyword topic classifier, with the basis recorded on every record; `general` news category.
- First exact-coordinate records on the map (USGS, GDACS).
- Indicator catalog v3 (36 indicators): FCDO updates and IODA connectivity drops per region, Korea non-earthquake seismic events, experimental media conflict-reporting volume.
- `collector/inspect.ts`: shows how live items would be tagged, without writing anything.

### Changed
- The dashboard snapshot holds 700 events (was 400). Summaries in the snapshot are cut to 280 characters; full text stays in the archive.

### Fixed
- Atom summaries in XHTML form (GOV.UK) were read as empty.

## [0.7.0] — 2026-11-20 — Phase 7: Refinement & deployment

### Added
- Deployed to Firebase Hosting (https://watchtower-b9b2a.web.app) with CSP, HSTS, Permissions-Policy, COOP and cache headers.
- Playwright end-to-end suite: 57 tests (every module, key flows, mobile, CSP violations, axe WCAG A/AA). Runs in CI.
- Skip-to-content link; module error boundary; one-time reload when a chunk from an older deploy is missing.

### Changed
- Route modules are code-split: first-load JavaScript falls from 469 KB to 285 KB (144 KB to 91 KB gzipped).
- `fg-dim` and `inactive` text colours lightened to meet WCAG AA contrast (4.6:1 or better).

### Security
- SITREP and dossier Markdown exports collapse and escape source text, and say that quoted source text is data, not instructions. This guards against prompt injection from feed content when an export is pasted into an AI assistant.


## [0.6.0] — 2026-11-20 — Phase 6: Advanced analysis

### Added
- SITREP generator: deterministic, eight sections, source-linked, backfill separated, limitations; Markdown "Export Intelligence Context".
- Historical Operations Replay: hindsight-safe (collectedAt ≤ T), re-runs the indicator engine per frame, LATE tags, hidden-by-default hindsight panel with later outcomes.
- Signal Lab: record-volume and RAI-history charts, backtesting against dossier outcomes (lead times, misses, false alarms, co-activation, data sufficiency), experimental research records.
- Collector writes one `raiHistory` point per run; owner-read-only security rule and test.
- Catalog v2: research metadata for experimental signals; new experimental "State Dept advisory tempo (global)".
- Bounded archive service with read counts and truncation reporting.

### Fixed (found during verification)
- Replay and backtest windows rounded the end down to the hour, excluding the most recent collection.
- Charts scaled text with the container; they now draw at real pixel width.


## [0.5.0] — 2026-11-20 — Phase 5: Incident dossiers

### Added
- Incident model (`shared/domain/incidents/`): denormalized evidence records, operator assessments, notes, linked dossiers, attached indicators; full validation.
- Three-clock timeline (occurred / published / collected) with flagged fallbacks and reporting/collection lags.
- Deterministic, explainable related-record suggestions.
- Markdown evidence-packet export with analytical caveats.
- UI: dossier index, dossier workspace (draft + save, discard, unsaved-changes guard, conflict reload), + DOSSIER on feed items.
- Security rules for `incidents`: owner-only, shape/size limits, `version` must increase by exactly 1, `createdAt` immutable; emulator tests.

### Fixed
- Suggestions no longer link records on advisory boilerplate ("Do Not Travel").


## [0.4.0] — 2026-11-20 — Phase 4: Alerting

### Added
- Alert rule model and validation (`shared/domain/alerts/`): event, indicator-state and RAI-crossing triggers; edge-based evaluation; first-look semantics for new rules; browser test mode.
- Collector alert stage: deterministic alert ids, write-before-notify, per-rule cooldown, one Discord message per rule per run, delivery outcome recorded, failures reported (exit 2).
- Discord delivery: strict webhook URL validation, markdown/mention neutralization, `allowed_mentions` empty, single 429 retry, URL never logged.
- UI: Alert Center (inbox with ack/dismiss, rules list, graphical rule builder with JSON mode and live validation), top-bar open-alert counter, alert delivery status in status strip and Diagnostics.
- Workflows: `DISCORD_WEBHOOK_URL` passed to Collect; new *Test alert delivery* workflow.
- Security rules for `alertRules` (shape-validated owner writes), `alerts` (ack/dismiss only), `collectorState` (hidden) with emulator tests.

### Fixed
- Relative ages no longer show "+<1m" for timestamps a few seconds ahead of a stale clock.


## [0.3.0] — 2026-11-20 — Phase 3: Indicator & Warning Engine

### Added
- Declarative condition language with allow-listed fields and own-property lookups (`shared/domain/indicators/conditions.ts`).
- Deterministic indicator evaluator with source-health gating (UNKNOWN / DATA_UNAVAILABLE), windows, distinct-source corroboration, baselines with history-sufficiency checks, evidence capture, and state continuity.
- Regional Activity Index v0: coverage, per-source cap (60%), severity weighting, bands, 24 h change from recorded history, full breakdown.
- Catalog v1 (16 indicators) built only on sources actually collected; Pentagon Pizza Index kept as experimental with NO DATA.
- Collector evaluates after every run (one events query feeds both evaluation and snapshot), logs transitions to `indicatorHistory`, supports `--evaluate-only`; snapshot schema v2.
- UI: Indicators page (thresholds, baselines, conditions, evidence links, experimental section, browser preview), RAI and breakdown in the watchlist, evidence tags in the feed, live indicator status.
- `firstSuccessAt` on source status.

### Fixed
- CISA "Adds N KEV to Catalog" announcements were counted as non-routine alerts, double-counting KEV evidence; now classified `kev-announcement` and excluded.
- Guidance documents (`/resources-tools/`) classified as `guidance` (routine).


## [0.2.0] — 2026-11-20 — Phase 2: live collection

### Added
- Collector (`collector/`) on Node 24 type-stripping: polite HTTP client, entity-safe RSS/Atom parser, RFC-822 date parser, sanitization, validation gate, content-hash idempotency.
- Adapters: State Dept travel advisories (level-change detection, FIPS→ISO mapping), CISA advisories, CISA KEV.
- Firestore store (Admin SDK) and in-memory store; dashboard snapshot (1 read per dashboard load).
- GitHub Actions workflows: hourly `Collect`, `CI`, and `Grant owner`.
- Browser: lazy-loaded Firebase SDK, Google sign-in with popup→redirect fallback, owner custom-claim gate, Firestore repository, auto-refresh, live source health, OVERDUE detection, real Diagnostics, feed badges (LEVEL ▲/▼, ROUTINE, RANSOMWARE).
- Firestore security rules (owner claim, read-only collected data) with emulator tests.
- Emulator workflow scripts: `emulators`, `collect:emulator`, `dev:emulator`, `grant-owner:emulator`.

### Verified
- Real sources → emulator: 2,034 items fetched and 75 imported; a second run imported 0 (30 duplicates suppressed, KEV returned 304).
- 69 unit/component tests and 6 rules tests pass; the production dependency audit is clean.

### Known limitations
- The production project is not connected yet (operator steps in DEPLOYMENT.md §2).
- `firebase-tools` (dev-only CLI) carries 13 moderate transitive advisories; none of it ships to the browser or the collector.

## [0.1.0] — 2026-11-20 — Phase 0 + Phase 1 (demo data)

### Added
- Vite 8 + React 19 + TypeScript (strict) + Tailwind CSS 4 project.
- Shared domain model: events (with `dataOrigin`, `sourceClass`, required `locationPrecision`), regions, sources, indicators, collection runs.
- Source registry with live feasibility probes for 18 candidate sources.
- Global Operations Center: regional watchlist, MapLibre world map (OpenFreeMap, recoloured), intelligence feed with provenance, filters, system status strip.
- Command console with autocomplete (`/` to focus).
- Source Directory, Diagnostics and Settings pages; retro effects with reduced-motion support.
- Clearly labelled demonstration dataset (29 fictional records).
- 31 unit / component tests.
- Documentation set and Firebase config scaffolding (rules, indexes, hosting).

### Known limitations
- No live collection, indicators, RAI or alerts yet; the UI labels each as not deployed.
- Map is not covered by automated tests (WebGL).
