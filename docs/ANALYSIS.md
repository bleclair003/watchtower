# Advanced Analysis — SITREP, Replay, Signal Lab

**Status: implemented (Phase 6).** Code: [`shared/domain/history/`](../shared/domain/history/) (replay, backtest, SITREP, trends). UI: **SITREP**, **REPLAY**, **SIGNAL LAB**. Data comes from bounded archive queries ([`src/data/archiveService.ts`](../src/data/archiveService.ts)). Each query has a cap, and the UI reports read counts and whether a cap was hit.

## Honest limits (read first)

- WATCHTOWER began collecting on **2026-11-20**. Until about 90 days of history exist, backtests test the *method*, not the indicators, and every result carries a data-sufficiency figure.
- **Replay does not reconstruct source outages yet.** A source counts as healthy from its first collection onward.
- Nothing in this module generates prose or inferences. SITREP is deterministic.

## SITREP (PDD §12)

Choose 6 h, 24 h, 7 d or a custom period, then **GENERATE**. The eight sections:

| # | Section | What goes in it |
|---|---|---|
| 1 | Executive summary | Counts only |
| 2 | Significant developments | Advisory raised/new/lowered, ransomware-linked KEV, non-routine CISA advisories, or anything cited by an active indicator |
| 3 | Regional activity changes | RAI at the start of the period vs now, from `raiHistory`; "no comparison" when no point is near the start |
| 4 | New official warnings | Travel-advisory level changes |
| 5 | Indicator changes | Transitions from `indicatorHistory` |
| 6 | Conflicting or unverified reports | Unverified or single-source records, plus disputed dossier evidence |
| 7 | Sources requiring attention | Sources that are degraded, stale or offline |
| 8 | Outstanding questions | Generated only from gaps in the data: triggered indicators, coverage gaps, dossiers without confirmed evidence, baselines still being built |

- **Backfill is separated out.** Records first collected in the period but published earlier are counted separately and not treated as new developments.
- **Limitations are always appended,** including a note if a query hit its cap.
- **EXPORT INTELLIGENCE CONTEXT** copies the whole report as Markdown for pasting into Claude. It ends with an instruction not to introduce unsupported facts.

## Historical Operations Replay (PDD §11)

Choose a window and press **LOAD**. Loading includes 32 days before the window, so the indicators have their lookback. Then scrub or play at 1 h/s, 6 h/s or 1 d/s.

**The hindsight rule:** at time T a record is shown only if `collectedAt ≤ T`. Publication time is not enough. Each frame re-runs the deterministic indicator engine and RAI on exactly that data. The frame shows:

- RAI per region and the indicators active at T;
- a map of known records published within 7 days of T;
- what became known in the 24 h before T, with **LATE** tags for records collected more than 24 h after publication.

Before WATCHTOWER began collecting, the frame says so: nothing is shown because nothing was known, not because nothing happened.

**Hindsight panel.** This is hidden by default. When revealed, it lists records collected later in the window and dossiers whose first evidence comes after T: the "subsequently known outcomes".

## Signal Lab

- **Trends.**
  - Record volume per day (or per 6 h for short windows) by publication time, filterable by category. Empty buckets are kept.
  - RAI history per region, one chart per region, from the `raiHistory` collection the collector now writes every run. Gaps mean the RAI was not evaluable; they are never interpolated.
  - Charts are single-series with recessive grids, hover tooltips and a table view.
- **Backtest.** Every indicator is re-evaluated at fixed steps (1/6/12/24 h) using only data available at each step. Firing episodes are then compared with **outcomes**: dossiers you select, each dated to its earliest evidence. The results:

  | Result | Meaning |
  |---|---|
  | Firing episodes | Separate runs of firing |
  | Hits (lead time) | An episode started within the horizon before an outcome |
  | Misses | Outcomes with no preceding episode |
  | False alarms | Episodes with no outcome within the horizon. Shown only once outcomes are chosen |
  | Evaluable share | Share of steps with usable data |
  | Co-activation | Pairs of indicators that fired together. This is not proof of independent corroboration |

  The run reports data sufficiency (days actually collected in the window) and flags anything below 90 days.
