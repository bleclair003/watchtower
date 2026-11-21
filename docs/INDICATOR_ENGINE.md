# Indicator & Warning Engine (IWE)

**Status: implemented (Phase 3, catalog v1).** Code: [`shared/domain/indicators/`](../shared/domain/indicators/). The same module runs in the collector, which records the official state, and in the browser, which runs it for demo mode and for the "Evaluate now — preview" button.

## Principles

1. **Deterministic and declarative.** An indicator is JSON: a condition, a window and thresholds. There is no AI and no executable code. The same inputs always give the same state.
2. **Absence of data is not evidence of calm.** If a required source has never been collected, the result is `DATA_UNAVAILABLE`. If a source is OFFLINE or STALE, it is `UNKNOWN`. Neither is ever `NORMAL`, and both lower RAI *coverage* instead of lowering the score.
3. **Every state is explainable.** Each evaluation records its matched count, its effective thresholds, its baseline status, a plain-language reason and up to 25 evidence event ids.
4. **Every state change is logged** in `indicatorHistory` for Phase 6 backtesting.
5. **Experimental signals are quarantined.** They have weight 0 by rule, never feed the RAI, and are shown under *Experimental signals — unvalidated*.

## Evaluation

For each indicator, at time `now`:

1. **Gate on source health.** Each required source must have succeeded at least once and must not be OFFLINE or STALE.
2. **Match.** Select events matching the condition, de-duplicated by content hash. Each is dated by `publishedAt`, falling back to `collectedAt`.
3. **Count.** Count matches in `(now − window, now]`, along with the number of distinct sources.
4. **Baseline (optional).** Compute the mean matches per window over the preceding `days`. The baseline counts as *sufficient* only when the source's complete history (first success minus the 30-day first-run backfill) reaches back that far. When sufficient, the effective thresholds become `max(fixed, ceil(ratio × mean))`. Otherwise the fixed thresholds apply and the reason says "Baseline not applied".
5. **State.**
   - `TRIGGERED` if count ≥ trigger threshold and distinct sources ≥ the required number.
   - Otherwise `ELEVATED` if count ≥ elevated threshold.
   - Otherwise `NORMAL`.

`stateSince` and `lastTriggeredAt` are carried over from the previous run's snapshot.

## Condition language

```jsonc
{ "all": [
    { "field": "sourceId", "op": "eq", "value": "cisa-advisories" },
    { "field": "metadata.subtype", "op": "in", "value": ["alert", "joint-advisory", "analysis-report"] },
    { "not": { "field": "title", "op": "contains", "value": "Known Exploited Vulnerabilit" } }
] }
```

- **Groups:** `all`, `any`, `not`, nesting at most 6 deep.
- **Operators:** `eq`, `neq`, `in`, `contains`, `gte`, `lte`, `exists`. String comparison is case-insensitive, and array fields match if any element matches.
- **Fields:** an allow-list (`CONDITION_FIELDS`) of event properties and selected `metadata.*` keys. Lookups are own-property only, so inherited names such as `constructor` are rejected; this is tested.
- `validateCondition()` and `validateCatalog()` reject malformed definitions, and the catalog is validated in CI.

## Catalog v9 (96 indicators)

