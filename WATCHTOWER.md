---
tags: [watchtower, home]
version: 0.9.2
updated: 2026-11-21
---

# WATCHTOWER — vault home

Personal OSINT early-warning console. **Live:** https://watchtower-hq.web.app (owner sign-in) · **Repo:** github.com/bleclair003/watchtower (public since 2026-11-21) · **Collection:** hourly GitHub Actions run.

This folder is both the git repository and the Obsidian vault. Notes and code live side by side; code files show in the file explorer (they open in your editor). Build output and `node_modules` are excluded from search and the graph.

## Current status (v0.9.2)

- All planned phases (0–7) done, plus source expansion (8) and free-key sources (9).
- **15 live sources:** State Dept, CISA advisories, CISA KEV, UK FCDO, USGS, GDACS, IODA, Cloudflare Radar, NASA FIRMS, U.S. DoD, UK MOD, IAEA, UN News, BBC World, Al Jazeera.
- **48 indicators** (catalog v4), RAI per watch region.
- Backtests become meaningful after ~90 days of collection (around February 2027).
- Blocked or rejected: GDELT (429), NGA MSI (503), NATO (404), MARAD (403), ReliefWeb (needs appname), ACLED (licence) — see [[docs/SOURCE_REGISTRY|Source registry]].

## Notes

| Note | What it covers |
|---|---|
| [[docs/PROJECT_OVERVIEW\|Project overview]] | Purpose, principles, doc index |
| [[docs/DEVELOPMENT_ROADMAP\|Roadmap]] | Phase checklist and open items |
| [[docs/CHANGELOG\|Changelog]] | What changed in each version |
| [[docs/ARCHITECTURE\|Architecture]] | How the pieces fit together |
| [[docs/SOURCE_REGISTRY\|Source registry]] | Every source, feasibility, caveats, gazetteer |
| [[docs/DATA_MODEL\|Data model]] | Firestore collections and record fields |
| [[docs/INDICATOR_ENGINE\|Indicator engine]] | Indicators, catalog, RAI |
| [[docs/ALERTING\|Alerting]] | Rules, inbox, Discord |
| [[docs/DOSSIERS\|Dossiers]] | Incident dossiers |
| [[docs/ANALYSIS\|Analysis]] | SITREP, Replay, Signal Lab |
| [[docs/DESIGN_SYSTEM\|Design system]] | Look and feel, tokens |
| [[docs/SECURITY_AND_ACCESSIBILITY\|Security & accessibility]] | Threat model, findings, a11y |
| [[docs/TESTING\|Testing]] | Test commands and coverage |
| [[docs/DEPLOYMENT\|Deployment]] | Free-tier setup, hosting, secrets |
| [[README]] | Repository readme |

## Code map

| Folder | What lives there |
|---|---|
| `src/` | The dashboard (React). `pages/` one file per module, `components/`, `data/` (Firestore access), `state/`, `config/` |
| `shared/domain/` | Logic shared by dashboard and collector: types, regions, sources, `indicators/`, `alerts/`, `incidents/`, `history/`, `geo/gazetteer.ts` |
| `collector/` | Hourly collector: `adapters/` (one per source), `lib/` (fetch, parsing, topic classifier, secrets), `store/`, `geo/` (country borders) |
| `collector/test/`, `src/**/*.test.tsx` | Unit tests (182) |
| `e2e/` | Browser tests (57, Playwright) |
| `rules-tests/`, `firestore.rules` | Database security rules and their tests |
| `scripts/` | One-off admin scripts (grant owner, data corrections) |
| `.github/workflows/` | CI, hourly Collect, Grant owner, Test alert |

## Everyday commands

```powershell
npm run dev            # dashboard on demo data
npm test               # unit tests
npm run test:e2e       # browser tests
npm run collect:dry    # fetch every source, write nothing
node collector/inspect.ts bbc-world   # how live items would be tagged
```

## Secrets — never in this vault

The Firebase service-account key lives outside the repo (`%USERPROFILE%\.watchtower\`). API keys and the Discord webhook are GitHub Actions secrets only. `.env.local` holds the public web config and is git-ignored. If you enable Obsidian Sync for this vault, keep it to notes only.
