# Changelog

## [0.49.0] — 2026-11-21 — Radiation detection (Phase 18)

### Added
- **Three official gamma dose-rate networks**, each station judged against its own usual level (a running average of its normal readings; raised readings never move it):
  - `bfs-odl` — Germany, Federal Office for Radiation Protection, ~1,550 stations reporting, hourly (open data, dl-de/by-2-0);
  - `stuk-radiation` — Finland, STUK via the FMI open data service, ~245 stations, 10-minute averages (CC BY 4.0); the closest open network to Russia's Leningrad and Kola plants;
  - `epa-radnet` — United States, 16 EPA RadNet monitors (Washington, Yaphank/Brookhaven, Boston, Atlanta, Jacksonville, Omaha, Colorado Springs, Carlsbad/WIPP, Idaho Falls/INL, Richland/Hanford, San Francisco, Los Angeles, San Diego, Honolulu, Fairbanks, San Juan), two read per run; a new monitor's usual level starts from its own previous two weeks.
- **Detection**: a station is *elevated* at 2× its usual level and at least +0.10 µSv/h, *high* at 0.5 µSv/h and at least +0.3 (or 1.0 µSv/h with no usual level yet). Raised stations within 100 km form a group; a record is made for a group of 3+, any high station, or any raised RadNet monitor (once per group per 6 hours).
- **RAD map layer** (GOC, on by default; also in SETTINGS): only stations above their usual level are drawn (amber elevated, red high), with their reading; legend lists the networks and station counts.
- **Radiation meter** (METERS topic monitors): high station 4, alerting group 3, other raised stations 0.5 (max 1); withheld while usual levels build.

### Fixed
- The map legend had grown taller than the map on smaller screens, pushing its LEGEND toggle out of reach; it is now capped to the map's height and scrolls.

### Limits
- Rain washes natural radon products to the ground and can double readings for a few hours, which is why single stations count for little.
- Germany and Finland are not watch regions: they are early warning for a release in Eastern Europe. Ukraine's own stations (SaveEcoBot API) need a key; the EU EURDEP network has no public live API.
- Usual levels for Germany and Finland build over the first day of runs.


## [0.48.0] — 2026-11-21 — Better FAA data (Phase 17)

