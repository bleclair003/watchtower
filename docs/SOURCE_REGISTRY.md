# Source Registry & Feasibility Matrix

Machine-readable version: [`shared/domain/sources.ts`](../shared/domain/sources.ts) — keep both in sync.

**Probe method (2026-11-20):** single `curl` GET per endpoint from a residential connection, following redirects, with a descriptive User-Agent. "Reachable" confirms the endpoint returned parseable content on that date, nothing more. **No collector exists for any source yet**, so every source's live status is `NOT CONFIGURED`.

## P1 — first adapters (Phase 2)

| Source | Official URL / endpoint | Information | Method | Auth | Free | Update freq. | Probe | Reliability concerns |
|---|---|---|---|---|---|---|---|---|
| U.S. State Dept Travel Advisories | `https://travel.state.gov/_res/rss/TAsTWs.xml` | Per-country advisory level 1–4 | RSS | None | Yes | Several / week | ✅ 200, 218 items | Items carry `Country-Tag` (ISO) and `Threat-Level` categories, which is excellent for region mapping. ~550 KB, so use conditional GET. Many items are periodic reissues with no level change; detect real changes by diffing level. |
| CISA Cybersecurity Advisories | `https://www.cisa.gov/cybersecurity-advisories/all.xml` | ICS advisories, alerts, joint advisories | RSS | None | Yes | Daily+ | ✅ 200 | High volume of routine ICS advisories; classify before surfacing. |
| CISA KEV Catalog | `https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json` | Vulnerabilities exploited in the wild | JSON | None | Yes | Several / week | ✅ 200 | 1.9 MB; diff on `catalogVersion` / `dateAdded`. |
| GDELT DOC 2.0 | `https://api.gdeltproject.org/api/v2/doc/doc` | Global news coverage search, volume timelines | API | None | Yes (1 req / 5 s) | 15 min | ⚠️ **429 rate-limited** on 2 probes | Media coverage, **not** confirmed events. Strict serialization, ≥6 s spacing, few queries per run. Re-test from Actions runners (shared IPs may be throttled harder). |

**PDD substitution:** the PDD suggested State Dept + GDELT as the first two adapters. Recommendation: **State Dept + CISA (advisories + KEV)** first. Both are reliable and structured, and they cover the Diplomatic and Cyber watches. Add GDELT third, once rate-limit behaviour from Actions is confirmed, as a *context* source rather than an evidence source.

## P2 — next adapters

| Source | Endpoint | Info | Method | Auth | Probe | Notes |
|---|---|---|---|---|---|---|
| U.S. Dept of War news | `https://www.war.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=945&max=10` | Defense releases | RSS | None | ✅ 200 | No structured geography; needs gazetteer matching. `defense.gov` serves identical feed. |
| FAA TFR list | `https://tfr.faa.gov/tfrapi/exportTfrList` | U.S. temporary flight restrictions | JSON | None | ✅ 200 | Undocumented endpoint behind the public TFR viewer; U.S.-only. |
| UK MoD | `https://www.gov.uk/government/organisations/ministry-of-defence.atom` | UK defence news | Atom | None | ✅ 200 | OGL v3.0. |
| IAEA Top News | `https://www.iaea.org/feeds/topnews` | Nuclear safety / safeguards | RSS | None | ✅ 200 | Low volume, high relevance. |
| UN News | `https://news.un.org/feed/subscribe/en/news/all/rss.xml` | UN news | RSS | None | ✅ 200 | UN editorial reporting, not resolutions. |
| USGS earthquakes M4.5+ | `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson` | Seismic events, exact coordinates | GeoJSON | None | ✅ 200 | First real test of point-precision mapping. |
| GDACS | `https://www.gdacs.org/xml/rss.xml` | Multi-hazard alerts with coordinates | RSS | None | ✅ 200 | Alert levels green/orange/red. |

## Research — not integrable as specified

| Source | Finding | Proposed path |
|---|---|---|
| **CENTCOM public releases** | Standard ArticleCS RSS endpoint returns HTTP 200 with an **empty channel** | Find the correct category/ContentType id; else check robots.txt and consider low-frequency parsing of the releases page. |
| **FAA NOTAMs** | Public NOTAM search returns **HTTP 403** to scripted clients | Do **not** scrape it. Apply for the FAA NOTAM API (free, registration + approval); credentials go in Actions secrets only. |
| **UKMTO** | Next.js site; no RSS or API discovered (`/api/incidents` → 404) | Review terms + robots.txt; if permitted, parse the incident list at ≤1 request/hour. Highest-value maritime source for REDSEA. |
| **NGA MSI broadcast warnings** | **HTTP 503** at probe time | Retest; documented public API for NAVAREA / HYDROPAC warnings. |
| **NATO news** | Legacy RSS path → **404** | Locate the current feed after the site redesign. |
| **EEAS press** | Page reachable; no feed found yet | Look for an RSS link; EU reuse policy is permissive with attribution. |
| **Pentagon Pizza Index** | No legal, free, historical aggregate dataset. Map-service "popular times" are popularity estimates (not order counts), have no free API, and scraping them violates provider terms. | Preserved as an inactive concept: `DATA SOURCE UNAVAILABLE`. |

## Adapter conventions (Phase 2)

- One adapter per source in `collector/adapters/`, implementing a common `SourceAdapter` interface (fetch → parse → normalize → validate).
- Polite fetching: descriptive User-Agent, conditional GET, per-source minimum interval, exponential backoff on 429/5xx.
- Never bypass authentication, CAPTCHAs, paywalls or robots.txt.
- All fetched content is untrusted: strip HTML, cap field lengths, accept only http(s) URLs.
