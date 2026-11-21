# Meters and monitors (Phase 14, v0.35.0)

Analysis across the sources WATCHTOWER already collects. Each meter is a deterministic reading with its evidence, the date its data is from, and whether its usual level (baseline) is known yet. **No meter is a probability of conflict, attack or any other event.**

- **Code:** pure functions in [`shared/domain/meters/`](../shared/domain/meters/) — `region.ts` (1–3), `topics.ts` (4–16), `clocks.ts` (17–18), `quality.ts` (19–20), `history.ts` (21 and history), shared signal predicates in `signals.ts`.
- **Computed by the collector** every run over all records it loads (about 36 days, or since records began), after the dashboard layers are attached. About 1 second for 10,000 records.
- **Stored** in `snapshots/meters` (owner-readable, one extra read per dashboard load), apart from the dashboard snapshot so meters never crowd out the feed. A collector-only long history (`collectorState/meterHistory`, one packed point every 3 hours, 120 days) feeds the lead/lag lab.
- **Shown:** the **METERS** page (region grid, topic monitors, days-since counters, 30-day calendar, detail with evidence and a sparkline of recent runs), a **Meters** strip on every region page, and the **Lead/lag lab** in Signal Lab. Demo mode runs the same engine over the demo fixtures and labels it SIMULATED.

Levels: QUIET · LOW · GUARDED · ELEVATED · HIGH; N/A when there is no data. Meters with their own scale show it instead (rung, count, percentage).

## Baselines

