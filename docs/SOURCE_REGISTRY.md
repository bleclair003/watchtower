# Source Registry & Feasibility Matrix

Machine-readable version: [`shared/domain/sources.ts`](../shared/domain/sources.ts) — keep both in sync.

**Probe method (2026-11-20):** single `curl` GET per endpoint from a residential connection, following redirects, with a descriptive User-Agent. "Reachable" confirms the endpoint returned parseable content on that date, nothing more. **Active collectors (v0.8.0): 13.** `state-travel-advisories`, `cisa-advisories`, `cisa-kev` (since v0.2.0); `uk-fcdo-travel`, `usgs-earthquakes`, `gdacs`, `ioda-outages`, `war-gov-news`, `uk-mod`, `iaea-news`, `un-news`, `bbc-world`, `aljazeera` (since v0.8.0). Second probe round: 2026-11-20 21:45 UTC. All other sources read `NOT CONFIGURED` until an adapter is written.

## P1 — first adapters (Phase 2): State Dept + CISA implemented ✅

| Source | Official URL / endpoint | Information | Method | Auth | Free | Update freq. | Probe | Reliability concerns |
|---|---|---|---|---|---|---|---|---|
| U.S. State Dept Travel Advisories | `https://travel.state.gov/_res/rss/TAsTWs.xml` | Per-country advisory level 1–4 | RSS | None | Yes | Several / week | ✅ 200, 218 items | `Country-Tag` is **FIPS 10-4, not ISO** (RS = Russia, IS = Israel; Gaza and the West Bank share IS). It is mapped through a tested table; "French West Indies" is deliberately left unmapped. The ETag is weak and changes often, so changes are detected by comparing against each advisory's stored level. |
| CISA Cybersecurity Advisories | `https://www.cisa.gov/cybersecurity-advisories/all.xml` | ICS advisories, alerts, joint advisories | RSS | None | Yes | Daily+ | ✅ 200 | Uses **two-digit years** (`Thu, 19 Nov 26`). ICS advisories are tagged `routine`. The feed sends no validators (`no-cache`), so de-duplication is by content hash. |
| CISA KEV Catalog | `https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json` | Vulnerabilities exploited in the wild | JSON | None | Yes | Several / week | ✅ 200 | 1,786 entries. A strong ETag means most runs get `304 Not Modified`. One event per newly added CVE; known ransomware use is flagged. |
| GDELT DOC 2.0 | `https://api.gdeltproject.org/api/v2/doc/doc` | Global news coverage search, volume timelines | API | None | Yes (1 req / 5 s) | 15 min | ⚠️ **429 rate-limited** on 2 probes | Media coverage, **not** confirmed events. Strict serialization, ≥6 s spacing, few queries per run. Re-test from Actions runners (shared IPs may be throttled harder). |

**PDD substitution:** the PDD suggested State Dept + GDELT as the first two adapters. Recommendation: **State Dept + CISA (advisories + KEV)** first. Both are reliable and structured, and they cover the Diplomatic and Cyber watches. Add GDELT third, once rate-limit behaviour from Actions is confirmed, as a *context* source rather than an evidence source.

## v0.8.0 expansion — implemented ✅

