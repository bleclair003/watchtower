import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { WATCH_REGIONS } from '../../shared/domain/regions.ts';
import { HULL_LABEL, areaNameOf, isBigDeck, resolveFleetArea, type FleetArea, type FleetShip, type FleetSnapshot } from '../../shared/domain/fleet.ts';
import { parseFeed, type FeedItem } from '../lib/feed.ts';
import { parseFeedDate } from '../lib/dates.ts';
import { contentHash } from '../lib/hash.ts';
import { LIMITS, decodeEntities, cleanText, safeUrl, truncate } from '../lib/text.ts';
import type { AdapterContext, AdapterResult, SourceAdapter } from './types.ts';
import { FIRST_RUN_LOOKBACK_DAYS } from './types.ts';

export const FLEET_SOURCE_ID = 'usni-fleet-tracker';
/** The main feed carries the latest tracker; the category feed is cached for weeks, so it is only used for history on the first run. */
export const FLEET_FEED = 'https://news.usni.org/feed';
export const FLEET_CATEGORY_FEED = 'https://news.usni.org/category/fleet-tracker/feed';
const TITLE_RE = /^USNI News Fleet and Marine Tracker\b/i;
/** The tracker is weekly: check the feed at most every 3 hours. */
export const FLEET_CHECK_HOURS = 3;

export interface FleetState {
  latest: FleetSnapshot | null;
  /** hull → area name in the latest tracker processed (big decks only). */
  lastArea: Record<string, string>;
  lastCheckedAt: string;
  processedUrls: string[];
}