- **Experimental signals.** Each signal carries a research record (PDD §7.3): hypothesis, data availability, baseline period, expected relationship, historical examples, confounders, false positives, retrospective results and evidence quality.
  - Catalog v2 adds **State Dept advisory tempo (global)**. It is computable from collected data and set to weight 0, so it never feeds the RAI.
  - The Pentagon Pizza Index remains a documented, data-less concept.

## Stories (v0.10.0)

The feed groups reports of the same event from different headline feeds into one **story** (toggle **STORIES ON/OFF** in the feed header). Code: [`shared/domain/stories/stories.ts`](../shared/domain/stories/stories.ts). It is computed in the browser from the records already loaded, so it costs no reads.

**Which feeds:** BBC World, Al Jazeera, UN News, U.S. DoD, UK MOD, IAEA. Structured sources (KEV, USGS, GDACS, IODA, FIRMS, Cloudflare) never form stories.

**Same story only if all hold:**
- the headlines share at least **3** distinctive words, covering at least **half** of the shorter headline's words. Words are crudely stemmed to their first 6 letters, so "assassinate" matches "assassination";
- at least one shared word is **not a place name**;
- they were published within **48 hours** of each other;
- they don't name **different countries**.

Leading labels ("Guidance:", "Official Statistics:", "Bowen:") are ignored. A group made only of one official publisher's pages is not a story: those share templates, not events.

**Corroboration counts publishers, not items:**

| Label | Meaning |
|---|---|
| 1 PUBLISHER | Several reports from one outlet |
| N PUBLISHERS | Independent outlets reported it. Not proof: outlets often use the same news agency |
| OFFICIAL+ | An official publisher (UN, DoD, MOD, IAEA) is among the reports |

Each story shows its reports, their publishers and the shared words that grouped them.

**Known limits:**
- Related coverage of one ongoing situation can be grouped. For example, two BBC pieces on Israeli West Bank settlements shared "settlers/settlements".
- Reports that describe the same event in entirely different words stay separate.

## Relevant topics only (v0.10.2)

News items (BBC, Al Jazeera) are shown only when the headline is about a **relevant topic**. Everything else is marked **OFF-TOPIC** and hidden by default in the feed, the map, the region report counts and SITREP. Nothing is deleted: **OFF-TOPIC HIDDEN (n)** in the feed header shows those items, each with its reason. Code: [`shared/domain/relevance.ts`](../shared/domain/relevance.ts).

| Kept when the headline is about | Examples of words |
|---|---|
| Security and conflict | attack, killed, plot, spy, missile, troops, targets, hits, ceasefire, siege |
| Politics and government | election, president, parliament, minister, opposition, EU, UN, NATO, heads of state by name |
| Law and rights | genocide, human rights, detained, crackdown, top court |
| Humanitarian | refugees, migrants, border, famine, aid, outbreak |
| Economy and energy | tariffs, sanctions, oil, gas, inflation, markets, chips |
| Disasters | earthquake, flood, wildfire, cyclone |

- News already classified military, diplomatic, unrest, disaster, cyber, maritime, aviation or economic is always kept.
- Official and structured sources are always kept.
- Watch regions do **not** decide relevance: world news outside them is kept when the topic is relevant.

Checked on live data on 2026-11-21: 17 of 78 news items hidden (sport, celebrity, an art sale, lifestyle, local crime and court cases, company news). The combat verbs were added after "Russia targets Kyiv crossings days after Ukraine hits Crimean Bridge" was first missed.

**Limits:** a relevant story worded without any listed word is hidden. The toggle shows it, and the word can be added to the list.

## Cost

| Feature | Firestore reads |
|---|---|
| SITREP and Replay | Up to ~2,000 events + history + alerts per load. Shown on screen |
| Signal Lab | The same history load; the backtest itself runs in the browser |
| Collector | One extra write per run (the RAI point) |
