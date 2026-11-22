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
| 2 | Significant developments | Advisory raised/new/lowered, ransomware-linked KEV, non-routine CISA advisories, exceptional aircraft (bombers, airborne command posts, government VIP transports), or anything cited by an active indicator. Routine aircraft (tankers, airlift, surveillance) are never listed one by one: an active air indicator gives one *heavy air activity* line with its count instead. Aircraft sightings are also left out of section 6 (they are sensor readings, not reports) |
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

## Region pages (v0.12.0)

**REGIONS** (nav, the `REGION` command, or **OPEN … REGION PAGE** on a GOC watchlist row) lists the seven watch regions. Each links to a page with:

- **Header:** RAI, band, 24 h change, coverage, report counts (24 h, previous 24 h, 7 days), plotted records, the region's countries, and the RAI disclaimer.
- **RAI over recent runs:** the last ~80 collection runs from the dashboard snapshot. Longer trends are in Signal Lab.
- **Why this score:** each contributing indicator's share in RAI points. The RAI is 100 × (sum of contributions) ÷ the region's maximum, so the shares add up to the score.
- **Theatre:** a map focused on the region, showing the last 7 days of relevant records.
- **Indicators:** every indicator for the region, active first, with experimental ones marked.
- **Latest reports:** relevant records for the region (7 days), grouped as stories. Opinion columns are tagged **OPINION**.
- **Countries named and records by category:** 7-day counts. The region's own countries come first; others named alongside are marked "outside region".

Everything is built from the records the dashboard already loaded (the newest ~700), so the pages cost no extra reads. Off-topic news is excluded.

## Military installations (v0.14.0)

**BASES** on the GOC map (saved per device) shows **831 US military installations** (solid dots) and **2,775 worldwide** (rings, see below). US sites are coloured by branch: Army, Navy, Air Force (incl. Space Force), Marine Corps, other DoD. Inactive sites (caretaker, excess, closed) are faded. All markers fade when zoomed out. Names appear from zoom level 6. Region pages show the layer for their region.

- **Data:** DoD *Military Installations, Ranges, and Training Areas (MIRTA) – Points*, a National Geospatial Data Asset, published on ArcGIS Online by Esri's federal data team. Data currency 2024; CC BY 4.0, credit the Department of Defense.
  - [`scripts/build-installations.ts`](../scripts/build-installations.ts) downloads it into `public/data/installations-us.json`, recording the source, licence and retrieval time.
  - Coordinates are copied from the dataset. Nothing is geocoded or entered by hand.
  - Re-run the script when DoD updates the data (yearly).
- **Click an installation** for a card:
  - **Dataset facts:** name, component, state, status, joint-base flag, the dataset point.
  - **Look-up links:** Wikipedia search and OpenStreetMap.
  - **FAA flight restrictions** that name it.
  - **WATCHTOWER records** that name it, or that lie within 50 km with an exact location. Each record says why it is listed. Only the newest ~700 records are searched.
- **Name matching** ([`shared/domain/installations.ts`](../shared/domain/installations.ts)):
  - **Full official name:** matches anywhere.
  - **Short name** ("Beale" for Beale Air Force Base): counts only in US-tagged records. One-word short names must be Capitalised or ALL CAPS, and common words, surnames and big-city names are excluded ("Clear", "Hill", "March", "Hawaii", "Philadelphia" …).
  - **2023/2025 renames** match both ways (Fort Bragg / Fort Liberty, Fort Hood / Fort Cavazos …).
  - Checked against real FAA data: restrictions over Beale AFB, Grand Forks AFB and Naval Station Norfolk attach to the right installation.