const SHIP_RE = /\bUSS\s+([A-Z][A-Za-z.'’\- ]{1,40}?)\s*\(([A-Z]{1,4})[-\s]?(\d{1,3})\)/g;
/** The block says where the ship is now (or is a roster line of a group in this area). */
const PRESENT_RE = /\bhomeported\b|\b(?:is|are)\b[^.]{0,120}\b(?:operating|underway|in port|pierside|moored|anchored|transiting|sailing|conducting|now|deployed)\b|\boperating in\b|\barrived\b/i;
/** The block is about another time or place. */
const ELSEWHERE_RE = /\b(?:reliev\w*|returned|departed|left|previously|decommission\w*|returning home|arrived home|homecoming)\b/i;

const blockText = (html: string) => cleanText(decodeEntities(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')));

/**
 * Parses one tracker's HTML into areas and ships. Text before the first "In …" heading
 * (the week's narrative) and photo captions are ignored: they mention ships in other places.
 */
export function parseFleetTracker(html: string): FleetArea[] {
  const body = html.replace(/<figure[\s\S]*?<\/figure>/gi, ' ').replace(/<figcaption[\s\S]*?<\/figcaption>/gi, ' ');
  const areas: FleetArea[] = [];
  const seen = new Set<string>();
  let current: FleetArea | null = null;
  for (const m of body.matchAll(/<(h[1-6]|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const text = blockText(m[2]);
    if (!text) continue;
    // Some trackers write area headings as short bold paragraphs instead of <h*> tags.
    const isHeading = m[1].toLowerCase().startsWith('h');
    const headingLike = isHeading || (/^In\s/.test(text) && text.length <= 50 && !/\b(?:is|are|was|were)\b/.test(text));
    if (headingLike) {
      const name = areaNameOf(text);
      if (name) {
        current = areas.find((a) => a.name.toLowerCase() === name.toLowerCase()) ?? null;
        if (!current) {
          current = { name, ...resolveFleetArea(name), ships: [] };
          areas.push(current);
        }
      }
      continue; // other headings ("Carrier Strike Group 9") stay in the current area
    }
    if (!current || !PRESENT_RE.test(text) || ELSEWHERE_RE.test(text)) continue;
    for (const s of text.matchAll(SHIP_RE)) {
      const hull = `${s[2]}-${s[3]}`;
      if (seen.has(hull)) continue;
      seen.add(hull);
      const ship: FleetShip = { name: `USS ${s[1].trim()}`, hull, hullType: s[2] };
      current.ships.push(ship);
    }
  }
  return areas.filter((a) => a.ships.length > 0);
}

/** "USNI News Fleet and Marine Tracker: Nov. 16, 2026" → 2026-11-16; falls back to the publication date. */
export function trackerDate(title: string, publishedIso: string): string {
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const m = /:\s*([A-Za-z]+)\.?,?\s+(\d{1,2}),?\s+(\d{4})/.exec(title);
  const mi = m ? MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) : -1;
  if (m && mi >= 0) return `${m[3]}-${String(mi + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return publishedIso.slice(0, 10);
}

export function snapshotFromItem(item: FeedItem): FleetSnapshot | null {
  const url = safeUrl(item.link);
  const publishedAt = parseFeedDate(item.published);
  if (!url || !publishedAt || !TITLE_RE.test(item.title) || !item.content) return null;
  const areas = parseFleetTracker(item.content);
  if (!areas.length) return null;
  return { asOf: trackerDate(item.title, publishedAt), title: cleanText(item.title), url, publishedAt, areas };
}

/**
 * Records for big-deck ships (carriers, amphibious assault ships) that appear in a new area
 * compared with the previous tracker processed. `previous` is hull → area name.
 */
export function fleetEvents(snap: FleetSnapshot, previous: Record<string, string> | null, nowIso: string): { events: IntelligenceEvent[]; lastArea: Record<string, string> } {
  const events: IntelligenceEvent[] = [];
  const lastArea: Record<string, string> = {};
  for (const area of snap.areas) {
    for (const ship of area.ships) {
      if (!isBigDeck(ship.hullType)) continue;
      lastArea[ship.hull] = area.name;
      const before = previous?.[ship.hull];
      if (previous && before === area.name) continue;
      const change = !previous ? 'listed' : before ? 'moved' : 'arrived';
      const where = area.country ? area.name : `the ${area.name}`;
      const kind = HULL_LABEL[ship.hullType] ?? ship.hullType;
      const regionNames = area.regionIds.map((r) => WATCH_REGIONS.find((w) => w.id === r)?.shortCode ?? r);
      const id = contentHash(FLEET_SOURCE_ID, ship.hull, area.name, snap.asOf);
      const others = area.ships.filter((s) => s.hull !== ship.hull).map((s) => `${s.name} (${s.hull})`);
      events.push({
        id,
        contentHash: id,
        dataOrigin: 'live',
        sourceId: FLEET_SOURCE_ID,
        sourceName: 'USNI News — Fleet and Marine Tracker',
        sourceClass: 'media',
        sourceUrl: snap.url,
        title: truncate(
          `${kind} ${ship.name} (${ship.hull}) ${change === 'listed' ? 'in' : 'now in'} ${where}${regionNames.length ? ` (${regionNames.join('/')})` : ''} — USNI News Fleet Tracker, ${snap.asOf}`,
          LIMITS.title,
        ),
        summary: truncate(
          `USNI News lists ${ship.name} (${ship.hull}) under "${area.name}" in its weekly Fleet and Marine Tracker, with positions as of ${snap.asOf}` +
            `${before && before !== area.name ? `; the previous tracker listed it under "${before}"` : ''}. ` +
            `${others.length ? `Also listed there: ${others.slice(0, 6).join(', ')}${others.length > 6 ? ` and ${others.length - 6} more` : ''}. ` : ''}` +
            'Positions are approximate and weekly; the Navy does not publish exact locations.',
          LIMITS.summary,
        ),
        category: 'maritime',
        regionIds: area.regionIds,
        countryCodes: area.country ? [area.country] : [],
        publishedAt: snap.publishedAt,
        occurredAt: null,
        collectedAt: nowIso,
        credibility: 'single-source',
        verificationStatus: 'unreviewed',
        locationPrecision: area.regionIds.length || area.country ? 'region' : 'none',
        metadata: {
          subtype: 'fleet-position',
          change,
          hull: ship.hull,
          hullType: ship.hullType,
          ship: ship.name,
          area: area.name,
          previousArea: before ?? null,
          asOf: snap.asOf,
          geoBasis: 'named area in the USNI News tracker (approximate)',
        },
      });
    }
  }
  return { events, lastArea };
}

/**
 * USNI News Fleet and Marine Tracker (weekly). Keeps the latest tracker for the map, and
 * records when a carrier or big-deck amphibious ship appears in a new area.
 */
export const usniFleetTracker: SourceAdapter<FleetState> = {
  sourceId: FLEET_SOURCE_ID,
  async collect(ctx: AdapterContext<FleetState>): Promise<AdapterResult<FleetState>> {
    const nowIso = new Date(ctx.now).toISOString();
    const prev = ctx.state;
    if (prev && ctx.now - Date.parse(prev.lastCheckedAt) < FLEET_CHECK_HOURS * 3_600_000) {
      return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: prev };
    }

    const items: FeedItem[] = [];
    const main = await ctx.fetch(FLEET_FEED);
    if (main.kind === 'ok') items.push(...parseFeed(main.body));
    if (!prev) {
      const cat = await ctx.fetch(FLEET_CATEGORY_FEED);
      if (cat.kind === 'ok') items.push(...parseFeed(cat.body));
    }

    const cutoff = ctx.now - FIRST_RUN_LOOKBACK_DAYS * 86_400_000;
    const byUrl = new Map<string, FleetSnapshot>();
    const rejected: { ref: string; reason: string }[] = [];
    for (const it of items.filter((i) => TITLE_RE.test(i.title))) {
      const snap = snapshotFromItem(it);
      if (!snap) {
        rejected.push({ ref: truncate(it.title, 80), reason: 'tracker without parsable areas' });
        continue;
      }
      if (Date.parse(snap.publishedAt) >= cutoff) byUrl.set(snap.url, snap);
    }
    const processed = new Set(prev?.processedUrls ?? []);
    const fresh = [...byUrl.values()].filter((s) => !processed.has(s.url)).sort((a, b) => a.asOf.localeCompare(b.asOf));

    const events: IntelligenceEvent[] = [];
    let lastArea = prev?.lastArea ?? null;
    let latest = prev?.latest ?? null;
    for (const snap of fresh) {
      if (latest && snap.asOf < latest.asOf) continue;
      const r = fleetEvents(snap, lastArea, nowIso);
      events.push(...r.events);
      lastArea = r.lastArea;
      latest = snap;
      processed.add(snap.url);
    }
    return {
      events,
      rejected,
      itemsSeen: items.length,
      notModified: false,
      state: { latest, lastArea: lastArea ?? {}, lastCheckedAt: nowIso, processedUrls: [...processed].slice(-60) },
    };
  },
};
