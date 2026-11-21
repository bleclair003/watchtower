# Changelog

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