- **Worldwide (v0.15.0): 2,775 current installations outside the US** from **Wikidata** (CC0), built by [`scripts/build-installations-world.ts`](../scripts/build-installations-world.ts) into `public/data/installations-world.json`.
  - **Drawn as rings,** coloured by who operates the site relative to its host: **US-operated abroad** (Ramstein, Kadena, Diego Garcia …), **foreign-operated** (Khmeimim and Tartus by Russia …), and **national / not recorded**.
  - **Included:** air bases, military and naval bases, military installations, RAF stations, Canadian Forces bases, radar, missile and listening stations, forward and main operating bases. Barracks, outposts and cantonments are left out, since they are mostly historical. Items with a dissolution date are left out.
  - **US sites come only from DoD,** so Wikidata's US entries are skipped.
  - **Crimea** is assigned to UA, as elsewhere.
  - **The card shows:** type, host country, operators (from Wikidata; **may include former operators**), Wikipedia, Wikidata and OpenStreetMap links, and records that name the site or lie within 50 km.
  - **Short names count only in records about the host country** ("Ramstein" in a German record). The full name counts anywhere.
- **Operator filter (v0.15.1):** next to BASES, choose all operators or one country (with counts). DoD sites count as US. A Wikidata site counts for each operator country recorded; with none recorded, it counts for its host country, marked *presumed* on the card. Former states (SU, YU, CS, DD) are ignored. A selected base that the filter hides is deselected. BASES off hides every base.
- **Limits:**
  - **Wikidata is community-maintained:** coordinates and operators are not official, and coverage is uneven (343 UK sites, few in Africa). Some notable sites are missing under these classes: Camp Lemonnier, China's Djibouti base, the South China Sea island bases.
  - **Operator countries** come from each operator's own Wikidata country, which can mislead (a US command headquartered in Germany is recorded as German).
  - Map markers are not keyboard-focusable: the card and the region page carry the same information.

## Military aircraft (v0.16.0)

**AIR** on the GOC map (saved per device) shows military aircraft seen on ADS-B at the last collection run.

- **Data:** the adsb.lol military feed (ODbL 1.0), or adsb.fi if adsb.lol fails. Volunteer receivers pick up what aircraft broadcast; the network flags aircraft as military from its own community database. That flag includes government VIP aircraft.
- **Snapshot, not live:** positions come from the last run (every 30 minutes) and are stored in the dashboard snapshot, so the layer costs no extra reads. Positions older than 90 minutes are not drawn, and the legend says so.
- **Classes** come from the ICAO type code: tanker, surveillance/command, bomber, airlift, fighter, helicopter, other ([`shared/domain/aircraft.ts`](../shared/domain/aircraft.ts)). KC-46, KC-10, A330 MRTT and E-4B use airliner type codes, so they cannot be told apart from VIP or transport jets and show as **other**.
- **Records:** a tanker, surveillance/command aircraft, bomber or airlift aircraft becomes one record per aircraft, region and day, at its first position that day, when it is **over one of the region's countries, or over open water inside the region's box** (v0.17.1). Over any other country it is not recorded, even inside the box (the boxes also cover neighbours such as Austria, Hungary and Egypt). Over the sea, a record has a region but no country. Somaliland counts with Somalia. Airlift over the US is routine and is not recorded; over US coastal waters an aircraft does not count for the US.
- **Indicators (experimental, weight 0):** tanker/surveillance/bomber activity in each region, and airlift activity outside the US, against a 14-day baseline. Fixed thresholds apply until 14 days are collected.
- **Limits:**
  - **Only aircraft that broadcast are seen.** Many military flights fly with transponders off or send no position. Absence of aircraft is not absence of activity.
  - **Coverage is uneven:** dense over Europe and the US, thin over the Gulf, Red Sea, Taiwan Strait and Korea.
  - **Typical volume is small:** about 40 to 90 aircraft with a position worldwide at any moment.

## US Navy fleet (v0.17.0)

**FLEET** on the GOC map (saved per device) shows where the weekly **USNI News Fleet and Marine Tracker** lists deployed US Navy ships.