Meters that compare against a usual level (buildup vs noise, air surge, the reporting drop in information blackout, cyber's usual week) withhold the comparison until **14 days** of stored history exist (21 for cyber) and say BUILDING. Records began on 2026-11-20, so these switch on around **2026-12-04**.

## The meters

| # | Meter | Scope | What counts | Level |
|---|---|---|---|---|
| 1 | Escalation ladder | each region | Rhetoric: 3+ military/diplomatic reports or a UNSC meeting (72 h). Posture: tanker/airlift/ISR/bomber sightings, a big deck present or arriving, embassy drawdown, advisory raise, US security flight restriction. Kinetic: strike headlines from 2+ publishers or 4+ from one, an outage attributed to a government or military action, a DPRK launch or test (US: hard signals only). Consequences (14 d): chokepoint severe or falling fast, currency stress | highest active rung |
| 2 | Evacuation risk | each region abroad | ordered departure 3, authorized departure or suspended operations 2, advisory raise 1, UK security-related advice updates 0.5 each (max 1), 3+ airlift sightings 1, currency stress 1 (14 d). Standing Level 4 advisories are listed, not scored | score 0.5 / 2 / 4 / 6 |
| 3 | Buildup vs noise | each region | news reports vs posture signals (72 h), each against its usual level: QUIET BUILDUP (posture ≥2×, news <1.5×), CONFIRMED SURGE (both ≥2×), NOISE (news ≥2×, posture <1.2×), IN LINE | after 14 days |
| 4 | Air surge | each region | tanker, airlift, ISR, bomber sightings (72 h) against the usual level | ratio 1.5 / 2 / 3× |
| 5 | Naval presence | global | big decks per region (USNI), strait status, sanctioned ships seen | most big decks in one region |
| 6 | Maritime risk | each chokepoint | transit status (reduced 2, severe or sudden drop 3), 2+ news reports naming it (7 d) 1, oil rise (Gulf and Red Sea routes) 1 | score |
| 7 | Sanctions pressure | global | new designations per target country, 7 and 30 days (US, EU, UK); sanctioned ships seen | most against one country: 1 / 5 / 20 / 50 |
| 8 | Arms flow | global | munitions contract dollars and FMS (7 d); BIS export rules and arms-sale challenges in Congress (30 d) | munitions $1B / $5B / $15B |
| 9 | Washington attention | global | weighted 7-day count: war powers 3, NTAS 3, national emergency 2, presidential security documents 1, terrorist designations 1, floor votes 1, security hearings 0.5 | 1 / 3 / 6 / 10 |
| 10 | Diplomatic temperature | each region | 14 days: UNSC meetings 1, divided votes 2, failed drafts or vetoes 3, US advisory raises 2, UK security advice updates 0.5 (max 2) | 0.5 / 3 / 6 / 10 |
| 11 | Strategic weapons | global | 30 days: DPRK nuclear test (HIGH), DPRK launches (ELEVATED within 7 d), military space launches by country, IAEA news on Iran/Ukraine/DPRK, nuclear cooperation actions in Congress | rule-based |
| 12 | Information blackout | each region | outages attributed to government or military action (72 h) 3, other ongoing outages 1 (max 2), records in 24 h under 40% of the usual day 2 | 1 / 2 / 3 / 5 |
| 13 | Economic stress | each region abroad | currency stress 2 each (max 4), stressed chokepoint 2, oil rise (Gulf, Red Sea) 1 | 1 / 2 / 4 / 6 |
| 14 | Humanitarian strain | each region | WHO reports (high-consequence 2), internal displacement up 20%+ on last year 2, orange/red disaster alerts, 10+ new fire clusters (7 d) 1 | 1 / 2 / 4 / 6 |
| 15 | Homeland board | US | NTAS 4, security flight restrictions 1, VIP 0.5, FEMA declarations (30 d) 1, severe weather (24 h) 0.5, ransomware-linked KEV 1 | 1 / 4 / 8 / 14 |
| 16 | Cyber weather | global | KEV additions 1 (ransomware-linked +2), non-routine CISA alerts 2, cable-cut or unexplained outages in watch regions 0.5 (7 d) | LOW / GUARDED / ELEVATED / HIGH at 10 / 20 / 35 |
| 17 | Days since | — | DPRK launch, DPRK nuclear test, UNSC meeting on Ukraine and on the Middle East, divided vote or failed draft, US carrier in the Middle East, ordered departure, Level 4 raise, government-ordered shutdown, sanctioned ship seen. Carried across runs | days |
| 18 | Coming up | — | scheduled military launches (Launch Library 2) and security-committee hearings (Congress.gov), 30 days | list |
| 19 | Corroboration | each region | share of stories (72 h; a single report is a story of one) with several publishers or an official source | % |
| 20 | Visibility | each region | share of the region's indicator sources online, data lag (USNI, PortWatch), known blind spots | % (level = blindness) |
| 22 | Pentagon after-hours (v0.36.0) | US | night (22:00–06:00 ET) defence releases (war.gov, Air Force, Marines) and night command/VIP flights on ADS-B, each against its usual level (72 h); a part needs 2+ night items | ratio 1.5 / 2 / 3× after 14 days |
| 21 | Lead/lag lab | Signal Lab | for each RAI rise (+10 within 24 h), whether each meter rose in the 72 h before, only in the 24 h after, or neither | tallies; no conclusions under 5 rises |

## Checked against real data (2026-11-21)

Every rule was run over the 634 stored records and the live snapshot, and the evidence behind each reading was read by hand. Corrections made before release:

- **Strike headlines:** the first rule counted topics ("US missile shortages", "tools to gun down drones", a power-station fire). It now needs an act of force (strikes on, attacks killing, intercepts, downs a drone, X strikes Y); every real headline it marks was checked.
- **US region:** domestic headlines about violence are crime and policy, so the US kinetic rung uses hard signals only.
- **Evacuation:** long-standing Level 4 advisories (Syria, Iran, Lebanon, Iraq) scored permanently; they are now listed but not scored.
- **Ladder consequences:** annual displacement figures and a merely "reduced" Bosporus kept the top rung on; it now needs a severe or sudden chokepoint drop, or currency stress.
- **Batches:** the UK updated advice for 12 Gulf countries at once, which pushed diplomatic temperature to ELEVATED; UK updates are now capped.
- **IAEA:** a safeguards symposium counted as nuclear-file news; the term was removed.

Readings at release: Middle East ladder rung 4 (Hormuz transits severe; strikes reported; three carriers in the Arabian Sea), Eastern Europe rung 3 (Kerch Bridge strike, missiles on Poland), Hormuz maritime risk ELEVATED, sanctions pressure 9 designations in 7 days (most against PS), arms flow $2.0B in munitions contracts.

## Limits

- Meters inherit their sources' limits: ADS-B shows only aircraft that broadcast; AIS covers the Baltic and North Sea only; USNI is weekly; PortWatch runs about 6 days behind; UNHCR is annual.
- Headline rules read titles, not articles. A story's wording can still mislead them.
- Thresholds are fixed judgements, documented here and in the code; the lead/lag lab is how they should be tested once months of history exist.
