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
| IODA outages | `https://api.ioda.inetintel.cc.gatech.edu/v2/outages/events` | scientific · official | Country (from IODA's entity code) | Country-level outages lasting **≥ 4 h**; re-reads a 3-day window each run | A connectivity drop is not proof of a shutdown: power cuts, cable faults and artefacts look the same. ~300 country events/week, median ~1 h, hence the threshold. |
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
| NASA FIRMS (VIIRS NOAA-20 NRT) | `/api/area/csv/[MAP_KEY]/VIIRS_NOAA20_NRT/[bbox]/[days]`, one request per geographic watch area | `FIRMS_MAP_KEY`: free, by email at <https://firms.modaps.eosdis.nasa.gov/api/map_key/> | **New** fire clusters only: ≥ 3 nominal/high-confidence detections in a 0.25° cell after 7 days with none. Point = strongest real detection | Most fires are agricultural, wildfire or gas flares; a fire is not evidence of an attack. The CSV is parsed by column name, and an unexpected layout fails loudly. |
| Cloudflare Radar Outage Center | `GET /client/v4/radar/annotations/outages?dateRange=7d` | `CLOUDFLARE_RADAR_TOKEN`: free account, API token with **User Details: Read** | Every annotated outage, with Cloudflare's cause and type; a shutdown counts as unrest, military action as military | Analyst-reviewed, so it lags IODA. CC BY-NC 4.0. Rate limits are not documented. |

**ACLED: rejected (2026-11-20).** Personal email addresses get the Open tier, which has no API. The Research tier needs an institutional address and gets lagged event data. The EULA (1 Nov 2026) says making data available through your own dashboard is not a sufficient use, and restricts direct access to event-level data.

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