- **Parsing** ([`collector/adapters/usniFleet.ts`](../collector/adapters/usniFleet.ts)): each "In the …" section of the tracker is an area. A ship counts for an area when its paragraph says where it is now ("is operating in", "is in port", "arrived") or is a strike-group roster line ("homeported …"). The week's narrative before the first area and photo captions are ignored, as are paragraphs about other times ("departed", "relieved", "returned"). Some trackers write area headings as bold paragraphs; those count too.
- **Where markers go:** at the named area's reference point (centre of a sea, or the port city) from a fixed table ([`shared/domain/fleet.ts`](../shared/domain/fleet.ts)). **A marker is not a ship position.** A wide faint halo says "somewhere in this area". Areas too vague to place ("Japan", "Pacific Ocean") are listed but not drawn. Unknown area names are never guessed.
- **Records:** a carrier or big-deck amphibious ship (CVN, LHA, LHD) that appears in a new area compared with the previous tracker. Records carry the area's watch region, if any, at region precision; they are never pinned to a point.
- **Indicator:** *US carrier or big-deck arrival* per region (21 days; 1 arrival = elevated, 2 = triggered). A relief in place (one carrier replacing another) also counts as an arrival.
- **First run (2026-11-21):** the Nov. 16 tracker showed three carriers in the Arabian Sea (George Washington, George H.W. Bush, Theodore Roosevelt). Theodore Roosevelt had moved there from the Philippine Sea, so the Middle East indicator is ELEVATED.
- **Limits:** weekly and up to a week old; approximate by area; some weeks missing from the feeds (Nov. 2 and Nov. 9 on 2026-11-21); submarines and most auxiliaries are not listed. A ship is listed under the section USNI puts it in, which can be a port it has just left.

## Chokepoint traffic (v0.18.0)

**STRAITS** on the GOC map shows daily ship transits through six chokepoints from **IMF PortWatch**: Hormuz, Bab el-Mandeb, Suez, Bosporus, Taiwan Strait and Malacca.

- **Status** ([`shared/domain/chokepoints.ts`](../shared/domain/chokepoints.ts)) from the mean of the last 7 days:
  - **Severely reduced:** under 40% of the 2025 daily average.
  - **Reduced:** under 70% of the 2025 average.
  - **Sudden drop:** 40% below the previous four weeks (when not already severe).
  - The 2025 average is the long-term reference, because a lasting disruption (Hormuz since August 2026) makes the recent past look normal. It was already lowered for Suez and Bab el-Mandeb by the Red Sea crisis.
- **Records:** one per disrupted chokepoint per ISO week, so a lasting disruption keeps its indicator active, and one when it returns to normal.
- **Indicators:** *traffic reduced* (weight 1; 2 weekly records = triggered) and *severely reduced or falling fast* (weight 3; triggered at once) for the four chokepoints inside watch regions. Suez and Malacca are shown but belong to no watch region.
- **Limits:** about 6 days behind; ships with AIS switched off are not counted; counts cover cargo and tanker ships only. Use is subject to the IMF terms decision in the source registry.

## Sanctions (v0.19.0)

New designations on the **US OFAC SDN**, **EU** and **UK** sanctions lists, in the feed and on region pages (category ECONOMIC).

- **What is new:** each list is compared with its previous copy ([`collector/adapters/sanctions.ts`](../collector/adapters/sanctions.ts)). A list that suddenly shows hundreds of "new" ids is refused as an id-scheme change rather than reported as a sanctions wave.
- **Target country** ([`shared/domain/sanctions.ts`](../shared/domain/sanctions.ts)): from the programme or regime (OFAC RUSSIA-EO14024, EU UKR, UK "Russia (Sanctions) Regulations" → Russia). Thematic programmes (counter-terrorism, cyber, human rights, drugs) have no country, so the designees’ addresses and nationality are used and the record says "linked to". Vessel flags are never used.
- **Records:** one per list, day and target country, with counts by kind (vessels, entities, individuals) and up to eight names.
- **First run (2026-11-21), UK back-fill:** 20 Russia designations on Nov. 12 (11 vessels), 15 Sudan individuals on Oct. 26, and 9 entities on Nov. 17 linked to the Palestinian Territories and Israel.
- **Limits:** OFAC entries carry no designation date, so OFAC history starts from the first run; removals are not recorded; a designation is a legal measure, not proof of the conduct alleged.

## Sanctioned vessels (v0.20.0)

**SANCTIONED** on the GOC map shows ships on the US, EU or UK sanctions lists seen on AIS in the **Baltic** (incl. the Gulf of Finland) and the **North Sea + Channel** over the last 48 hours.

