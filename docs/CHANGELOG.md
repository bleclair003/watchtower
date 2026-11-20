# Changelog

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
