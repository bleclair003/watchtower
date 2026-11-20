# Testing

```bash
npm test            # app + collector unit/component tests (no emulator needed)
npm run test:rules  # Firestore security rules against the emulator (needs Java 21)
npm run typecheck   # tsc -b (app, collector, scripts, rules tests)
npm run build       # typecheck + production build
npm run collect:dry # live end-to-end fetch/parse of real sources; writes nothing
```

## Current coverage (137 unit/component + 11 rules tests, all passing)

| File | Covers |
|---|---|
| `src/lib/filters.test.ts` | Time window (incl. null `publishedAt` fallback), region / category / source / class / keyword filters, ordering, region 24 h stats |
| `src/lib/geo.test.ts` | No-invented-coordinates rule, point vs. area-level vs. unlocated split, [lon, lat] order, watch-area polygons |
| `src/lib/misc.test.ts` | Map style transform (and immutability), command parser + autocomplete, URL sanitizer, time formatting |
| `src/data/demo/demoEvents.test.ts` | Demo integrity: every record `demo`, `[SIMULATED]` prefix, no source URL, no coordinates on imprecise records, collected ≥ published; demo repository returns only demo records, `NOT_CONFIGURED` health and no collector run |
| `shared/domain/indicators/indicators.test.ts` | Condition language (operators, groups, validation, prototype-name safety), catalog validity and semantics (KEV-announcement exclusion), evaluator states incl. UNKNOWN / DATA_UNAVAILABLE, window boundaries, dedupe, corroboration, evidence cap, state continuity, baselines (applied vs insufficient history), transitions, RAI (N/E, coverage, per-source cap, experimental exclusion, bands, 24 h delta) |
| `shared/domain/alerts/alerts.test.ts` | Rule validation (incl. path-like ids, unknown fields/kinds), event / indicator / RAI edge semantics, first-look behaviour and dedupe keys, test-mode preview |
| `collector/test/alerting.test.ts` | One alert per input across runs, batching and mention neutralization, cooldown suppression and resumption, not-configured / not-requested, invalid-rule reporting, delivery failure without leaking the webhook, indicator transitions and late-created rules, Discord URL validation, 429 retry, >10-alert summary |
| `shared/domain/incidents/incidents.test.ts` | Seeding from events, no duplicate links, validation (ids, regions, self-links, notes, indicators), three-clock ordering with fallbacks and lags, explainable suggestions and stop words, Markdown export (links, caveats, non-live labelling) |
| `src/lib/sourceHealth.test.ts` | View-time health recomputation (ONLINE → STALE), overdue detection |
| `collector/test/lib.test.ts` | HTML/entity sanitization, bidi/control stripping, URL allowlist, RFC-822 dates (two-digit year, date-only, invalid), RSS/Atom parsing on **real feed fixtures**, refusal of entity declarations, **every observed FIPS tag** cross-checked against CLDR country names, polite fetch (conditional headers, 304, 429/5xx backoff, no 4xx retry, size cap), hashing, health rules |
| `collector/test/adapters.test.ts` | State Dept first-run baseline and lookback, no-change runs, RAISED/LOWERED/reissued detection, Gaza→PS, 304 handling; CISA subtypes and lookback; KEV window, ransomware flag, malformed JSON |
| `collector/test/pipeline.test.ts` | Idempotency, in-batch dedupe, validation gate (javascript: URLs, demo origin, coordinates on country precision, bad region/country codes), failure isolation, OFFLINE escalation and recovery, secret redaction, snapshot size cap |
| `rules-tests/firestore.rules.test.ts` | Owner read access; denial for anonymous, non-owner and spoofed-claim users; no client writes to collected data; `sourceState` hidden; per-user settings; default deny |
| `src/components/goc/components.test.tsx` | Feed DEMO tags and "no original source" message, empty state, watchlist never shows a fabricated RAI, command console drives filters and navigation and reports unbuilt modules |

## Not covered yet

- `WorldMap` rendering (WebGL is unavailable in jsdom). It was verified manually in a browser on 2026-11-20. Playwright E2E is planned for Phase 7.
- Google popup sign-in against the real project (needs operator setup). Emulator email/password sign-in, owner gating, and the full collector → Firestore → dashboard path were verified manually on 2026-11-20.

Mutation checks: mapping FIPS `RS` to Serbia makes the FIPS test fail, and allowing owner writes to `events` makes the rules test fail.