- **How ships are matched** ([`collector/adapters/aisSanctioned.ts`](../collector/adapters/aisSanctioned.ts)):
  - **By IMO** from the ship's own identity message. The IMO number is permanent, so a listed ship that has been re-flagged under a new MMSI and name is still found; its new MMSI is then remembered for later windows.
  - **By MMSI** (OFAC lists MMSIs) from position reports. If the ship's identity message in the same window shows a different IMO, the MMSI has been reassigned and the match is dropped. MMSI-only matches are labelled as such.
- **Sampling:** 25 seconds per collection run, while the other sources are collected. Moving ships report every few seconds; identity messages come every ~6 minutes, so IMO matches build up over several runs.
- **Records:** one per vessel, area and day. Baltic and Gulf of Finland sightings belong to the Eastern Europe region; North Sea sightings to no region.
- **Indicator:** sanctioned vessels in the Baltic (experimental, weight 0) until a baseline exists.
- **Limits:** only ships with AIS on near volunteer receivers; coverage is good in north-west Europe and absent in the Middle East and Asia. A sanctioned ship at sea is not by itself a violation.

## UN Security Council (v0.21.0)

Security Council meetings, resolutions and failed drafts, in the feed and on region pages (category DIPLOMATIC).

- **Meetings** ([`collector/adapters/unsc.ts`](../collector/adapters/unsc.ts)): one record per meeting record (S/PV.xxxxx), tagged to countries from the UN catalogue's subject terms and the agenda. Closed meetings are marked. Thematic meetings (children and armed conflict, non-proliferation without a country) have no region.
- **Resolutions:** the tally and the members voting against or abstaining; countries from the linked meeting and the title. A resolution with any no vote or abstention is marked *divided*.
- **Failed drafts and vetoes:** UN press releases whose title reports a draft that "fails to adopt" or a veto; permanent members named in the text as voting against are listed.
- **Indicators:** *Security Council attention* (meetings above the 28-day baseline, since many are scheduled mandate renewals) and *draft fails or is vetoed* (30 days).
- **Limits:** no programme of work or "emergency meeting" label (the Council website refuses scripted requests); meetings are catalogued 1–3 days late.

## North Korean launches (v0.22.0)

- **Source:** Yonhap's English all-news feed ([`collector/adapters/yonhapDprk.ts`](../collector/adapters/yonhapDprk.ts)). Yonhap reports a launch within minutes, usually citing South Korea's Joint Chiefs of Staff, then publishes LEAD and LD versions with details.
- **What counts:** a headline naming North Korea with *fires / launches / test-fires* and *missile / rocket / projectile / ICBM / SLBM / satellite*, or *conducts a nuclear test*. Forecasts, warnings and analysis ("may fire", "preparing", "vows") do not count. South Korean or US launches do not count.
- **Records:** one per kind and Korea day, listing the day's headlines; rewritten as new versions arrive.
- **Indicators:** launch days (1 = elevated, 2 in 7 days = triggered) and nuclear test reported. The USGS explosion-typed seismic indicator is an independent check on a test.
- **Why not official sources:** Japan's Ministry of Defense publishes the most detailed notices, but its site's bot protection challenges scripted clients, as do the CNS missile database and CTBTO. WATCHTOWER does not try to get around bot protection.

## US embassy drawdowns (v0.23.0)

- **From the State Department advisories** ([`collector/adapters/stateTravelAdvisories.ts`](../collector/adapters/stateTravelAdvisories.ts)): each advisory's text is read for *ordered departure*, *authorized departure* and *suspended embassy operations*; "lifted", "ended" and "resumed" wording counts as none.
- **Records** only when a reissued advisory adds or lifts one of these. The conditions in force when tracking began (2026-11-21: Belarus ordered departure; suspended operations in Yemen, Sudan, Afghanistan, Russia and Belarus) are the baseline.
- **Indicator:** *US embassy drawdown* (30 days, weight 3): one of the strongest official signals that a government expects danger.
- **Limits:** advisories are reissued after the decision, sometimes days later; embassy security alerts would be faster, but the embassy sites refuse scripted requests.

## DoD contract awards (v0.24.0)