### Added
- **Flight restriction shapes and times** (`faa-tfr`): VIP, security and special TFRs now carry their outline from the FAA TFR map service, start and end times (UTC), reason and altitude from each TFR's detail page (fetched once per TFR, 15 new ones per run). Record summaries include the times and reason. Record ids are unchanged.
- **FAA airport status** (source `faa-airport-status`, NAS Status public JSON, every run): ground stops, ground delay programs, arrival and departure delays and closures at US airports, at the FAA's own airport positions. Records only for ground stops and delay programs whose cause is not weather, traffic volume or runway work (e.g. "equipment / outage", security).
- **FAA notices for US flights abroad** (source `faa-airspace-notices`, the FAA's "Prohibitions, Restrictions and Notices" page, every 3 hours): SFARs and KICZ prohibition and advisory NOTAMs per country or sea area, tied to watch regions (Iran, Iraq, Syria, Saudi Arabia, Persian Gulf → Middle East; Russia, Ukraine, Belarus → Eastern Europe; Yemen, Somalia → Red Sea; North Korea → Korean Peninsula). A document that appears after tracking began becomes a record; those present at the start are standing notices.
- **FAA map layer** (GOC toggle FAA, on by default; also in SETTINGS): TFR outlines by type (VIP lime, security pink, special blue; solid while active, faint before they start, labelled when zoomed in) and airports with a ground stop (red), delay program (orange), delays (yellow) or closure (grey), white-ringed when the cause is not weather or volume. Legend section "FAA airspace".
- **Airspace meter for every region** (METERS column AIRSP): new FAA notices for the region in 14 days (3 each, max 6; standing bans listed, not scored), headlines about airspace closures, suspended flights, GPS jamming or no-fly zones (1 / 2–3 / 4+ publishers: 1 / 2 / 3); in the US, ground stops and delay programs not caused by weather or volume (2 each, max 4) and 8+ airports in ground stops at once (+3).

### Limits
- The TFR list, shapes and airport status are undocumented endpoints behind public FAA sites and may change. The NOTAM API (foreign airspace closures, danger areas, GPS interference) needs FAA credentials and is not used yet.
- FAA notices cover only what the US regulator tells US operators; other countries' aviation authorities are not read.


## [0.47.1] — 2026-11-21 — Snapshot size guard covers map layers

### Fixed
- The snapshot was trimmed to 900 kB **before** the map layers (aircraft, fleet, chokepoints, sanctioned ships, power outages …) were attached, so the stored document had grown to about 933 kB against Firestore's 1 MiB limit. It is now trimmed again just before it is written (oldest records left out first, logged as `SNAP`), so a large layer can no longer push it over.
- Power-outage county outlines are capped at about 40 kB in the snapshot (largest outages first), so a big storm stays within budget.


## [0.47.0] — 2026-11-21 — Power outages (Phase 16)

### Added
- **US power outages from ODIN** (source `odin-power-outages`): the Outage Data Initiative Nationwide (US Department of Energy / Oak Ridge National Laboratory) public API, no key. Every run reads customers without power by county from the utilities that report to ODIN (about 150–160, including CenterPoint, PacifiCorp, MidAmerican and Hawaiian Electric), with ODIN's own county outlines.
- **POWER map layer** on GOC (on by default; also in SETTINGS): counties with 50+ customers out shaded amber to red (50+, 1k+, 10k+, 100k+), labelled when zoomed in; legend shows the US total, states, shaded counties, age and the number of reporting utilities.
- **Records** in the feed, alerts and archive when a state reaches 25k, 100k, 250k, 500k or 1M customers out (once per state per day per step), region United States, no invented coordinates.
- **Power-outage meter for every region** (METERS column POWER, region pages): internet outages that Cloudflare attributes to power cuts (nationwide 3, regional 1, max 2), headlines about power cuts, blackouts or attacks on the power system from 1 / 2–3 / 4+ publishers (1 / 2 / 3), and in the US the largest state outage on ODIN (5k LOW, 25k GUARDED, 100k ELEVATED, 500k HIGH).

### Limits
- ODIN counts only the utilities that report to it, so US totals are a floor; it gives no causes, and no reliable per-state customer base, so no percentages are shown.
- Outside the US there is no free live outage feed; PowerOutage.us (paid, scraping barred) and ENTSO-E (token, unclear reuse terms) were not used.


## [0.46.1] — 2026-11-21 — Infrastructure drawn as squares

### Changed
- Critical infrastructure is now drawn as **squares** (coloured by type), so it no longer looks like the bases layer (dots for US installations, rings worldwide). Flagged sites are larger squares outlined in red. The legend shows the same shapes and labels the two sections "● Bases" and "■ Infrastructure".


## [0.46.0] — 2026-11-21 — Like-for-like comparisons (Phase 15 item 12)

### Changed
- **Usual levels compare like with like** (`usualLevel` in `shared/domain/meters/util.ts`): every UTC day a meter's window covers is matched with earlier whole days of the same kind — Saturdays with Saturdays, Mondays with Mondays, and holidays with holidays — and the expected count is the sum of those daily means, weighted by how much of each day the window covers. Holidays are left out of the weekday averages.
- Used by buildup vs noise (news and posture), air surge, the reporting drop in information blackout, cyber's usual week and Pentagon after-hours. Each meter card now says which comparison it used.
- **Holidays** (`shared/domain/holidays.ts`), computed by rule: US federal holidays on their actual date, Christmas Eve, Boxing Day, New Year's Eve, Good Friday and Easter Monday. Lunar-calendar holidays are not included.
- Holiday counts are kept by the collector for three years (`collectorState/holidayCounts`), because a run loads only about 45 days of records — so next year's Thanksgiving can be compared with this year's.

### Limits
- Needs 3 earlier days of each weekday in the window (about mid-December 2026) and 2 earlier holidays (from about New Year 2027); until then the plain average of all earlier days is used and the card says so — with a warning when a holiday falls in the window.
- Days are UTC days, so the first hours of a US holiday evening fall on the next UTC day.
- Different holidays are pooled (Thanksgiving with Christmas); a quiet holiday is compared with quiet holidays in general, not the same holiday a year earlier, until years of history exist.


## [0.45.0] — 2026-11-21 — Known dates ahead (Phase 15 item 11)

### Added
- **Curated known dates** (`shared/domain/knownDates.ts`, 27 entries): fixed national days and anniversaries for each watch region (e.g. 3 Jan Soleimani, 11 Feb Iranian Revolution, 24 Feb Russia's full-scale invasion, 15 Apr Day of the Sun, 9 May Victory Day, 20 May Taiwan inauguration, 27 Jul Korean armistice, 9 Sep DPRK founding, 7 Oct, 10 Oct Double Ten, 19 Nov Galaxy Leader seizure); regular exercises by the month they are usually held, marked approximate (Freedom Shield ~March, Balikatan ~April–May, Han Kuang ~July, Ulchi Freedom Shield ~August); and elections only once confirmed — Taiwan's local elections and nuclear-energy referendum on 28 November 2026 (Central Election Commission).
- Shown in the METERS 30-day calendar (tagged DATE), in a **Known dates ahead — 90 days** list under it, in a **Known dates ahead — 120 days** panel on each region page, and in a **Known dates (next 7 days)** section of the daily brief. Each date links to its Wikipedia article and says why it matters.
- Lunar-calendar dates (Ashura, Quds Day, Israeli Independence Day) move each year and are not listed; other elections whose dates were ambiguous were left out rather than guessed.


## [0.44.0] — 2026-11-21 — Missing regulars (Phase 15 item 8)

### Added
- **Missing regulars** meter (METERS topic monitors, lead/lag lab): a source that normally publishes every day — new items on 80% of days or more, learned from 7+ days of history and judged by when WATCHTOWER first collected each item — has published nothing for longer than 24 hours or three times its usual gap, whichever is longer, while it still loads. Sources that fail to load stay with source health (STALE, OFFLINE), so the two never overlap.
- The **daily brief** names quiet daily sources in its collector-health section ("… nothing new for 30 h (usually 8 a day) — reachable but quiet").
- Event-driven sources (earthquakes, sanctions, launches, outbreak reports) never qualify as daily, so they are not flagged.

### Limits
- Needs 7 days of history: shows BUILDING until about 2026-11-27.
- A quiet official feed can mean a holiday or a website change as well as a deliberate silence.


## [0.43.0] — 2026-11-21 — Source track record (Phase 15 item 7)

### Added
- **Source track record** panel on the METERS page (30 days, recomputed each run): for each news and official source, its leading reports (no other publisher had the story in the 48 hours before), how many another publisher carried within 48 hours, the same for strike and attack headlines, the median hours until pickup, and reports still pending (under 48 hours old).
- Matching is the story grouping or 3+ shared content words — stricter than the coverage-gap check — and reports published before collection began are not judged.
- The panel states plainly that a low rate is not a finding of error: exclusives, regional focus, official releases nobody re-reports and uncollected outlets all lower it.

### Changed
- Generic words (war, end, government, president, minister…) no longer count toward matching headlines, for both coverage gaps and the track record: an IRGC drone headline had matched an unrelated US funding headline through "end" and "war".

### Checked against the real records of 2026-11-21 (judged as if three days later)
BBC 5 of 19 leading reports carried by others, Military Times 2 of 7, NPR 1 of 5, UN 1 of 5, Al Jazeera 0 of 21. Al Jazeera's shared stories had been carried by the BBC first (so its versions were following, not leading); its leading reports covered Gulf, African and Israeli-politics stories the other collected outlets did not carry.


## [0.42.0] — 2026-11-21 — Who's first (Phase 15 item 6)

### Added
- **Who's first** panel on the METERS page (30 days, recomputed each run):
  - **News outlets**: in every story carried by two or more publishers, who published first, how often each outlet was first, and its median delay in hours when it was not.
  - **Sensors and official sources against the news**: earthquakes (USGS M5.5+), internet outages (Cloudflare, IODA), disaster alerts (GDACS orange/red) and UK travel-advice updates in hours; DPRK launches (Yonhap), WHO outbreak reports, sanctions designations and US advisory changes in whole days, because those sources give a date or a fixed hour rather than the real time. Each record is paired with the first news report of the same kind about the same country within 48 hours.

### Changed
- **Story grouping is much faster**: each headline's topic and place words are now computed once per run instead of for every comparison (the gazetteer scan made grouping grow with the square of the input). 3,210 headlines now group in under a second; 214 took about a second before. This also speeds up "What changed", corroboration and coverage gaps.

### Limits
- Feed publication times, collected every 30 minutes: differences under an hour are noise. Pairs are matched by kind of event and country, so some will be coincidences.


## [0.41.0] — 2026-11-21 — Coverage gaps (Phase 15 item 5)

### Added
- **Coverage gaps** per region (METERS grid column GAPS; region strips): stories about the region reported by only one side over 72 hours — Al Jazeera; BBC; US media (NPR, Defense News, Military Times); official sources (UN News, war.gov, UK MOD, IAEA, Air Force, Marines) — that one side ran 2+ times or that are strike reports, while another side had 3+ reports about the region. The detail lists each possible gap with which sides did not carry it, and how many reports each side published.
- Says plainly when only one side reported on the region, or when no side reported enough to assess gaps.

### Checked against the real records of 2026-11-21
The first version flagged five false gaps: the same events told in different words ("Russian missiles hit Poland" on Al Jazeera, "Russian missile hits Poland…" on the BBC; "Kerch Bridge" vs "Crimean Bridge"). A second, looser match now treats a story as covered when another side has a report sharing two content words. Over 10 days of data the remaining possible gaps were plausible: Al Jazeera's two reports on the Saudi-led coalition intercepting Houthi missiles, the BBC's report of Kuwait repelling an Iranian attack, UN News on children killed in Yemen.


## [0.40.0] — 2026-11-21 — People and groups (Phase 15 item 4)

### Added
- **Tracked people and groups** (`shared/domain/actors.ts`, 42 entries, names and spellings only — no titles): Hamas, Hezbollah, IRGC/Quds Force, Houthis/Ansar Allah, al-Shabaab, Wagner/Africa Corps, PLA, China Coast Guard, Netanyahu, Khamenei, Putin, Zelensky, Kim Jong Un, Xi Jinping, Trump, Hegseth and others, each tied to its regions. Counted in record titles and summaries per day (14 days), 24 h / 72 h / 7 d; RISING when 72-hour mentions are 3× the usual level (5+), after 14 days of history.
- **New names**: candidate proper names in sentence-case headlines (BBC, Al Jazeera, UN News, NPR, Defense News, Military Times), minus places, institutions and tracked names, compared with every name seen since tracking began (collector-only registry `collectorState/nameRegistry`, up to 30,000 names). Shown after 2 headlines within 7 days of first appearance. The first run learns the names already in the news without flagging them.
- **People and groups** meter per region (METERS grid column ACTORS; region strips; lead/lag lab), a **People and groups** panel on the METERS page and region pages (counts and a 14-day line per name; new names with a sample headline), and a **New names in the news** section in the daily brief.

### Tuned against the real headlines of 2026-11-21
Names stop at punctuation and possessives ("Steve Rosenberg: Historic …", "India’s Manipur"); phrases containing place words ("Crimean Bridge") and generic capitalised phrases ("Weekly Full Episode", "Coast Guard", "Iron Curtain") are dropped. From 20 raw candidates to 3 real names (Jensen Huang, Gianni Infantino, Steve Rosenberg).


## [0.39.0] — 2026-11-21 — Language temperature (Phase 15 item 3)

### Added
- **Language temperature** per region (METERS grid column TONE, region strips, lead/lag lab): the tone of the region's news headlines over 72 hours, −100 (calming) to +100 (escalating), with a day-by-day breakdown for 7 days, the most frequent listed words, and the hottest and calmest headlines as evidence.
- **Open word lists** in `shared/domain/language.ts`: 24 escalation and 12 de-escalation entries with weights (e.g. airstrike, invasion, mobilisation 2; strike, attack, interception 1; warns, troops 0.5; ceasefire, peace deal 2; talks 1; summit 0.5). A de-escalation word next to a failure word ("ceasefire collapses", "talks stall", "deadlock") counts as escalation.
- Compared with the region's usual temperature once 14 days of history exist; with fewer than 5 headlines the level is capped at GUARDED.

### Tuned against the real headlines of 2026-11-21
Removed false hits: "attack" as an adjective (attack drones), unit and product names ("bomb wings"), weapons named as topics ("missile shortages", now weight 0.5), "deployment" outside military use, "gun down" matched as "downs", "weapon release" read as a prisoner release, and a battlefield retreat read as de-escalation. Added "missiles hit …" as an act. Readings then: Middle East +39, Red Sea +50 (3 headlines, capped), Eastern Europe +17, US +5.


## [0.38.0] — 2026-11-21 — Infrastructure proximity (Phase 15 item 2)

### Added
- **Critical infrastructure dataset** (`public/data/infrastructure.json`, built by `scripts/build-infrastructure.ts`): 941 sites in the watch-region countries — 40 nuclear plants, 458 power plants of 500 MW+, 38 oil refineries, 191 dams, 214 ports.
  - WRI Global Power Plant Database v1.3.0 (CC BY 4.0, data to 2021): plants of 500 MW+ and all nuclear plants.
  - Wikidata (CC0): all nuclear plants and oil refineries; dams and ports with an English Wikipedia article. Wikidata nuclear plants within 5 km of a WRI plant are merged (e.g. Zaporizhzhia / Zaporozhye); Barakah (UAE) comes from Wikidata. Crimea follows the internationally recognised border.
- **Proximity check** (collector, every run, about 0.1 s): records in 72 hours that are near a site — a new fire cluster or an exactly located military record within 10 km of a nuclear plant or 5 km of others (aircraft positions excluded) — or that name it with its type ("Zaporizhzhia nuclear plant", "Port of Odesa"; bare place names never count).
- **Map:** INFRA toggle (off by default) shows all sites by type; flagged sites are always shown, ringed red and labelled. Click any site for a card (fuel and capacity, sources and licences, Wikipedia/OpenStreetMap, matching records).
- **Infrastructure proximity** meter per region (METERS grid column INFRA; region strips; lead/lag lab).

### Limits
- Wikidata misses some major sites (Abqaiq, Kharg Island terminal, Tuapse and Abadan refineries); WRI data stops in 2021 and may include closed plants.
- A fire near an industrial site can be routine (flares, field burning); new-cluster filtering removes standing flares only.


## [0.37.0] — 2026-11-21 — Prediction markets (Phase 15 item 1)

### Added
- Source **polymarket**: odds on geopolitics questions that name a watch region, read about hourly through Polymarket's public, documented Gamma API (no key). Only traded questions (event volume $100k+, market $25k+), one open market per event, up to 40; the US region is never assigned from a market. 36 questions at release (Israel–Iran ceasefire, China–Taiwan, Strait of Hormuz traffic, NATO–Russia, Russia–Ukraine ceasefire, Iranian leadership…).
- A record when a market moves 15 points or more in 24 hours (feeds "What changed", alerts and the watchlist).
- **Prediction markets** meter (largest 24-hour move; in the lead/lag lab) and a **Prediction markets** panel on the METERS page and on region pages (odds, 24-hour change, 14-day line, link to the market). Every view says these are betting odds, not WATCHTOWER's assessment.

### Checked before building
- Polymarket: Terms of Use forbid scraping the website with robots and restrict API data for professional trading firms and market-data resellers; WATCHTOWER uses only the API and is neither.
- Kalshi: not used — its developer agreement forbids storing API data except for your own trading on Kalshi.
- Metaculus: not used for now — its API now requires an account token.


## [0.36.0] — 2026-11-21 — Pentagon after-hours index

### Added
- **Pentagon after-hours** meter (METERS page, US region strip, lead/lag lab): a stand-in for the "Pentagon pizza" idea using real signals of night-time work, 22:00–06:00 US Eastern (daylight saving handled):
  - US defence news posted at night — war.gov, Air Force and Marines, the only US defence feeds whose timestamps carry a real time of day (checked against stored records; the others are stamped at fixed hours);
  - US airborne command posts (E-6B Mercury; E-4B Nightwatch by its 1973–75 serials) and government VIP transports (SAM, SPAR, VENUS, EXEC, AF1/AF2 callsigns) seen on ADS-B at night.
  Each is compared with its usual level over 72 hours; a part counts only with 2 or more night items; withheld until 14 days of history (VIP flights from this release, so their baseline starts 2026-11-21).
- Military aircraft source: command posts and VIP transports are now recorded (with `aircraftRole`), including over the US where routine airlift is skipped. They keep class `other`, so tanker, ISR and airlift indicators and meters do not count them.

### Why not pizza
Google Maps "popular times" — the data behind PizzINT and the Pentagon Pizza Report — has no API, and scraping it breaches Google's terms. The Signal Lab research record for the pizza index now points to this meter.


## [0.35.0] — 2026-11-21 — Meters and monitors (Phase 14)

### Added
- **21 meters and monitors** computed by the collector every run (see [docs/METERS.md](METERS.md)): escalation ladder, evacuation risk and buildup vs noise per region; air surge, naval presence, maritime risk per chokepoint, sanctions pressure, arms flow, Washington attention, diplomatic temperature, strategic weapons, information blackout, economic stress, humanitarian strain, homeland board and cyber weather; days-since counters; a 30-day calendar; corroboration and visibility per region; and a lead/lag lab.
- **METERS page** (new module): region grid, topic monitors, counters, calendar, and a detail view with each meter's parts, evidence, limits and a sparkline of recent runs. **Meters strip** on every region page. **Lead/lag lab** in Signal Lab.
- Meters are stored in `snapshots/meters` (one extra read per dashboard load); a collector-only long history (`collectorState/meterHistory`, 3-hourly, 120 days) feeds the lead/lag lab.
- Launch Library 2: scheduled military launches in the next 30 days are kept for the calendar (same request as before).

### Limits
- Meters that compare against a usual level show BUILDING until 14 days of records exist (around 2026-12-04).
- No meter is a probability of conflict or attack; each shows its evidence and data date.


## [0.34.0] — 2026-11-21 — Watchlist

### Added
- **Watchlist** (Settings → Watchlist): up to 100 people, units, bases or terms, each with up to 5 other spellings. Stored per user at `watchlists/{uid}` (demo mode: this browser only).
- **Highlights:** feed records that name a watchlist item (whole words, title or summary) get an amber edge and a **WATCH: term** tag, on the GOC and region pages. Short all-capital terms (IRGC, PLA) match only in capitals.
- **Alerts:** items set to alert raise one alert per new matching record (chosen level), stored with the other alerts and sent to Discord when a webhook is configured, at most one message an hour per item. Records collected before the item was added never alert.
- Firestore rules: `watchlists/{uid}` readable and writable only by the owner for their own uid; top-level shape and 100-item cap enforced; every save must bump `version` by 1. The collector validates each item and reports an invalid list instead of using it.

### Limits
- Matching is by spelling, not meaning: a name shared by different people or places matches all of them; add other spellings for transliterations.
- Alerts need the collector run after the item is added; matches among older records are highlighted but never alerted.


## [0.33.0] — 2026-11-21 — Activity near bases

### Added
- **Base activity** (collector, every run): for all 3,606 installations on the map, the records this week that name the installation or lie within 50 km of it, against its usual week over up to four earlier weeks of loaded history. About 20 ms per run.
- **Unusual** = at least 3 records from 2+ sources and 3× the usual week. No flags until 21 days of history exist (1.2 days at release, so flags start around Dec. 11); until then the card says the usual level is not yet known.
- Map: amber ring on installations with unusual activity; legend entry with the count (or "building baseline").
- Installation card: **Activity — last 7 days** block (records, how matched, sources, usual level, UNUSUAL tag).

### Changed
- Installation name matching (card and activity): a short name that is only a country or city is no longer used ("Kuwait" for Kuwait Naval Base, "Los Angeles" for Los Angeles Air Force Base), and a site named only after a place ("Pentagon", "West Bank") is matched by location, not name.

### Limits
- Location matches count only military, unrest, aviation, maritime, diplomatic and cyber records; weather warnings, earthquakes, fire detections and disaster declarations near a base are left out.
- A name match is a mention, not an event at the base. Bases that are often in the news have a high usual level, so they are flagged only on a real jump.


## [0.32.0] — 2026-11-21 — What changed

### Added
- **What changed — last 24 h** panel on every region page: indicators that changed state (with from → to and direction), stories whose first report is in the last 24 hours (multi-publisher first), and notable official warnings. The RAI change and record counts stay in the page header.
- GOC Regional Watch: a **24H** line per region (indicators up or down, new stories, warnings).
- Daily brief: new **Indicator changes (24 h)** section.
- Indicator evaluations now record `previousState` (null on a first evaluation), carried while the state is unchanged.

### Changed
- Embassy drawdowns (ordered or authorized departure, suspended operations) now count as notable official warnings in the brief.
- `isNotableWarning` and the news filter moved to `shared/domain/changes.ts`, shared by the brief and the new panels.

### Limits
- Built from the data already loaded (no extra reads): the newest ~700 records on the dashboard.
- Evaluations stored before this release have no previous state, so changes from before it show as "now ELEVATED" rather than from → to, and returns to NORMAL are not shown until the next real change.


## [0.31.0] — 2026-11-21 — Refugee and displacement figures

### Added
- Source 41, **UNHCR Refugee Data Finder** (official API, no key), once a day: four tables (this year and last, by country of origin and of asylum), 32 watch-region countries.
- Region pages: **Displacement — UNHCR** panel with people who fled abroad, internally displaced people (IDPs) and refugees hosted, per country, with the change against the previous year when 5% or more. Countries with no figures are named (Taiwan).
- Context only: no records or indicators, since the figures change twice a year.

### Real data at release (2026 mid-year vs 2025)
- Lebanon IDPs 64,000 → 431,000; refugees hosted 535,000 → 892,000.
- Ukraine: 5.2 million refugees abroad, 3.9 million IDPs. Sudan is outside the watch regions.


## [0.30.0] — 2026-11-21 — Economic stress: currencies and oil

### Added
- Source 39, **exchange rates** (fawazahmed0/exchange-api, CC0): 28 watch-region currencies against the dollar, every 6 hours, compared with 7 and 30 days earlier. A record when a floating currency loses 5% in a week or 10% in a month, or a pegged one 2%; one per currency per week. jsDelivr with the Cloudflare Pages mirror as fallback.
- Source 40, **EIA crude oil spot prices** (Brent, WTI), using the existing api.data.gov key (CONGRESS_API_KEY) in a header. A record on a 10% move in 7 days or 20% in 30 days.
- Catalog v19 (166 indicators): **currency stress** for the seven geographic regions (weight 1) and an experimental **oil price spike** (rises only; weight 0).
- Condition field `metadata.direction`.

### Real data at release
- No watch currency crossed a threshold (largest: shekel 3.9% weaker in 7 days, rial 5.6% in 30 days).
- Brent $92.94 on Nov. 17, down 22% in 30 days (recorded; not counted by the spike indicator).


## [0.29.0] — 2026-11-21 — WHO outbreak reports

### Added
- Source 38, **WHO Disease Outbreak News** (official API; the old RSS returns 404). Every 3 hours; 45 days back-filled (10 reports).
- Countries from the report title ("Disease - Country, Country and Country"; UN-style names such as "the Russian Federation" handled). High-consequence pathogens are flagged in the title: Ebola, Marburg, Lassa, CCHF, Nipah, MERS/SARS, novel and avian influenza, plague, anthrax, hantavirus, and clusters of unknown cause.
- Catalog v18 (158 indicators): **WHO outbreak report** for the seven geographic regions (1 = elevated, 2 in 30 days = triggered; weight 1).


## [0.28.0] — 2026-11-21 — Military space launches

### Added
- Source 37, **Launch Library 2** (The Space Devs, free, no key): completed orbital launches whose mission is "Government/Top Secret", whose operator is military (e.g. Russian Space Forces, South Korea's Agency for Defense Development, IRGC), or that come from North Korea or Iran. Every 3 hours; 30 days back-filled (8 launches).
- Owner country = launch site's country, except Baikonur (Kazakhstan) = Russia. Records belong to that country's region (US launches to the United States region; China is in no watch region).
- Catalog v17 (151 indicators): **North Korean space launch** (high), **Iranian space launch**, and an experimental **global military launch tempo**.


## [0.27.0] — 2026-11-21 — Satellite imagery

### Added
- **IMAGERY** control on the GOC map (off by default): NASA GIBS daily global mosaics under the map labels and all WATCHTOWER overlays.
  - True colour, VIIRS NOAA-20 (~375 m) and MODIS Terra (~250 m), any day; defaults to yesterday, since today's mosaic is still being filled in.
  - Night lights, VIIRS NOAA-20 day/night band, any day; and the **Black Marble 2016** baseline of normal night lights for comparison.
- The legend names the product and day, with its limits (clouds, swath gaps, moonlight), and credits NASA EOSDIS GIBS.
- Security policy: `gibs.earthdata.nasa.gov` allowed for images and tile requests.

### Notes
- Suomi-NPP products are no longer served (404 on 2026-11-21); NOAA-20 is used. Imagery is loaded by the browser only when turned on; the collector does not use it.


## [0.26.0] — 2026-11-21 — Congress

### Added
- Source 36, **Congress.gov** (free api.data.gov key, `CONGRESS_API_KEY` secret, sent in a header): war-powers and use-of-force resolutions, arms-sale and nuclear-cooperation disapprovals, NDAA actions, and hearings of the armed services, intelligence, foreign affairs/relations and homeland security committees. Every 2 hours; one record per measure and latest action (introduction, committee step, floor vote); 30 days back-filled.
- Catalog v16 (148 indicators): **Congress war-powers action** (weight 2) and **Congress security attention** (experimental) for the six foreign regions.
- Skipped as NOT CONFIGURED until the key is set.


## [0.25.0] — 2026-11-21 — Federal Register

### Added
- Source 35, the **Federal Register API** (free, no key): security- and foreign-policy executive orders and presidential documents, **new or terminated national emergencies**, Commerce (BIS) **export-control rules**, and State Department **terrorist designations and revocations**. Three small queries every 2 hours; 30 days back-filled.
- Skipped: commemorative proclamations, routine annual continuations of national emergencies, unrelated orders, and OFAC notices (the sanctions lists cover them). Countries from the title and abstract.
- Catalog v15 (136 indicators): **US national emergency declared** (weight 2, high) and **US executive actions** (experimental) for the six foreign regions.

### Fixed during testing (real data)
- "Era of Super Intelligence" (an AI order) matched on "intelligence"; a procedural State notice mentioning designations was counted as one.


## [0.24.0] — 2026-11-21 — DoD contract awards

### Added
- Source 34, **DoD daily contract announcements** (war.gov; every award of $7.5 million or more, about 11 a business day). The RSS is read every run with a conditional request; each new day's page once.
- Each award is parsed for service, contractor (or "N companies (multiple-award)"), amount, purpose, contract number, munitions, and Foreign Military Sales customers. Amounts of IDIQ, "maximum" and not-to-exceed awards are labelled **ceiling**.
- Only notable awards become records: **$1 billion or more**, **munitions of $100 million or more**, and **any FMS award to a watch-region partner** (tagged to the partner's region). In 10 real days: 92 awards, 6 records.
- Catalog v14 (124 indicators), experimental: **munitions and missile contract awards** (US) and **US arms-sale contract awards** per foreign region.

### Fixed during testing (real data)
- "Missile Range instrument" ships were counted as munitions; multiple-award ceilings were not labelled; "for fiscal 2027 … production" was taken as the purpose.


## [0.23.0] — 2026-11-21 — US embassy drawdowns

### Added
- The State Department advisory adapter now reads each advisory's **embassy posture**: ordered or authorized departure of US government staff, and suspended embassy operations ("lifted" / "ended" / "resumed" wording counts as none).
- When a reissued advisory adds or lifts one of these, a separate record is created, e.g. "Iraq: ORDERED DEPARTURE of US government staff — State Department travel advisory (Level 4)". Advisory records also carry `departure` and `operationsSuspended`.
- Catalog v13 (117 indicators): **US embassy drawdown** for the six foreign watch regions (30 days; weight 3, high).
- On 2026-11-21 the advisories state an ordered departure for Belarus, and suspended operations for Yemen, Sudan, Afghanistan, Russia and Belarus. These standing conditions are the baseline; only changes are recorded.

### Checked and not used
- US embassy sites (*.usembassy.gov, including their security-alert RSS) refuse all scripted requests (CloudFront 403 "Technical Difficulties", for curl too).


## [0.22.0] — 2026-11-21 — North Korean launches and nuclear tests

### Added
- Source 33, **Yonhap News Agency** (English all-news RSS): headlines reporting that North Korea fired missiles, rockets or a satellite, or conducted a nuclear test. One record per kind and Korea day, rewritten as the URGENT / LEAD / LD versions of the story arrive. Forecasts and warnings ("may fire", "preparing") are excluded.
- Catalog v12 (111 indicators): **North Korean missile launch** (1 launch day = elevated, 2 in a week = triggered; weight 2, high) and **North Korean nuclear test reported** (30 days; weight 3, high). The USGS explosion-typed seismic indicator remains the independent check for a test.

### Checked and not used
- Japan Ministry of Defense notices are the best official source (times, apogee, range, EEZ), but the site’s Cloudflare protection challenges scripted clients; getting around it would mean evading bot protection. The CNS North Korea missile database and CTBTO are behind the same kind of challenge; South Korea’s JCS has no feed.

### Limits
- Yonhap is a news agency, usually citing South Korea’s Joint Chiefs of Staff; first reports change. The feed holds about two days, so there is no history before 2026-11-21.


## [0.21.0] — 2026-11-21 — UN Security Council

### Added
- Source 32, **UN Security Council**: every meeting (verbatim record or closed-meeting communiqué) and adopted resolution from the **UN Digital Library** (MARC XML), and failed drafts and vetoes from the **UN press-release RSS**. Read every 2 hours.
- Meetings are tagged to countries from the UN catalogue's own subject terms and the agenda (UN names such as "Iran (Islamic Republic of)" and "Territories occupied by Israel" mapped).
- Resolutions show the tally and who voted against or abstained (e.g. Haiti GSF, 12-0-3: China, Pakistan and Russia abstained).
- Catalog v11 (109 indicators): **Security Council attention** (meetings above the 28-day baseline) and **draft fails or is vetoed** (30 days, weight 2, high) for the six foreign watch regions.

### Limits
- The Security Council website refuses scripted requests (bot challenge), so the programme of work and "emergency meeting" labels are not available. Meetings are catalogued 1–3 days late. Vetoes are read from press-release titles; the feed holds only the latest 10 items, so a check every 2 hours is needed to keep up.


## [0.20.0] — 2026-11-21 — Sanctioned vessels on AIS (Baltic and North Sea)

### Added
- Source 31, **sanctioned vessels on AIS**: each collection run listens to aisstream.io for 25 seconds over the Baltic Sea (incl. the Gulf of Finland) and the North Sea + Channel, while the other sources are collected, so the run is not longer.
- Ships are matched against the vessels on the OFAC, EU and UK sanctions lists: by **IMO** from the ship's own identity message (permanent; survives re-flagging, and the MMSI is then remembered) or, for OFAC entries, by **MMSI** (dropped when the ship's identity message shows a different IMO, i.e. a reassigned MMSI).
- **SANCTIONED** map layer on the GOC: pink ship icons for sightings in the last 48 hours (faded after 6 hours); the card shows the lists, programmes, match basis, broadcast name, speed, course and destination.
- Records: one per vessel, area and day. Catalog v10 (97 indicators): **sanctioned vessels in the Baltic** (Eastern Europe, experimental).
- Adapters can read other sources' saved state (the sanctions lists' vessel identifiers).

### Limits
- Only ships with AIS on, near volunteer receivers, during the 25-second window. Identity messages come every ~6 minutes, so IMO matches build up over several runs.


## [0.19.0] — 2026-11-21 — Sanctions (OFAC, EU, UK)

### Added
- Sources 28–30: the **US OFAC SDN list**, the **EU consolidated financial sanctions list** and the **UK Sanctions List** (official XML files, 20–30 MB each). OFAC is checked every run with a conditional request; the UK every 6 hours; the EU once a day (its file takes over a minute to generate).
- New designations are found by comparing each list with its previous copy. EU and UK entries carry designation dates, so their first run back-filled 30 days; OFAC entries have no dates, so its first run only stores a baseline.
- Records: one per list, day and target country, e.g. "UK sanctions: 20 new designations targeting Russia — 11 vessels, 9 entities". The target country comes from the sanctions programme; for thematic programmes (terrorism, cyber, human rights) the wording is "linked to …", from addresses and nationality. Vessel flags are never used (flags of convenience).
- Sanctioned vessels with identifiers are kept for item 4b: OFAC 1,570 (840 with MMSI), UK 693 (IMO), EU 41 (IMO).
- Catalog v9 (96 indicators): **new sanctions designations** (against a 28-day baseline) and **large sanctions package** (25+ in one batch) for the six foreign watch regions.
- Adapters can raise the download size and time limits per request (official files up to 64 MB).

### Limits
- Removals from the lists are not recorded. A designation is a legal measure, not proof of the conduct alleged.


## [0.18.0] — 2026-11-21 — Chokepoint traffic (IMF PortWatch)

### Added
- Source 27, **IMF PortWatch daily chokepoint transits** for the Strait of Hormuz, Bab el-Mandeb, Suez Canal, Bosporus, Taiwan Strait and Malacca Strait. One small query a day; the 2025 averages and chokepoint points monthly.
- Status per chokepoint from the last 7 days: **reduced** (under 70% of the 2025 average), **severely reduced** (under 40%), or **sudden drop** (40% below the previous four weeks).
- **STRAITS** map layer on the GOC: a diamond per chokepoint coloured by status and labelled with the change. The card has a 90-day trend against the 2025 average, with hover for daily counts.
- Records weekly while a chokepoint is disrupted, and once when it returns to normal.
- Catalog v8 (84 indicators): **chokepoint traffic reduced** (weight 1) and **severely reduced or falling fast** (weight 3) for the Middle East (Hormuz), Red Sea (Bab el-Mandeb), Eastern Europe (Bosporus) and Taiwan Strait.
- First run (2026-11-21): Hormuz severely reduced (2.3 ships a day vs 85.5 in 2025, −97%), Bosporus reduced (48.6 vs 92.4, −47%).

### Decided
- aisstream.io was evaluated with a real key and rejected: no coverage at any of the five chokepoints (see the source registry). The probe was removed.
- IMF terms prohibit automated bulk download without permission. The owner chose to use PortWatch anyway, with a minimal footprint and attribution; recorded in the source registry.


## [0.17.1] — 2026-11-21 — Aircraft regions by country and open water

### Fixed (found on live data)
- Aircraft records were assigned to a watch region whenever the position fell inside the region's box, and the boxes also cover neighbouring countries: an Italian C-27J over Slovakia was recorded as Eastern Europe. An aircraft now counts for a region only when it is over one of the region's countries, or over open water inside the box. Over any other country it is not recorded.
- Borders for every non-watch country added (`collector/geo/other-countries.json`, Natural Earth 1:50m, public domain, built by `scripts/build-other-countries.ts`). Somaliland counts with Somalia.
- The one stored record affected was corrected in place by `scripts/retag-aircraft.ts`, with a note; nothing was deleted.

### Limits
- Over US coastal waters an aircraft does not count for the United States region (US borders only).


## [0.17.0] — 2026-11-21 — US Navy fleet (USNI News)

### Added
- Source 26, the **USNI News Fleet and Marine Tracker** (weekly), read from the main USNI News feed, which carries the full text. Each tracker is parsed into named areas ("Arabian Sea", "Sasebo, Japan") and the ships listed in them.
- **FLEET** map layer on the GOC: a ship marker with a wide faint halo at each named area's reference point, brighter where a carrier or big-deck amphibious ship is listed, labelled with hull numbers. The card lists the ships, the tracker date and its age, and links to the article. Areas too vague to place ("Japan", "Pacific Ocean") are not drawn.
- Records when a carrier or big-deck amphibious ship appears in a new area compared with the previous tracker (about one to five a week).
- Catalog v7 (76 indicators): **US carrier or big-deck arrival** for the Middle East, Red Sea, Eastern Europe, South China Sea, Taiwan Strait and Korean Peninsula (21-day window; 1 = elevated, 2 = triggered; weight 2).
- Feed parser: reads RSS `content:encoded`.

### Limits
- Weekly and approximate: positions are up to a week old, by named area only. Some weeks are missing from the feeds. Submarines and most auxiliaries are not listed.


## [0.16.0] — 2026-11-21 — Military aircraft (ADS-B)

### Added
- Source 25, **military aircraft on ADS-B** (adsb.lol, ODbL; falls back to adsb.fi). Each collection run takes a snapshot of every aircraft the network flags as military, about 40 to 90 with a position worldwide.
- **AIR** map layer on the GOC: plane icons pointing along their track, coloured by class (tanker, surveillance/command, bomber, airlift, fighter, helicopter, other). Callsigns from regional zoom. A card shows callsign, type, altitude, speed, position age and a link to the live track. Positions older than 90 minutes are not drawn.
- Records for tankers, surveillance/command aircraft, bombers and airlift inside the watch areas: one per aircraft, area and day. Airlift is not recorded for the US, where it is constant.
- Catalog v6 (70 indicators), all experimental (weight 0): tanker/surveillance/bomber activity per region, and airlift activity per region except the US, each against a 14-day baseline.

### Limits
- Only aircraft that broadcast ADS-B are seen; many military flights do not. Coverage is thin over the Gulf, Red Sea and Taiwan Strait.
- KC-46, KC-10, A330 MRTT and E-4B share airliner type codes, so they show as "other".


## [0.15.1] — 2026-11-21 — Filter bases by operating country

### Added
- Operator filter next to BASES on the GOC map: all operators, or one country (each listed with its count, largest first). DoD sites count as US. Where Wikidata records no operator, the host country is assumed and the card says so. Former states (Soviet Union, Yugoslavia) are not listed. BASES off still hides every base. The choice is saved per device.
- Installation card: OPERATOR COUNTRY line.


## [0.15.0] — 2026-11-21 — Military installations worldwide

### Added
- 2,775 current military installations outside the US from Wikidata (CC0), drawn as rings coloured by who operates them: US-operated abroad (94 sites, e.g. Ramstein, Kadena), other foreign-operated (e.g. Russia at Khmeimim and Tartus), national or not recorded. On the GOC map and the region pages.
- Installation card for worldwide sites: type, host country, operators (may include former), Wikipedia/Wikidata/OpenStreetMap links, related records.
- `scripts/build-installations-world.ts` (one query per class; the endpoint times out on a single query).

### Changed
- Installation markers fade when zoomed out. Short-name matching now uses the host country (was US-only), and knows international base names ("Air Base", "RAF").


## [0.14.0] — 2026-11-21 — Military installations (United States)

### Added
- BASES map layer: 831 US military installations from the DoD MIRTA dataset (2024, CC BY 4.0), coloured by branch, faded when inactive, labelled when zoomed in. Also on the USA region page.
- Installation card: dataset facts, FAA flight restrictions and WATCHTOWER records that name it or lie within 50 km, each with the reason; Wikipedia and OpenStreetMap links.
- `scripts/build-installations.ts` rebuilds the data file from the official source.

### Fixed (found while checking real data)
- Short-name matching would have linked "Clear", "Hill", "March" and "Hawaii" to unrelated stories, and English "Norfolk" to Naval Station Norfolk. Short names now count only in US records, and common words, surnames and big-city names are excluded.


## [0.13.0] — 2026-11-21 — United States (domestic) watch

### Added
- Eighth watch region, United States (domestic): events inside the US, with emphasis on the military and homeland security. A bare "US" in a headline never counts; US places, US-based sources and US borders do. US bases abroad map to their host countries.
- 9 sources (24 total): FAA security/VIP flight restrictions, DHS NTAS, FEMA declarations, NWS Extreme alerts, Air Force and Marine Corps news, Military Times, Defense News, NPR National; BBC US & Canada feed.
- Catalog v5 (57 indicators): NTAS advisory, military-installation incident (2 independent sources to trigger), National Guard deployment, security flight-restriction burst, major disaster.
- Region page: a States panel for the US.

### Fixed (found on live data)
- A Central/South America trip and a US base in Japan (Kadena) were first counted as domestic.


## [0.12.0] — 2026-11-21 — Region pages

### Added
- REGIONS index and one page per watch region: RAI with 24 h change and score breakdown in RAI points, recent RAI runs, every region indicator, a 7-day map, latest relevant reports grouped as stories, countries and categories. Linked from the GOC watchlist and the `REGION <code>` command. No extra database reads.
- OPINION tag on opinion columns (feed and region pages); the daily brief already excludes them.


## [0.11.0] — 2026-11-21 — Daily brief

### Added
- Daily brief to Discord: RAI and 24 h change, active indicators, notable official warnings, top stories (multi-source first, opinion and off-topic excluded), collector health. Sent once a day at/after 11:00 UTC, with retries; deterministic and source-linked.
- Collect workflow: `send_brief` option for a manual test send; dashboard URL for links in Discord messages.
- Dry runs print the brief.


## [0.10.2] — 2026-11-21 — Relevant topics only

### Changed
- News items are now shown only when their headline is about a relevant topic: security, politics, law and rights, humanitarian, economy and energy, disasters. Previously only sport, entertainment and similar pieces were hidden. Watch regions do not decide relevance. 17 of 78 live news items were hidden on the first check.


## [0.10.1] — 2026-11-21 — Off-topic news hidden

### Added
- Sport, entertainment, arts, science and lifestyle news items are marked OFF-TOPIC and hidden by default in the feed, the map, the region report counts and SITREP. A feed toggle shows them, with the reason on each. Security stories, watch-region stories and classified topics are never hidden.


## [0.10.0] — 2026-11-21 — Stories

### Added
- Stories: the feed groups reports of the same event from different headline feeds into one entry. It shows the publishers, a corroboration label (1 publisher / N publishers / official included), the shared words that grouped them, and every report with its link. A STORIES ON/OFF toggle switches back to all items. Computed in the browser, so it costs no Firestore reads.
- Checked against live headlines: page-template groups from one official publisher, and place-name-only matches, were found and excluded.


## [0.9.4] — 2026-11-21 — Firestore read cost

### Fixed
- Each run re-read every event from the last 31 days (up to 2,000, and truncated beyond that). With 15 sources, hourly collection would have exceeded the Spark free tier of 50,000 reads/day within about 2–3 weeks, and the cap would have cut baselines short. The collector now keeps a day-bucket cache (`eventDays`): ~45 reads per steady run, measured on the emulator, with no cap.
- New-item checks read only ids outside the cache.

### Added
- Each run logs its Firestore document reads.

### Changed
- Collection every 30 minutes (external scheduler at :00 and :30); GitHub fallback every 6 hours at minute 15.


## [0.9.3] — 2026-11-21 — Health check fixes

### Fixed
- GitHub's schedule skipped five hourly collections in a row. Collect can now be started hourly by an external scheduler (workflow_dispatch with `trigger: schedule`); GitHub's cron is a 4-hourly fallback.
- IODA: outages seen only on the Google Transparency Report signal are no longer imported (multi-day false "outages" in Finland and Norfolk Island).
- Outage and fire-cluster titles include their start date, so repeated events for one country are distinguishable.


## [0.9.2] — 2026-11-20 — Cloudflare Radar live

### Fixed
- First live Radar run (15 outages): 8 had no location because network-scoped outages keep their country in the network details; 3 of those were attributed to military action. Countries now come from both places.
- Links to Cloudflare's internal tracker are replaced by the public Outage Center page.

### Added
- Revisable sources: a source can declare that it edits items after publication. Changed records are rewritten in place, keeping the original `collectedAt` and adding `metadata.revisedAt`. Cloudflare Radar uses this.


## [0.9.1] — 2026-11-20 — FIRMS live; country check

### Fixed
- First live FIRMS run (12,373 detections → 15 new clusters): 9 "Korea" clusters were in north-east China, plus one each in Sudan and Turkey, because watch areas are rectangles. Clusters are now kept only inside the region's own countries (Natural Earth 1:50m borders, collector-only), and carry a country code. The 15 stored records were re-tagged in place, with a correction note; none deleted.


## [0.9.0] — 2026-11-21 — Free-key sources

### Added
- NASA FIRMS adapter: new satellite fire clusters (novelty filter removes gas flares and continuing fires).
- Cloudflare Radar adapter: analyst-annotated internet outages with an attributed cause.
- Catalog v4 (48 indicators): attributed shutdown or military-action outage per region; experimental new-fire-cluster volume.
- Secret registry: API keys come only from the environment and are redacted from errors and logs. Sources without a key are skipped as NOT CONFIGURED.

### Rejected
- ACLED: no API on personal accounts; the EULA excludes this kind of dashboard use.


## [0.8.0] — 2026-11-20 — Source expansion

### Added
- 10 collectors (13 total): UK FCDO travel advice, USGS earthquakes, GDACS, IODA internet outages, U.S. DoD news, UK MOD, IAEA, UN News, BBC World (4 feeds), Al Jazeera.
- Generic RSS/Atom adapter; headline gazetteer and keyword topic classifier, with the basis recorded on every record; `general` news category.
- First exact-coordinate records on the map (USGS, GDACS).
- Indicator catalog v3 (36 indicators): FCDO updates and IODA connectivity drops per region, Korea non-earthquake seismic events, experimental media conflict-reporting volume.
- `collector/inspect.ts`: shows how live items would be tagged, without writing anything.

### Changed
- The dashboard snapshot holds 700 events (was 400). Summaries in the snapshot are cut to 280 characters; full text stays in the archive.

### Fixed
- Atom summaries in XHTML form (GOV.UK) were read as empty.

## [0.7.0] — 2026-11-20 — Phase 7: Refinement & deployment

### Added
- Deployed to Firebase Hosting (https://watchtower-b9b2a.web.app) with CSP, HSTS, Permissions-Policy, COOP and cache headers.
- Playwright end-to-end suite: 57 tests (every module, key flows, mobile, CSP violations, axe WCAG A/AA). Runs in CI.
- Skip-to-content link; module error boundary; one-time reload when a chunk from an older deploy is missing.

### Changed
- Route modules are code-split: first-load JavaScript falls from 469 KB to 285 KB (144 KB to 91 KB gzipped).
- `fg-dim` and `inactive` text colours lightened to meet WCAG AA contrast (4.6:1 or better).

### Security
- SITREP and dossier Markdown exports collapse and escape source text, and say that quoted source text is data, not instructions. This guards against prompt injection from feed content when an export is pasted into an AI assistant.


## [0.6.0] — 2026-11-20 — Phase 6: Advanced analysis

### Added
- SITREP generator: deterministic, eight sections, source-linked, backfill separated, limitations; Markdown "Export Intelligence Context".
- Historical Operations Replay: hindsight-safe (collectedAt ≤ T), re-runs the indicator engine per frame, LATE tags, hidden-by-default hindsight panel with later outcomes.
- Signal Lab: record-volume and RAI-history charts, backtesting against dossier outcomes (lead times, misses, false alarms, co-activation, data sufficiency), experimental research records.
- Collector writes one `raiHistory` point per run; owner-read-only security rule and test.
- Catalog v2: research metadata for experimental signals; new experimental "State Dept advisory tempo (global)".
- Bounded archive service with read counts and truncation reporting.

### Fixed (found during verification)
- Replay and backtest windows rounded the end down to the hour, excluding the most recent collection.
- Charts scaled text with the container; they now draw at real pixel width.


## [0.5.0] — 2026-11-20 — Phase 5: Incident dossiers

### Added
- Incident model (`shared/domain/incidents/`): denormalized evidence records, operator assessments, notes, linked dossiers, attached indicators; full validation.
- Three-clock timeline (occurred / published / collected) with flagged fallbacks and reporting/collection lags.
- Deterministic, explainable related-record suggestions.
- Markdown evidence-packet export with analytical caveats.
- UI: dossier index, dossier workspace (draft + save, discard, unsaved-changes guard, conflict reload), + DOSSIER on feed items.
- Security rules for `incidents`: owner-only, shape/size limits, `version` must increase by exactly 1, `createdAt` immutable; emulator tests.

### Fixed
- Suggestions no longer link records on advisory boilerplate ("Do Not Travel").


## [0.4.0] — 2026-11-20 — Phase 4: Alerting

### Added
- Alert rule model and validation (`shared/domain/alerts/`): event, indicator-state and RAI-crossing triggers; edge-based evaluation; first-look semantics for new rules; browser test mode.
- Collector alert stage: deterministic alert ids, write-before-notify, per-rule cooldown, one Discord message per rule per run, delivery outcome recorded, failures reported (exit 2).
- Discord delivery: strict webhook URL validation, markdown/mention neutralization, `allowed_mentions` empty, single 429 retry, URL never logged.
- UI: Alert Center (inbox with ack/dismiss, rules list, graphical rule builder with JSON mode and live validation), top-bar open-alert counter, alert delivery status in status strip and Diagnostics.
- Workflows: `DISCORD_WEBHOOK_URL` passed to Collect; new *Test alert delivery* workflow.
- Security rules for `alertRules` (shape-validated owner writes), `alerts` (ack/dismiss only), `collectorState` (hidden) with emulator tests.

### Fixed
- Relative ages no longer show "+<1m" for timestamps a few seconds ahead of a stale clock.


## [0.3.0] — 2026-11-20 — Phase 3: Indicator & Warning Engine

### Added
- Declarative condition language with allow-listed fields and own-property lookups (`shared/domain/indicators/conditions.ts`).
- Deterministic indicator evaluator with source-health gating (UNKNOWN / DATA_UNAVAILABLE), windows, distinct-source corroboration, baselines with history-sufficiency checks, evidence capture, and state continuity.
- Regional Activity Index v0: coverage, per-source cap (60%), severity weighting, bands, 24 h change from recorded history, full breakdown.
- Catalog v1 (16 indicators) built only on sources actually collected; Pentagon Pizza Index kept as experimental with NO DATA.
- Collector evaluates after every run (one events query feeds both evaluation and snapshot), logs transitions to `indicatorHistory`, supports `--evaluate-only`; snapshot schema v2.
- UI: Indicators page (thresholds, baselines, conditions, evidence links, experimental section, browser preview), RAI and breakdown in the watchlist, evidence tags in the feed, live indicator status.
- `firstSuccessAt` on source status.

### Fixed
- CISA "Adds N KEV to Catalog" announcements were counted as non-routine alerts, double-counting KEV evidence; now classified `kev-announcement` and excluded.
- Guidance documents (`/resources-tools/`) classified as `guidance` (routine).


## [0.2.0] — 2026-11-20 — Phase 2: live collection

### Added
- Collector (`collector/`) on Node 24 type-stripping: polite HTTP client, entity-safe RSS/Atom parser, RFC-822 date parser, sanitization, validation gate, content-hash idempotency.
- Adapters: State Dept travel advisories (level-change detection, FIPS→ISO mapping), CISA advisories, CISA KEV.
- Firestore store (Admin SDK) and in-memory store; dashboard snapshot (1 read per dashboard load).
- GitHub Actions workflows: hourly `Collect`, `CI`, and `Grant owner`.
- Browser: lazy-loaded Firebase SDK, Google sign-in with popup→redirect fallback, owner custom-claim gate, Firestore repository, auto-refresh, live source health, OVERDUE detection, real Diagnostics, feed badges (LEVEL ▲/▼, ROUTINE, RANSOMWARE).
- Firestore security rules (owner claim, read-only collected data) with emulator tests.
- Emulator workflow scripts: `emulators`, `collect:emulator`, `dev:emulator`, `grant-owner:emulator`.

### Verified
- Real sources → emulator: 2,034 items fetched and 75 imported; a second run imported 0 (30 duplicates suppressed, KEV returned 304).
- 69 unit/component tests and 6 rules tests pass; the production dependency audit is clean.

### Known limitations
- The production project is not connected yet (operator steps in DEPLOYMENT.md §2).
- `firebase-tools` (dev-only CLI) carries 13 moderate transitive advisories; none of it ships to the browser or the collector.

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
