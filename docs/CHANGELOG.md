# Changelog

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