- **Source:** the Department's daily contract announcements ([`collector/adapters/dodContracts.ts`](../collector/adapters/dodContracts.ts)), every award of $7.5 million or more.
- **Parsing per award:** service heading, contractor, amount (the awarded, maximum or not-to-exceed figure), purpose ("for …"), contract number, munitions keywords, and Foreign Military Sales customers named in the text.
- **Records:** only $1 billion or more, munitions of $100 million or more, and FMS to a watch-region partner. FMS records belong to the partner's region; the rest to the United States region.
- **Ceilings:** IDIQ, multiple-award, "maximum" and not-to-exceed figures are ceilings, not money spent, and the title says so.
- **Indicators (experimental):** munitions awards (US) and arms-sale awards per region. Procurement is slow and lumpy, so neither affects the RAI.

## Federal Register (v0.25.0)

- **Source:** the official journal of the US government ([`collector/adapters/federalRegister.ts`](../collector/adapters/federalRegister.ts)).
- **Presidential documents** are kept when the title concerns security or foreign policy (sanctions, national emergency, defence, named watch countries …). Commemorative proclamations and routine annual continuations of existing national emergencies are skipped; a **new** national emergency gets its own record type.
- **Export controls:** every Commerce (BIS) rule, including Entity List changes. **Terrorist designations:** State Department FTO/SDGT designations and revocations.
- **Countries** come from the title and abstract; documents on public inspection before their publication date are dated today, not in the future.
- **Indicators:** a new national emergency naming a region (high), and an experimental count of executive actions per region.

## Congress (v0.26.0)

- **Source:** the Congress.gov API ([`collector/adapters/congress.ts`](../collector/adapters/congress.ts)), with a free key.
- **Measures recorded:** war-powers resolutions ("removal of United States Armed Forces from hostilities …"), use-of-force authorizations, disapprovals of arms sales and of civilian nuclear-cooperation agreements, and the annual defense authorization (NDAA). One record per measure and latest action, so an introduction, a committee step and a floor vote are separate records; floor votes are marked.
- **Hearings:** armed services, intelligence, foreign affairs/relations and homeland security committees only.
- **Countries** from the measure or hearing title (e.g. "the Islamic Republic of Iran" → Iran).
- **Indicators:** war-powers action on a region (2 in 30 days = triggered), and experimental congressional attention.
- **Example (2026):** four Senate resolutions to remove US forces from hostilities with Iran; discharge motions failed 47–53 and 47–48.

## Satellite imagery (v0.27.0)

