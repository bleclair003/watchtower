# Testing

```bash
npm test            # app + collector unit/component tests (no emulator needed)
npm run test:rules  # Firestore security rules against the emulator (needs Java 21)
npm run typecheck   # tsc -b (app, collector, scripts, rules tests)
npm run build       # typecheck + production build
npm run collect:dry # live end-to-end fetch/parse of real sources; writes nothing
npm run test:e2e    # Playwright: builds in demo mode, serves with the production headers, runs the browser suite
```

Locally the E2E suite uses the installed Microsoft Edge (`channel: 'msedge'`); CI installs Playwright's Chromium.

## Current coverage (172 unit/component + 11 rules + 57 end-to-end tests, all passing)

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
| `shared/domain/history/history.test.ts` | Hindsight rule (collected vs published), status reconstruction, replay before collection, episodes / hits / lead times / misses / false alarms, co-activation, step simulation without retroactive data, data sufficiency, bucket counts, SITREP sections / backfill separation / citations / Markdown |
| `src/pages/history.test.tsx` | SITREP generation in demo mode; Signal Lab experimental research records |
| `collector/test/expansion.test.ts` | v0.8 sources on real feed snapshots: gazetteer (longest match, case-sensitive abbreviations, ambiguous names skipped, seas and straits), topic classifier (figurative "coup"), BBC feed merge and de-duplication with no coordinates, IAEA dates, FCDO country mapping and XHTML change notes, USGS exact points and regions by box, the Korea non-earthquake indicator, GDACS level filtering and escalation ids, IODA duration threshold and wording, catalog v3 validity |
| `src/lib/sourceHealth.test.ts` | View-time health recomputation (ONLINE → STALE), overdue detection |
| `collector/test/lib.test.ts` | HTML/entity sanitization, bidi/control stripping, URL allowlist, RFC-822 dates (two-digit year, date-only, invalid), RSS/Atom parsing on **real feed fixtures**, refusal of entity declarations, **every observed FIPS tag** cross-checked against CLDR country names, polite fetch (conditional headers, 304, 429/5xx backoff, no 4xx retry, size cap), hashing, health rules |
| `collector/test/adapters.test.ts` | State Dept first-run baseline and lookback, no-change runs, RAISED/LOWERED/reissued detection, Gaza→PS, 304 handling; CISA subtypes and lookback; KEV window, ransomware flag, malformed JSON |
| `collector/test/pipeline.test.ts` | Idempotency, in-batch dedupe, validation gate (javascript: URLs, demo origin, coordinates on country precision, bad region/country codes), failure isolation, OFFLINE escalation and recovery, secret redaction, snapshot size cap |
| `rules-tests/firestore.rules.test.ts` | Owner read access; denial for anonymous, non-owner and spoofed-claim users; no client writes to collected data; `sourceState` hidden; per-user settings; default deny |
| `src/components/goc/components.test.tsx` | Feed DEMO tags and "no original source" message, empty state, watchlist never shows a fabricated RAI, command console drives filters and navigation and reports unbuilt modules |

### End-to-end (`e2e/`)

| File | What it checks |
|---|---|
| `smoke.spec.ts` | Every module loads with no page errors, console errors or CSP violations, always shows the demo banner, and has no sideways scroll, on desktop and on a phone viewport (Pixel 7) |
| `flows.spec.ts` | Navigation and `aria-current`; `/` focuses the command console, and commands navigate; not-found recovery; SITREP builds all 8 sections plus limitations; external links are http(s) with `noopener noreferrer`; security headers present; skip link moves focus to the content |
| `a11y.spec.ts` | axe-core WCAG 2.1 A/AA on every module (the map canvas excluded; the feed carries the same data) |

## Not covered yet

- Map tile rendering is not asserted in E2E: tiles come from OpenFreeMap, and the tests must not depend on a third party. The map was verified manually.
- Live-mode E2E (real sign-in, real Firestore) is not automated: it would need test credentials in the production project. It was verified manually after the deploy.
- Google popup sign-in against the real project (needs operator setup). Emulator email/password sign-in, owner gating, and the full collector → Firestore → dashboard path were verified manually on 2026-11-20.

Mutation checks: mapping FIPS `RS` to Serbia makes the FIPS test fail, and allowing owner writes to `events` makes the rules test fail.
