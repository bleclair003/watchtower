# WATCHTOWER

**WT-01 // Geopolitical Intelligence & Early Warning Platform**

A browser-based OSINT monitoring console with a command-centre interface. Every record is traceable to a public source, and source health and uncertainty are always visible. It is built to run at $0 recurring cost.

> **Status (v0.2.0):** Phases 0–2 built. Without Firebase config the dashboard runs on a **clearly labelled demo dataset**. With config it shows **live** records collected hourly from the U.S. State Department and CISA. To connect your Firebase project, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) §2.

## Quick start

Requires Node.js 20+ (developed on Node 24).

```bash
npm install
npm run dev        # http://localhost:5173
```

| Script | Purpose |
|---|---|
| `npm run dev` | Dev server with HMR |
| `npm test` | Unit + component tests (Vitest) |
| `npm run test:watch` | Tests in watch mode |
| `npm run typecheck` | TypeScript project check |
| `npm run build` | Type check + production build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm run test:rules` | Firestore security-rules tests (emulator, Java 21) |
| `npm run collect:dry` | Fetch and process real sources, write nothing |
| `npm run emulators` | Local Auth + Firestore emulators |
| `npm run collect:emulator` / `dev:emulator` | Collector / app against the emulators |
| `npm run grant-owner -- <email>` | Grant the owner claim (Admin SDK credentials required) |

## Using the console

- **`/`** focuses the command line. Try `HELP`, `WATCH REDSEA`, `MAP GLOBAL`, `FEED cisa-kev`, `SOURCES`, `STATUS`, `CLEAR`. Any other text becomes a keyword filter.
- Click a region in **Regional Watch**, or a dashed watch area on the map, to filter the feed and focus the map.
- Click a feed item to expand its provenance; the map highlights it if it has a precise location.
- **`J` / `K`** (or arrow keys) move through the feed; **`Esc`** collapses.
- **Settings** toggles scanlines, glow, flicker, map grid and watch areas.

## Documentation

Start with [docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md).

## Data & licensing

Basemap © [OpenFreeMap](https://openfreemap.org) / [OpenMapTiles](https://openmaptiles.org) / © OpenStreetMap contributors. Fonts: IBM Plex Mono and Share Tech Mono (SIL OFL).