- **IMAGERY** on the GOC map shows NASA GIBS daily mosaics ([`src/lib/imagery.ts`](../src/lib/imagery.ts)) under the labels and every overlay, so records, bases, aircraft and ships stay on top.
- **Products:** true colour (VIIRS NOAA-20, MODIS Terra) and night lights (VIIRS NOAA-20) for any day; Black Marble 2016 as the night-lights baseline.
- **Use:** look at an area named in a record (smoke plumes, burn scars, a city's lights going out). Compare night lights with the 2016 baseline and with the days before; moonlight, clouds and daytime parts of the pass change brightness.
- **Limits:** resolution is hundreds of metres, so buildings and vehicles are not visible; clouds hide the ground; it is a picture to look at, not an automatic detector.

## Military space launches (v0.28.0)

- **Source:** Launch Library 2 ([`collector/adapters/launches.ts`](../collector/adapters/launches.ts)), a community-maintained database of every orbital launch.
- **What counts as military:** mission type "Government/Top Secret" (US Space Force, NRO, SDA; China's Yaogan and Shijian), a military operator (Russian Space Forces …), or any launch from North Korea or Iran, whose launchers share ballistic-missile technology.
- **Records:** completed launches only (success, failure, partial failure), never schedules, so nothing changes after it is recorded.
- **Indicators:** North Korean space launch (high), Iranian space launch, and an experimental worldwide tempo.

## WHO outbreak reports (v0.29.0)

- **Source:** WHO Disease Outbreak News ([`collector/adapters/whoDon.ts`](../collector/adapters/whoDon.ts)), published for public-health events of potential international concern.
- **Records:** one per report, tagged to the countries in its title; reports for a WHO region or the global situation have no country. High-consequence pathogens are flagged in the title.
- **Indicator:** a report naming a watch-region country (one = elevated, two in 30 days = triggered).
- **Limits:** WHO reports after national notification, often days or weeks after the first cases; countries that do not report do not appear.

## Economic stress (v0.30.0)

- **Currencies** ([`collector/adapters/economy.ts`](../collector/adapters/economy.ts)): 28 watch-region currencies against the dollar, compared with 7 and 30 days earlier. A record when a floating currency loses 5% in a week or 10% in a month; pegged currencies (Gulf states, Jordan, Djibouti, Eritrea, Brunei) 2%. EUR (Baltics) and KPW (official rate only) are left out.
- **Oil:** Brent and WTI spot prices from the EIA; a record on a 10% move in a week or 20% in a month, either way. The experimental spike indicator counts rises only.
- **Limits:** daily reference rates, not intraday. For the Iranian rial and the Syrian and Lebanese pounds the source does not say whether its rate is official or market, so the level is indicative and the change is the signal. EIA prices are 3–4 days late. Oil moves for many non-security reasons.

## Displacement (v0.31.0)

- **Source:** UNHCR Refugee Data Finder API ([`collector/adapters/unhcr.ts`](../collector/adapters/unhcr.ts)), once a day.
- **Shown:** on each region page, per country: people who fled abroad (refugees and asylum seekers), internally displaced people, and refugees hosted, with the change against the previous year.
- **Not an alert:** the figures are published twice a year and describe the situation months earlier, so they are background, not a warning.
- **Limits:** the current year is a mid-year figure until the annual release; IDP numbers come largely from IDMC; Taiwan and some small states have no UNHCR figures; North Korean refugees are undercounted.

## What changed (v0.32.0)

- **Where:** region pages (panel), GOC Regional Watch (one line per region), daily brief (indicator changes section). Logic in [`shared/domain/changes.ts`](../shared/domain/changes.ts).
- **Indicators:** a state change in the last 24 hours, from the evaluation's `stateSince` and `previousState`. A move into NORMAL, UNKNOWN or DATA_UNAVAILABLE is shown only when the earlier state is known, so new indicators never appear as "returned to normal". Experimental indicators are left out.
- **New stories:** stories are built over 48 hours and kept only when their first report is in the last 24, so a continuing story is not counted as new.
- **Warnings:** the same notable-warning rule as the brief (advisory level and posture changes, orange/red disaster alerts, attributed shutdowns, unusual seismic events, significant cyber).

## Activity near bases (v0.33.0)

- **Computed in the collector** ([`shared/domain/baseActivity.ts`](../shared/domain/baseActivity.ts)) over the records it already loads for indicators (about 36 days), so the baseline needs no extra reads. Matching uses a word index of installation names and a 1° grid for locations.
- **This week vs usual:** records in the last 7 days against the mean of up to four earlier weeks. Unusual = 3+ records, 2+ sources, and 3× the usual week (a usual week under 1 counts as 1).
- **History gate:** no flags until 21 days of history exist; the card states how many days are available.
- **Shown:** amber ring on the map, an Activity block on the installation card, and a legend count.

## Watchlist (v0.34.0)

- **Matching** ([`shared/domain/watchlist.ts`](../shared/domain/watchlist.ts)): whole words in the title or summary, any case; terms of up to five capital letters match only in capitals. The same matcher runs in the browser (highlights) and the collector (alerts).
- **Alerts:** each item set to alert acts as an event rule for new records collected after the item was added; alerts go through the normal store, deduplication, cooldown (60 minutes per item) and Discord delivery.
- **Storage and security:** one document per user (`watchlists/{uid}`), owner-only, version-checked by the Firestore rules (tested against the emulator).

## Meters and monitors (v0.35.0)

Twenty-one meters built from the collected sources: see [METERS.md](METERS.md) for every rule, threshold, the real-data review and the limits.

## Cost

| Feature | Firestore reads |
|---|---|
| SITREP and Replay | Up to ~2,000 events + history + alerts per load. Shown on screen |
| Signal Lab | The same history load; the backtest itself runs in the browser |
| Collector | One extra write per run (the RAI point) |