| Source | Endpoint | Class · credibility | Geography | What WATCHTOWER keeps | Caveats |
|---|---|---|---|---|---|
| UK FCDO travel advice | `https://www.gov.uk/foreign-travel-advice.atom` | official · official | Country from the page title | Every page update, with FCDO's own change note | No numeric level in the feed, so none is inferred. Many updates are routine edits. Atom summaries are XHTML; the parser now flattens them. |
| USGS earthquakes M4.5+ | `…/summary/4.5_day.geojson` | scientific · official | **Exact** epicentre; region by watch-area box | One record per USGS event id; magnitude, depth, USGS `type`, tsunami flag, PAGER alert | No country (USGS gives a place description, not a code). The USGS `type` can change after review. |
| GDACS | `https://www.gdacs.org/xml/rss.xml` | scientific · official | **Exact** event point; ISO3 country when given | Orange/Red worldwide; Green only inside watch areas; a level change is a new record | ~700 KB feed, mostly Green wildfires. CC BY 4.0. |
| IODA outages | `https://api.ioda.inetintel.cc.gatech.edu/v2/outages/events` | scientific · official | Country (from IODA's entity code) | Country-level outages lasting **≥ 4 h**; re-reads a 3-day window each run; Google-traffic-only (`gtr`) events skipped since v0.9.3 | A connectivity drop is not proof of a shutdown: power cuts, cable faults and artefacts look the same. ~300 country events/week, median ~1 h, hence the threshold. |
| U.S. DoD (war.gov) news | `…/RSS.ashx?ContentType=1&Site=945&max=10` | official · official | Headline gazetteer (country/region, never coordinates) | Every release | Mostly U.S.-domestic; few geographic tags. |
| UK MOD | `…/ministry-of-defence.atom` | official · official | Headline gazetteer | Every announcement | OGL v3.0. |
| IAEA Top News | `https://www.iaea.org/feeds/topnews` | official · official | Headline gazetteer | Every item | `pubDate` is `YY-MM-DD HH:mm` with no timezone; read as UTC (may be up to 2 h off). |
| UN News | `…/news/all/rss.xml` | official · official | Headline gazetteer | Every item; topic by keyword classifier | Region-specific UN feeds returned no items. |
| BBC News World | 4 feeds: world, middle_east, europe, asia | media · single-source | Headline gazetteer | Articles only (video/live pages skipped); de-duplicated across feeds | BBC RSS terms: personal non-commercial use, headline + summary + link. |
| Al Jazeera English | `https://www.aljazeera.com/xml/rss/all.xml` | media · single-source | Headline gazetteer | Articles only | State-funded (Qatar). |

### How geography and topic are assigned for text feeds

- **Gazetteer** ([`shared/domain/geo/gazetteer.ts`](../shared/domain/geo/gazetteer.ts)): explicit names, unambiguous demonyms, capitals and major cities, and a few armed groups tied to one territory (Hamas → PS, Hezbollah → LB, Houthis → YE). It reads the **headline only**. Longest names match first ("Papua New Guinea" before "Guinea"); abbreviations such as US, UK and UAE are case-sensitive.
- **Excluded as ambiguous:** bare "Georgia", "Congo" and "Korea"; "Jerusalem"; "Aden"; "Washington".
- **What gets stored:** country or region precision, never coordinates. `metadata.geoBasis = 'text-mention'` and `metadata.geoTerms` record exactly which words matched. The feed shows a **TXT-GEO** tag and spells out the basis.
- **Limits:** a headline that mentions a country is about that country in some way, but the event may be elsewhere. "Japan scrambles jets after Russian incursion" is tagged JP and RU, so it lands in Eastern Europe because of RU.
- **Topic classifier** ([`collector/lib/topic.ts`](../collector/lib/topic.ts)): keyword lists checked in priority order: cyber, military, maritime, aviation, unrest, disaster, diplomatic, economic. A headline with no keyword is filed as **General news**. The matched keyword is stored in `metadata.topicTerm`. Figurative "coup" was a false positive, so only literal phrases ("military coup", "coup attempt") count.
- **Tool:** `node collector/inspect.ts <source-id>…` prints how each live item would be tagged, and writes nothing.

## v0.9.0 free-key sources — built; active once a key is set

These sources skip as `NOT CONFIGURED` (not failed) until their secret exists. Keys are read only from environment variables, and are registered for redaction from every error and log line. The tests use synthetic responses built to the documented formats.

| Source | Endpoint | Key | What WATCHTOWER keeps | Caveats |
|---|---|---|---|---|
| NASA FIRMS (VIIRS NOAA-20 NRT) | `/api/area/csv/[MAP_KEY]/VIIRS_NOAA20_NRT/[bbox]/[days]`, one request per geographic watch area | `FIRMS_MAP_KEY`: free, by email at <https://firms.modaps.eosdis.nasa.gov/api/map_key/> | **New** fire clusters only: ≥ 3 nominal/high-confidence detections in a 0.25° cell after 7 days with none. Point = strongest real detection. Kept only if that point is inside one of the region's own countries (Natural Earth 1:50m borders; Crimea → UA). The rectangle alone put north-east China in KOREA on the first live run (2026-11-20); the 15 records from that run were corrected in place by `scripts/retag-firms.ts`. The FIRMS country endpoint is listed as unavailable, hence local borders. | Most fires are agricultural, wildfire or gas flares; a fire is not evidence of an attack. The CSV is parsed by column name, and an unexpected layout fails loudly. |
| Cloudflare Radar Outage Center | `GET /client/v4/radar/annotations/outages?dateRange=7d` | `CLOUDFLARE_RADAR_TOKEN`: free account, API token with **User Details: Read** | Every annotated outage, with Cloudflare's cause and type; a shutdown counts as unrest, military action as military | Analyst-reviewed, so it lags IODA. CC BY-NC 4.0. Rate limits are not documented. Network-scoped outages carry their country in `asnsDetails[].location`, not `locations` (8 of the first 15 live records). Links to Cloudflare's internal tracker (`*.cfdata.org`) are replaced by the public Outage Center page. **Revisable:** Cloudflare edits annotations later, so changed records are rewritten in place (original `collectedAt` kept; `metadata.revisedAt` added). Replay therefore shows the latest revision. |

**ACLED: rejected (2026-11-20).** Personal email addresses get the Open tier, which has no API. The Research tier needs an institutional address and gets lagged event data. The EULA (1 Nov 2026) says making data available through your own dashboard is not a sufficient use, and restricts direct access to event-level data.

## v0.13.0 United States (domestic) watch — implemented ✅

The **United States (domestic)** region covers events *inside* the US, with emphasis on the military and homeland security. US actions abroad are tagged to where they happen.

**What counts as inside the US** ([`shared/domain/geo/domestic.ts`](../shared/domain/geo/domestic.ts), [`usPlaces.ts`](../shared/domain/geo/usPlaces.ts)):
- **Exact points** (USGS, GDACS): inside US borders, including Alaska, Hawaii and territories. Not by box, so Canada and Mexico don't count.
- **Country-coded data** (IODA, Cloudflare, UK FCDO "USA" page, FEMA, NWS, FAA): country US.
- **Headlines**, by the source's mode:
  - *by place* (BBC): a US state, major city or military installation must be named.
  - *unless foreign* (DoD, Air Force, Marines, Military Times, Defense News): domestic unless the headline names a foreign country, a US base abroad (Kadena, Ramstein, Al Udeid …) or an abroad word (continent, "overseas", "worldwide", "allies" …).
  - *always* (NPR National): domestic by definition.
- **A bare "US" is never enough.** "US strikes island near Kuwait" is not domestic.
- **Ambiguous names left out:** Austin, Charlotte, Vance, Maxwell, Tinker, Fallon; bare Norfolk and Richmond.

| Source | Kind | What WATCHTOWER keeps |
|---|---|---|
| FAA TFR | official | SECURITY (national-defence airspace, often over bases), VIP (presidential/VIP movement) and SPECIAL restrictions; state-level |
| DHS NTAS | official | Any terrorism bulletin or alert. The feed is usually empty, so any entry is significant. Its format is read defensively, since no live advisory existed to check against |
| FEMA OpenFEMA | official | One record per declaration (major disaster, emergency, fire management), with the number of areas |
| NWS alerts | official | Active alerts with severity **Extreme** only |
| Air Force, Marine Corps news | official | Service news |
| Military Times, Defense News | media | Military and defence press |
| NPR National | media | US national desk; relevant topics only |
| BBC US & Canada | media | Added as a fifth BBC feed |

**Not available (2026-11-21):** army.mil RSS (403); Navy and National Guard RSS (empty); Stars and Stripes (404); NORAD and NORTHCOM (feed site ids unknown, and their sites refuse scripted page loads). FIRMS fire detections are not collected for the US: agricultural burning and wildfire would swamp a military-focused watch.

## v0.16.0 Military aircraft (ADS-B) — implemented ✅

| Source | Kind | What WATCHTOWER keeps |
|---|---|---|
| adsb.lol `/v2/mil` (fallback adsb.fi `/v2/mil`) | aggregator | Every run: positions of aircraft the network flags as military (airborne, position under 2 minutes old) for the map. Records: tankers, surveillance/command, bombers and airlift inside watch areas, once per aircraft, area and day. Since v0.63.0 also *unusual movement* records: holds (1 h+ within 60 km at 10,000 ft+) where that kind has not held in 30 days, and types new to a watch area in 30 days; from a 4-hour position history and 60-day memory in the source state, flagging only after 14 days of memory |

- **Terms:** adsb.lol data is ODbL 1.0 (credit adsb.lol); 500 requests a day without a key, and WATCHTOWER uses 48. adsb.fi is personal, non-commercial use and must be cited with a link; it is only a fallback.
- **Not used:** airplanes.live (asks API users to contact them first, HTTP 403 without).
- **Probe 2026-11-21 08:22 UTC:** adsb.lol 76 aircraft flagged military, 40 with a position; adsb.fi 89 and 44.

## v0.17.0 US Navy fleet (USNI News) — implemented ✅

| Source | Kind | What WATCHTOWER keeps |
|---|---|---|
| USNI News Fleet and Marine Tracker (`news.usni.org/feed`) | media | The latest weekly tracker, parsed into named areas and ships, for the map. Records when a carrier or big-deck amphibious ship (CVN, LHA, LHD) appears in a new area |

- **Feeds:** the fleet-tracker category feed is cached for weeks (its newest item was Oct. 26 on 2026-11-21), so WATCHTOWER reads the main feed, and the category feed only once for history. Article pages refuse scripted access (HTTP 403); the RSS carries the full text. Checked at most every 3 hours.
- **Terms:** copyright USNI News. WATCHTOWER keeps only facts (ship, hull number, area, date) and a link, never article text. robots.txt content signals: search=yes, ai-train=no, use=reference. WATCHTOWER runs no AI model on it.

## v0.18.0 Chokepoint traffic (IMF PortWatch) — implemented ✅

| Source | Kind | What WATCHTOWER keeps |
|---|---|---|
| IMF PortWatch daily chokepoint transits (public ArcGIS service) | scientific | 120 days of daily transits (all ships, tankers) for six chokepoints, the 2025 daily averages and PortWatch's chokepoint points. Records weekly while a chokepoint is disrupted |

- **Terms:** attribution "Source: International Monetary Fund, PortWatch" on every record and card. The IMF "prohibits bulk download of information by automated technology without explicit permission". **The owner chose (2026-11-21) to use it without asking**, with a minimal footprint: one small query a day, six chokepoints, private dashboard only. If the IMF objects or blocks access, the source goes DEGRADED and nothing else is affected.
- **Lag:** about 6 days (latest day 2026-11-15 on 2026-11-21).
- **aisstream.io: not for chokepoints.** A 60-second worldwide probe with a real key (2026-11-21) returned 4,200 messages, almost all from north-west Europe and North American coasts, and none from any of the five chokepoints, the Persian Gulf, the Red Sea or around Taiwan.
- **aisstream.io second probe (120 s):** North Sea + Channel 2,984 ships, Baltic 930, Gulf of Finland 68, Eastern Mediterranean 115, Norfolk 28 and San Diego 19 with no US Navy warships, a handful of European naval auxiliaries. Ship type was known for only 11–22% of ships within 2 minutes. Kept for item 4b (sanctioned vessels in the Baltic and North Sea).

## v0.19.0 Sanctions lists — implemented ✅

| Source | Kind | What WATCHTOWER keeps |
|---|---|---|
| US OFAC SDN list (`SDN.XML`, 29.6 MB) | official | Ids of all 19,599 entries (to find new ones) and 1,570 vessels with IMO (840 with MMSI). Checked every run with ETag |
| EU consolidated financial sanctions list (XML, 26 MB) | official | Ids of 6,303 entries and 41 vessels (IMO). Once a day: the file took 75 s to generate in testing |
| UK Sanctions List (XML, 22 MB) | official | Ids of 6,448 designations and 693 ships (IMO). Every 6 hours with ETag |

- **Not used:** the old OFSI consolidated list URL (public access now refused); OFAC has no recent-actions RSS feed (404).
- **Terms:** OFAC is US public domain; EU data reusable with acknowledgement; UK under the Open Government Licence v3.0.
- **Indicators** require OFAC and UK to be healthy; EU records count when present, so a slow EU file never blanks them.

## v0.20.0 Sanctioned vessels on AIS — implemented ✅

| Source | Kind | What WATCHTOWER keeps |
|---|---|---|
| aisstream.io (`AISSTREAM_API_KEY` secret) | aggregator | A 25-second window each run over the Baltic and North Sea. Only ships matching the OFAC/EU/UK vessel lists are kept: latest position per vessel (48 h) and an MMSI→IMO link for ships matched by IMO |

- The window opens when the run starts and is awaited by the last adapter, so it overlaps the other sources.
- The watchlist is read from the sanctions sources' saved state (about 2,000 vessels with IMO or MMSI).

## v0.21.0 UN Security Council — implemented ✅

| Source | Kind | What WATCHTOWER keeps |
|---|---|---|
| UN Digital Library (MARC XML search) | official | The latest 30 Security Council meeting records (symbol, date, agenda, closed flag, subject countries) and 20 voting records (tally, members voting no or abstaining) |
| UN Meetings Coverage and Press Releases (RSS) | official | Only items reporting a failed draft or a veto |

- **Not available:** the Security Council website (main.un.org/securitycouncil, un.org/securitycouncil) answers HTTP 202 with an empty body, and press.un.org's Council pages a "Client Challenge" page, to scripted requests.
- **Vetoes:** vetoed drafts are catalogued without votes, so they are read from press-release titles.

## v0.22.0 North Korean launches — implemented ✅

| Source | Kind | What WATCHTOWER keeps |
|---|---|---|
| Yonhap News Agency, English all-news RSS | media | Headlines reporting a North Korean launch or nuclear test, grouped per Korea day; forecasts and warnings excluded |

- **Checked and not used (2026-11-21):** Japan Ministry of Defense notices (Cloudflare challenges scripted clients; the collector does not try to get around bot protection), CNS North Korea missile database at NTI and CTBTO (Cloudflare challenge), South Korea JCS (no feed).

## v0.23.0 US embassy drawdowns — implemented ✅ (no new source)

- Read from the State Department travel advisories already collected: ordered / authorized departure and suspended embassy operations, recorded when they change.
- **Not available:** US embassy websites and their security-alert RSS feeds (*.usembassy.gov) answer every scripted request with CloudFront 403, curl included.

## v0.24.0 DoD contract awards — implemented ✅

| Source | Kind | What WATCHTOWER keeps |
|---|---|---|
| war.gov Contracts RSS + daily pages | official | Notable awards only: $1B+, munitions $100M+, FMS to watch-region partners; amounts labelled as ceilings where they are |

## v0.25.0 Federal Register — implemented ✅

| Source | Kind | What WATCHTOWER keeps |
|---|---|---|
| Federal Register API (`/api/v1/documents.json`) | official | Security-related presidential documents, new/terminated national emergencies, BIS export-control rules, State terrorist designations and revocations |

## v0.26.0 Congress — implemented ✅ (needs the free key)

| Source | Kind | What WATCHTOWER keeps |
|---|---|---|
| Congress.gov API v3 (`CONGRESS_API_KEY`) | official | Recently updated joint resolutions and bills filtered by title (war powers, AUMF, arms-sale and nuclear-cooperation disapprovals, NDAA); hearings of security committees (up to 12 new meeting details per run) |

- The API has no keyword search; the key goes in the `X-Api-Key` header, never the URL.

## v0.28.0 Military space launches — implemented ✅

| Source | Kind | What WATCHTOWER keeps |
|---|---|---|
| Launch Library 2 `/launches/previous/` | aggregator | Completed military/classified launches: name, vehicle, mission type, orbit, pad, outcome |

## v0.29.0 WHO Disease Outbreak News — implemented ✅

| Source | Kind | What WATCHTOWER keeps |
|---|---|---|
| WHO DON API (`/api/news/diseaseoutbreaknews`, selected fields) | official | Title, summary, DON id, date; countries from the title; high-consequence pathogen flag |

## v0.30.0 Economic stress — implemented ✅

| Source | Kind | What WATCHTOWER keeps |
|---|---|---|
| fawazahmed0/exchange-api (CC0; jsDelivr, pages.dev fallback) | aggregator | Daily rate per watch currency vs USD; 7- and 30-day change; a record only past the threshold |
| EIA API v2 petroleum spot prices (api.data.gov key in header) | official | Brent and WTI daily prices; a record only on a 10% / 20% move |

## v0.31.0 UNHCR displacement — implemented ✅

| Source | Kind | What WATCHTOWER keeps |
|---|---|---|
| UNHCR population API (`/population/v1/population/`, `coo_all` / `coa_all` totals) | official | Per watch country: refugees and asylum seekers abroad and hosted, IDPs, returns; latest and previous year. Snapshot only, no records |

## v0.36.0 Military aircraft — command and VIP roles

| Source | Change |
|---|---|
| adsb-military | Also records US airborne command posts (E-6B; E-4B by serial) and government VIP transports (special-air-mission callsigns SAM, SPAR, VENUS, EXEC, AF1/AF2), with `metadata.aircraftRole`. Seen live on 2026-11-21: three C-37 Gulfstreams as SAM928, SAM208 and SPAR81. |

## v0.37.0 Prediction markets — implemented ✅

| Source | Kind | What WATCHTOWER keeps |
|---|---|---|
| Polymarket Gamma API (`/events?tag_slug=geopolitics`) | aggregator (betting odds) | Up to 40 watch-region questions: Yes price, 24 h and 7 d change, volume, end date, 14-day 6-hourly history; a record on a 15-point move in 24 h |
| Kalshi | rejected | Developer agreement forbids storing API data except for your own trading |
| Metaculus | deferred | API requires an account token |

## v0.38.0 Critical infrastructure (static datasets)

| Dataset | Licence | What WATCHTOWER keeps |
|---|---|---|
| WRI Global Power Plant Database v1.3.0 | CC BY 4.0 (credit: World Resources Institute), data to 2021 | Plants of 500 MW+ and all nuclear plants in watch-region countries: name, fuel, capacity, coordinates |
| Wikidata (SPARQL, one query per class) | CC0 | Nuclear plants and oil refineries; dams and ports with an English Wikipedia article: name, coordinates, article |

Rebuild with `node scripts/build-infrastructure.ts`. On 2026-11-21 the endpoint timed out (504) on queries that joined country codes or filtered dissolved items server-side; those steps now run in the script.

## P2 — next adapters

| Source | Endpoint | Info | Method | Auth | Probe | Notes |
|---|---|---|---|---|---|---|
| FAA TFR list | `https://tfr.faa.gov/tfrapi/exportTfrList` | U.S. temporary flight restrictions | JSON | None | ✅ 200 | Undocumented endpoint behind the public TFR viewer; U.S.-only. |
| GDELT DOC 2.0 | see P1 table | News coverage volume | API | None | ⚠️ 429 again at 21:45 | Retry from a GitHub Actions runner. |

## Research — not integrable as specified

| Source | Finding | Proposed path |
|---|---|---|
| **CENTCOM public releases** | Standard ArticleCS RSS endpoint returns HTTP 200 with an **empty channel** | Find the correct category/ContentType id; else check robots.txt and consider low-frequency parsing of the releases page. |
| **FAA NOTAMs** | Public NOTAM search returns **HTTP 403** to scripted clients | Do **not** scrape it. Apply for the FAA NOTAM API (free, registration + approval); credentials go in Actions secrets only. |
| **UKMTO** | Next.js site; no RSS or API discovered (`/api/incidents` → 404) | Review terms + robots.txt; if permitted, parse the incident list at ≤1 request/hour. Highest-value maritime source for REDSEA. |
| **NGA MSI broadcast warnings** | **HTTP 503** at both probes (08:00, 21:45) | Retest; documented public API for NAVAREA / HYDROPAC warnings. |
| **NATO news** | Legacy RSS path and `/cps/rss/…` → **404** | Locate the current feed after the site redesign. |
| **EEAS press** | Page reachable; no feed found yet | Look for an RSS link; EU reuse policy is permissive with attribution. |
| **MARAD maritime advisories** | `maritime.dot.gov/rss.xml` → **403** | Find the advisory-specific feed; high value for REDSEA. |
| **ReliefWeb API** | **406 "Blocked due to bot activity"** | Register an approved `appname` with OCHA (free). |
| **Pentagon Pizza Index** | No legal, free, historical aggregate dataset. Map-service "popular times" are popularity estimates (not order counts), have no free API, and scraping them violates provider terms. | Preserved as an inactive concept: `DATA SOURCE UNAVAILABLE`. |

## Adapter conventions (Phase 2)

- One adapter per source in `collector/adapters/`, implementing a common `SourceAdapter` interface (fetch → parse → normalize → validate).
- Polite fetching: descriptive User-Agent, conditional GET, per-source minimum interval, exponential backoff on 429/5xx.
- Never bypass authentication, CAPTCHAs, paywalls or robots.txt.
- All fetched content is untrusted: strip HTML, cap field lengths, accept only http(s) URLs.

## v0.47.0 Power outages — implemented ✅

| Source | Kind | What WATCHTOWER keeps |
|---|---|---|
| ODIN — Outage Data Initiative Nationwide (DOE / ORNL), `odin.ornl.gov/odi/map?scale=COUNTY` and `/odi/status` | official, public API, no key | Customers without power per county and state from reporting utilities (about 150–160), largest utilities, simplified county outlines for counties with 50+ out (up to 60); a record when a state reaches 25k / 100k / 250k / 500k / 1M out |
| EIA-930 hourly grid data | possible later | Demand by balancing authority; a sudden drop can mark a major grid event, but it is indirect |
| ENTSO-E Transparency Platform | not used | Needs a registered token; reuse of the data depends on agreements with each data owner |
| PowerOutage.us | rejected | Paid API; the website terms forbid copying or storing its data |

## v0.48.0 FAA — implemented ✅

| Source | Kind | What WATCHTOWER keeps |
|---|---|---|
| FAA TFR map service (`tfr.faa.gov/geoserver/TFR/ows`, WFS) and detail text (`tfr.faa.gov/tfrapi/getWebText`) | official, public, no key | Outlines (simplified, ≤30 kB) and start/end, reason, altitude for VIP, security and special TFRs; details fetched once per TFR |
| FAA NAS Status (`nasstatus.faa.gov/api/airport-events`) | official, public, no key | Ground stops, ground delay programs, delays and closures with cause and FAA airport position; records for causes other than weather, volume or runway work |
| FAA Prohibitions, Restrictions and Notices (`faa.gov/air_traffic/publications/us_restrictions/`) | official web page | Notice documents per country or sea area (title, link, kind, first seen); a record when a new document appears |
| FAA NOTAM API (`api.faa.gov`, NOTAM Management Service) | needs credentials | Not used yet: free registration with client credentials; status after the April 2026 NMS move unconfirmed |

## v0.49.0 Radiation — implemented ✅

| Source | Kind | What WATCHTOWER keeps |
|---|---|---|
| BfS ODL (`imis.bfs.de/ogc/opendata/ows`, `odlinfo_odl_1h_latest`) | official open data, dl-de/by-2-0 | Latest hourly dose rate per station; each station's usual level (packed); stations above usual |
| STUK external radiation via FMI (`opendata.fmi.fi/wfs`, `stuk::observations::external-radiation::latest::simple`) | official open data, CC BY 4.0 | Latest 10-minute dose rate per station (by position); usual levels; stations above usual |
| EPA RadNet CSV (`radnet.epa.gov/cdx-radnet-rest/api/rest/csv/{year}/fixed/{state}/{city}`) | official, US government | 16 monitors, two per run (whole-year files, ~800 kB each); latest reading and usual level per monitor |
| SaveEcoBot radiation API (Ukraine) | needs a key | Not used yet: CC BY 4.0, key via request form |
| EURDEP (EU) | not used | 6,000+ stations incl. Ukraine, Belarus, Russia, but no public live API (only the map); the JRC open-data folder holds past events only |
| Safecast | not used | CC0 but sparse in the watch regions, with bad timestamps in Ukraine data |

## v0.50.0 Space weather — implemented ✅

| Source | Kind | What WATCHTOWER keeps |
|---|---|---|
| NASA DONKI (`api.nasa.gov/DONKI`: CMEAnalysis, WSAEnlilSimulations, GST) | US government, api.data.gov key | Latest model run per CME with predicted Earth arrival, model Kp and speed; CME count and fastest in 7 days; observed geomagnetic storms (14 days) |
| NOAA SWPC (`services.swpc.noaa.gov/products`: noaa-scales, alerts, noaa-planetary-k-index) | US government, no key | R/S/G scales now and for 3 days, latest and 24-hour max Kp, notable messages (72 h) |

## v0.51.0 Cyber — implemented ✅

| Source | Kind | What WATCHTOWER keeps |
|---|---|---|
| UK NCSC news and report RSS | official, Open Government Licence | Headlines and links (cyber, Global cybersecurity) |
| Canadian Centre for Cyber Security alerts and advisories RSS | official | Alerts (ALyy-nnn) only; routine vendor-patch advisories (AVyy-nnn) left out |
| JPCERT/CC English RSS 1.0 (RDF) | official | Headlines and links |
| CERT-UA articles API (`cert.gov.ua/api/articles`) | official, undocumented | Articles (Ukrainian title; English title fetched once per new article), Global cybersecurity + Eastern Europe |
| FIRST EPSS API | free, attribution to FIRST | Probability and percentile for the KEV entries of the last 30 days |
| ransomware.live | needs a key | Not used: the free keyless API is for personal use only; API PRO needs a free key |

## v0.53.0 Ukraine front — implemented ✅

| Source | Kind | What WATCHTOWER keeps |
|---|---|---|
| General Staff of the Armed Forces of Ukraine, via Ukrinform's English "War update" articles | official figures relayed by a state news agency | Per day: totals, attacks per sector, settlements named, quiet sectors (facts); link to the article |
| Ukrinform war RSS | media (Ukraine's state news agency) | Headlines and links |
| DeepStateMap.live | needs a key | Requested 2026-11-22; keyless internal endpoints are not used (licence s.2) |
| ISW control-of-terrain geodata | needs written consent | "You may not use this geodata without the written consent of ISW" |
| General Staff site, Russian MoD, TASS | refused | HTTP 403 / no response to automated requests; not worked around |

## v0.55.0 Air attacks — implemented ✅

| Source | Kind | What WATCHTOWER keeps |
|---|---|---|
| Ukrainian Air Force overnight reports, via Ukrinform's English "Air defense …" articles | official figures relayed by a state news agency | Per night: drones, missiles (ballistic), shot down or suppressed, hit and debris locations (facts); link |

## v0.56.0 Censorship — implemented ✅

| Source | Kind | What WATCHTOWER keeps |
|---|---|---|
| OONI aggregation API (`api.ooni.io/api/v1/aggregation`) | scientific, CC BY-NC-SA 4.0 | Per country and service: failed-test share in 2 days and the 14 days before, test count, verdict; a record for new blocks |
| UKMTO incidents (`sccd.royalnavy.mod.uk/api/ukmto/all`) | official, Open Government Licence | Not used: the host refuses Node requests (bot protection); parked pending permission |

## Phase 25 — Navigational warnings, aircraft emergencies, conflict events (v0.59.0)

| Source | Kind | What WATCHTOWER keeps |
|---|---|---|
| NGA MSI broadcast warnings (`msi.nga.mil/api/publications/broadcast-warn`) | official, U.S. public domain | Active warnings of notable kinds (missile/rocket firings, live firing, exercises, GPS interference, piracy, mines, cable work): key, kind, text (600 characters), positions parsed from the text; a record when first seen. Read every 3 hours. Under maintenance (HTTP 503) at release |
| adsb.lol squawk queries (`api.adsb.lol/v2/sqk/7500`, `7600`, `7700`) | aggregator, ODbL | Aircraft broadcasting an emergency code: position, code, type, military flag; a record per aircraft and code per 12 hours (civil emergencies outside the watch regions abroad are routine) |
| UCDP GED candidate files (`ucdp.uu.se/downloads/candidateged/GEDEvent_vYY_0_M.csv`) | scientific, CC BY 4.0 | Latest monthly release: watch-region events located to a province or better (date, position, type, sides, best death estimate) for the map, and per-region totals; one record per region per release. Source headlines are not stored. The UCDP API needs a token and is not used |


## Phase 28 — Radio listening links (v0.64.0)

WATCHTOWER only links to radio. It never plays, records, transcribes or re-streams audio, and never connects to a receiver itself.

| Source | Kind | How it is used |
|---|---|---|
| KiwiSDR public receiver list, via the rx.linkfanel.net mirror (`kiwisdr_com.js`) | aggregator, no stated terms | Fetched once a day: name, address, position, tuning range and slots of about 850 online receivers, for "tune nearby" links. Makes no records. The official kiwisdr.com/public page sits behind a click-through, which is not bypassed |
| LiveATC.net airport pages (`/search/?icao=XXXX`) | link only | Aviation records within 200 km of an airport with scheduled service link to its page; LiveATC says there whether it is covered. Its terms forbid third-party use of the streams, so nothing is embedded; its site blocks automated checks, so the URL was checked by hand (2026-11-22) |
| Broadcastify state pages (`/listen/stid/{FIPS}`) | link only | Located US records link to the state's page. Their terms forbid automated feed lists, scraping and AI use, so it is a fixed state table |
| University of Twente WebSDR (`websdr.ewi.utwente.nl:8901/?tune=`) | link only | Fallback receiver when the list is unavailable |
| OurAirports (`airports.csv`) | public domain | 3,258 large and medium airports with scheduled service (ICAO, position, region, name), built into the app and loaded only when a located record is opened |
| Frequencies: priyom.org (CC BY-NC-SA 4.0, credited), RadioReference wiki, HFUnderground wiki (MWARA, from v0.66.1), ab9il.net, 47 CFR 80.369, US Coast Guard NAVCEN | reference | Hand-curated list; each entry links its sources. Unconfirmed frequencies (e.g. Russian Navy, NATO) are left out |


## Phase 29 — Conflict-region radio (v0.65.0)

Links only, as in Phase 28. Both sources make no records; they are stored in the `snapshots/radio` document, rewritten only when one changes.

| Source | Kind | How it is used |
|---|---|---|
| EiBi shortwave schedules (`eibispace.de/dx/sked-<season>.csv`, `README.TXT`) | aggregator; free to download, use, copy and distribute (README "Conditions of use") | Fetched once a day; the current season's file, or the previous one while a new season's is not out. Kept: transmissions aimed at or based in a watch region (about 2,000 merged rows in B26), including utility stations (military channel markers, numbers stations, VOLMET). Alternates, harmonics and inactive rows are dropped. A schedule, not a log |
| Radio Browser (`<server>.api.radio-browser.info/json/stations/search`) | community directory; free open API | One search per watch-region country once a day, from a server the directory itself lists; up to 8 working stations each, news and talk first, then the most played. Only each station's own page and stream are linked |

### v0.69.0 — GPS interference

| Source | Kind | What WATCHTOWER keeps |
|---|---|---|
| adsb.lol circle queries (`api.adsb.lol/v2/point/{lat}/{lon}/250`; adsb.fi `opendata.adsb.fi/api/v2/lat/{lat}/lon/{lon}/dist/250` per circle when adsb.lol fails) | aggregator, ODbL (adsb.fi: personal, non-commercial) | Ten circles once an hour. No aircraft list is stored: only counts per 1° square and hour for 48 hours (sightings, degraded NACp below 8, GPS lost), and for 24 hours the last good position, time and callsign of aircraft flagged as having lost GPS. About 240 requests a day against adsb.lol's 500 a day per address |

### v0.70.0 — Routing and DDoS (Cloudflare Radar, same token)

| Source | Kind | What WATCHTOWER keeps |
|---|---|---|
| Cloudflare Radar route hijacks (`/radar/bgp/hijacks/events`, minConfidence 8) and leaks (`/radar/bgp/leaks/events`) | scientific, CC BY-NC 4.0 | Read hourly, last 2 days, up to 5 pages of 100. Events involving networks registered in watch-region countries (not the US), 7 days: networks (AS number, name, country), prefixes (up to 10), times, confidence. A record per event; leaks under 100 blocks are routine |
| Cloudflare Radar layer-3 attacks (`/radar/attacks/layer3/timeseries`, `location`, `direction=TARGET`, `aggInterval=1d`) | scientific, CC BY-NC 4.0 | Once a day, one request per watch-region country: 28 complete days as Cloudflare scales them, the last scored against the earlier median. A record for a surge (3× the median and 3+ typical spreads) |

### v0.71.0 — Map layers (static files, rebuilt by script)

| Dataset | Licence | What WATCHTOWER keeps |
|---|---|---|
| OpenStreetMap via Overpass (`scripts/build-undersea.ts`) | ODbL 1.0, © OpenStreetMap contributors | Undersea (`location=underwater` or `submarine`) telecom cables, power cables of 100 kV or more and oil and gas pipelines in eight watch-region sea areas: 197 lines (36 telecom, 95 power, 66 pipelines), names, operators, voltage, substance, simplified routes. Approximate; thin outside Europe |
| Natural Earth 1:10m breakaway and disputed areas (`scripts/build-disputed.ts`) | Public domain | 99 areas worldwide with name, type and the administered-by / claimed-by note. Lags events (Donetsk and Luhansk lines predate 2022; Artsakh dissolved 2024) |
| Wikidata: nuclear facility, research reactor, embassy, consulate and direct subclasses (`scripts/build-infrastructure.ts --new-types-only`) | CC0 | 20 other nuclear facilities and 112 embassies and consulates with coordinates in watch-region countries, added to `infrastructure.json` |
| TeleGeography Submarine Cable Map | rejected | Only its map images are CC BY-SA 4.0; the raw cable and landing-point data and its JSON API are sold under a paid annual licence |

### v0.75.0 — Tanker and cargo traffic, shipping lanes

| Source | Kind | What WATCHTOWER keeps |
|---|---|---|
| aisstream.io (same listen as the sanctioned-ship check) | aggregator | Tankers and cargo ships in the Baltic, North Sea, Black Sea and eastern Mediterranean: remembered identities (type, name, IMO, destination; 4,000 most recent, 7 days), a position per run for 24 hours, up to 800 ships in `snapshots/ships` |
| Global Shipping Lanes v1, Benden 2022 (github.com/newzealandpaul/Shipping-Lanes) | CC BY 4.0 / CC BY-SA 4.0 (the source states both; BY-SA followed) | Major, middle and minor lanes as simplified lines in `public/data/lanes.json` (`scripts/build-lanes.ts`) |
| World Bank Global Shipping Traffic Density | not used yet | CC BY 4.0, but 20–510 MB rasters (2015–2021), no tile service |

### v0.76.0 — Fintraffic Digitraffic AIS

| Source | Kind | What WATCHTOWER keeps |
|---|---|---|
| Fintraffic Digitraffic marine AIS (`meri.digitraffic.fi/api/ais/v1/locations` and `/vessels`, header `Digitraffic-User`) | official, CC BY 4.0 ("Source: Fintraffic / digitraffic.fi, license CC 4.0 BY") | Positions heard in the last hour and the matching vessel records, converted to AIS messages for the sanctioned-ship check, cable watch and tanker and cargo layer. First live read: 572 recent positions, 75 tankers and 158 cargo ships (Gulf of Finland and northern Baltic) |

### v0.82.0 — PLA activity around Taiwan

| Source | Kind | What WATCHTOWER keeps |
|---|---|---|
| Skyfaring's PLA Tracker (`pla-tracker.skyfaring.net/data/records.csv`), transcribing Taiwan MND daily releases | aggregator (secondary), CC BY 4.0 ("Source: ROC Ministry of National Defense; compilation & charts: Skyfaring's PLA Tracker") | One record per day (aircraft, median-line crossings, ships, balloons) and the last 90 days for the Taiwan Strait panel. Read at most every 2 hours with conditional requests. First check: 1,470 days, 2022-11-16 to 2026-11-24 |
| Taiwan MND (`mnd.gov.tw`) | not read | Reports are licensed OGDL-Taiwan-1.0, but robots.txt disallows all automated readers except Googlebot |
| data.gov.tw dataset 138118 | not used | One-line CSV pointing back to the MND website; no counts |
| Japan Joint Staff (`mod.go.jp/js/`) | not read | Refuses automated requests (HTTP 403) |
| PLATracker (Google Sheet, Brown, Lewis and Kung) | not used | No licence; asks users to email before use |

### v0.83.0 — Travel advice from more governments

| Source | Kind | What WATCHTOWER keeps |
|---|---|---|
| Global Affairs Canada travel advice (`data.international.gc.ca/travel-voyage/index-updated.json`) | official, Open Government Licence – Canada | Level per country (0–3, also stored as 1–4); a record when it is raised, lowered or a country appears. First read: 230 entries, 15 recent at "avoid non-essential" or "avoid all travel" |
| US CDC travel health notices (`wwwnc.cdc.gov/travel/rss/notices.xml`) | official, public domain | One record per notice (Level 1–4, disease, places, countries). Read at most every 3 hours (the CDC asks crawlers to wait 20 s) |
| Australia Smartraveller (`smartraveller.gov.au`) | not read | The site (Akamai) times out non-browser requests; no open data feed on data.gov.au |

### v0.84.0 — Satellites

| Source | Kind | What WATCHTOWER keeps |
|---|---|---|
| CelesTrak GP elements (`celestrak.org/NORAD/elements/gp.php?GROUP=military|resource&FORMAT=csv`) | aggregator; CelesTrak usage policy (CSV, at most once per 2-hour update, no repeated failing requests) | Orbital elements for about 45 military and 167 Earth imaging satellites, in the private layers document; no records. Read at most every 12 hours; after a failure the collector waits 12 hours |

