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
| adsb.lol `/v2/mil` (fallback adsb.fi `/v2/mil`) | aggregator | Every run: positions of aircraft the network flags as military (airborne, position under 2 minutes old) for the map. Records: tankers, surveillance/command, bombers and airlift inside watch areas, once per aircraft, area and day |

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
