# Testing

```bash
npm test          # vitest run (unit + component)
npm run typecheck # tsc -b
npm run build     # typecheck + production build
```

## Current coverage (31 tests, all passing)

| File | Covers |
|---|---|
| `src/lib/filters.test.ts` | Time window (incl. null `publishedAt` fallback), region / category / source / class / keyword filters, ordering, region 24 h stats |
| `src/lib/geo.test.ts` | No-invented-coordinates rule, point vs. area-level vs. unlocated split, [lon, lat] order, watch-area polygons |
| `src/lib/misc.test.ts` | Map style transform (and immutability), command parser + autocomplete, URL sanitizer, time formatting |
| `src/data/demo/demoEvents.test.ts` | Demo integrity: every record `demo`, `[SIMULATED]` prefix, no source URL, no coordinates on imprecise records, collected ≥ published; repository `since` / `limit` and `NOT_CONFIGURED` health |
| `src/components/goc/components.test.tsx` | Feed DEMO tags and "no original source" message, empty state, watchlist never shows a fabricated RAI, command console drives filters and navigation and reports unbuilt modules |

## Not covered yet

- `WorldMap` rendering (WebGL is unavailable in jsdom). It was verified manually in a browser on 2026-11-20. Playwright E2E is planned for Phase 7.
- Firestore security rules (Firebase Emulator Suite, Phase 2).
