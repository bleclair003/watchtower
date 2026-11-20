# Changelog

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