| Region | Indicator | Window | Elevated / Triggered | Baseline | Weight · Severity |
|---|---|---|---|---|---|
| each of 6 geographic regions | Travel advisory **raised** (State Dept) | 7 d | 1 / 1 | — | 3 · high |
| each of 6 geographic regions | Advisory publication **burst** (State Dept) | 72 h | 2 / 4 | 28 d, ×2 / ×3 | 2 · medium |
| Global cyber | KEV addition surge | 72 h | 4 / 8 | 28 d, ×1.5 / ×2.5 | 2 · medium |
| Global cyber | Ransomware-linked KEV additions | 7 d | 1 / 3 | — | 2 · high |
| Global cyber | Non-routine CISA advisories (alerts, joint advisories, analysis reports; excludes KEV announcements and guidance) | 72 h | 1 / 3 | — | 2 · medium |
| each of 6 geographic regions | UK FCDO travel advice updates (v3) | 72 h | 2 / 4 | 28 d, ×2 / ×3 | 1 · medium |
| each of 6 geographic regions | Internet connectivity drop ≥ 4 h, IODA (v3) | 48 h | 1 / 3 | 28 d, ×2 / ×3 | 2 · medium |
| Korean Peninsula | USGS seismic event typed as something other than "earthquake" (v3) | 7 d | 1 / 1 | — | 3 · high |
| each of 6 geographic regions, experimental | Media conflict-reporting volume: BBC + Al Jazeera military-topic headlines, ≥ 2 outlets (v3) | 24 h | 4 / 8 | 28 d, ×2 / ×3 | 0 · never in the RAI |
| each of 6 geographic regions | Outage attributed by Cloudflare to a government-directed shutdown or military action (v4) | 7 d | 1 / 1 | — | 3 · high |
| each of 6 geographic regions, experimental | New NASA FIRMS fire clusters (v4) | 24 h | 5 / 12 | 28 d, ×2 / ×3 | 0 · never in the RAI |
| United States (v5) | NTAS terrorism advisory | 30 d | 1 / 1 | — | 3 · high |
| United States (v5) | Military-installation incident: US-tagged headline with an incident word *and* a military word | 72 h | 1 / 2 (≥ 2 sources) | — | 3 · high |
| United States (v5) | National Guard deployment / activation / federalisation | 7 d | 1 / 3 | — | 2 · medium |
| United States (v5) | FAA SECURITY flight restrictions | 72 h | 5 / 10 | 28 d, ×2 / ×3 | 2 · medium |
| United States (v5) | FEMA major disaster or NWS Extreme alert | 72 h | 1 / 3 | — | 1 · medium |
| each of 7 geographic regions, experimental (v6) | Tankers, surveillance/command aircraft and bombers seen on ADS-B (each aircraft once a day) | 24 h | 3 / 6 | 14 d, ×2 / ×3 | 0 · never in the RAI |
| each of 6 geographic regions (not the US), experimental (v6) | Military airlift seen on ADS-B | 24 h | 4 / 8 | 14 d, ×2 / ×3 | 0 · never in the RAI |
| Middle East, Red Sea, Eastern Europe, South China Sea, Taiwan Strait, Korean Peninsula (v7) | US carrier or big-deck amphibious ship newly listed in the region's sea areas by the USNI News Fleet Tracker | 21 d | 1 / 2 | — | 2 · medium |
| Middle East, Red Sea, Eastern Europe, Taiwan Strait (v8) | Chokepoint traffic reduced: 7-day transits under 70% of the 2025 average (IMF PortWatch; Hormuz, Bab el-Mandeb, Bosporus, Taiwan Strait) | 8 d | 1 / 2 | — | 1 · medium |
| Middle East, Red Sea, Eastern Europe, Taiwan Strait (v8) | Chokepoint traffic severely reduced (under 40%) or 40% below the previous four weeks | 8 d | 1 / 1 | — | 3 · high |
| each of 6 foreign geographic regions (v9) | New sanctions designations (OFAC, EU, UK batches targeting or linked to the region) | 7 d | 2 / 4 | 28 d, ×2 / ×3 | 1 · medium |
| each of 6 foreign geographic regions (v9) | Large sanctions package: one batch of 25+ designations | 7 d | 1 / 1 | — | 2 · medium |
| Experimental | State Dept advisory tempo (global) | 72 h | 6 / 12 | 28 d | 0 |
| Experimental | Pentagon Pizza Index | — | — | — | 0 · always NO DATA |

**v3 note:** connectivity drops have known innocent causes (power cuts, cable faults, exam-season shutdowns in Iraq and Syria), so they are weighted as corroborating evidence. Media volume is experimental because topic and region come from headline keywords.

**v5 note:** State Dept advisory and FIRMS indicators are not generated for the United States (no US advisories; FIRMS not collected there). UK FCDO, IODA, Cloudflare and media indicators do apply.

All thresholds are **initial engineering judgements, not empirically validated**. Phase 6 backtesting exists to revise them. To change a definition, bump its `configVersion` and `CATALOG_VERSION`.

**Duplicate-evidence fix (found during verification):** CISA's "Adds N Known Exploited Vulnerabilities to Catalog" alerts announce the same KEV additions the KEV indicators already count. They are now classified as `kev-announcement` (routine) and excluded from the non-routine indicator, both by subtype and by title so that records stored earlier are covered too.

## Regional Activity Index (RAI) v0

```
max      = Σ weight × severityMultiplier                over evaluable indicators
points_i = weight_i × severityMultiplier_i × stateFactor_i
RAI      = round(100 × Σ capped points / max)
```

- `severityMultiplier`: low 1, medium 1.5, high 2.
- `stateFactor`: TRIGGERED 1, ELEVATED 0.4, NORMAL 0.
- **Evaluable** means NORMAL, ELEVATED or TRIGGERED. **Coverage** is evaluable indicators ÷ the region's enabled non-experimental indicators, and is always shown next to the score. With zero coverage the RAI is `N/E`, never 0.
- **Per-source cap:** indicators sharing a primary source contribute at most 60% of `max`. A region informed only by the State Dept therefore cannot exceed 60 (*Significant*) on that source alone.
- **Bands:** 0–19 Baseline, 20–39 Increased, 40–59 Elevated, 60–79 Significant, 80–100 Exceptional. These are display conventions only.
- **24 h change** uses the stored score-history point closest to now − 24 h, within ±4 h. If no such point exists it shows "—", never an invented figure.

**The RAI is not a probability of war, attack or any event.** It measures unusual activity in the sources WATCHTOWER monitors.

## Operations

- The collector evaluates after every run. Run `node collector/run.ts --evaluate-only` (or `npm run collect:emulator -- --evaluate-only`) to re-evaluate stored data without fetching.
- An engine failure is recorded on the run as `indicator-engine`, the previous states are kept, and the job exits with code 2. The snapshot with fresh events is still written.
- Cost: one events query per run (at most 2,000 docs, collected in the last 31+ days), one snapshot read, and one write per state change.

## Not yet built

- An operator UI for editing indicators. This is planned together with the Phase 4 alert-rule builder, which uses the same condition language.
- Recency decay inside a window.
- Story clustering to recognize syndicated copies across sources. Today only identical content is de-duplicated.
