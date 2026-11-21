import { matchGazetteer } from './geo/gazetteer.ts';
import { regionsForCountry } from './regions.ts';

/**
 * Phase 15 item 1: prediction-market odds on geopolitical questions (Polymarket, read through its
 * public, documented Gamma API — never the website, whose terms forbid scraping). Odds are what
 * traders bet, not WATCHTOWER's view, and thin markets move on small bets, so only markets with
 * real trading are kept.
 */

export const MARKETS_SOURCE_ID = 'polymarket';
/** Minimum lifetime volume (USD) for an event to be tracked, and for a market to be its representative. */
export const MIN_EVENT_VOLUME = 100_000;
export const MIN_MARKET_VOLUME = 25_000;
/** A record is made when the Yes price moves this much in 24 hours (0.15 = 15 percentage points). */
export const SHARP_MOVE = 0.15;
export const MAX_TRACKED = 40;
/** Packed history kept per market: one point per 6 hours, 14 days. */
export const HISTORY_SPACING_MS = 6 * 3_600_000;
export const HISTORY_DAYS = 14;

export interface GammaMarket {
  id: string;
  question: string;
  slug: string;
  outcomes?: string;
  outcomePrices?: string;
  oneDayPriceChange?: number | null;
  oneWeekPriceChange?: number | null;
  volumeNum?: number | null;
  endDate?: string;
  active?: boolean;
  closed?: boolean;
  groupItemTitle?: string;
}

export interface GammaEvent {
  id: string;
  title: string;
  slug: string;
  volume?: number | null;
  volume24hr?: number | null;
  active?: boolean;
  closed?: boolean;
  markets?: GammaMarket[];
  tags?: { slug?: string }[];
}

export interface TrackedMarket {
  marketId: string;
  eventTitle: string;
  question: string;
  eventSlug: string;
  /** Price of "Yes", 0–1 (read as the market's implied probability). */
  yes: number;
  /** Change in the Yes price over 24 hours and 7 days, as Polymarket reports it (0–1 scale), or null. */
  change24h: number | null;
  change7d: number | null;
  volume: number;
  volume24hEvent: number;
  endDate: string | null;
  regionIds: string[];
  countryCodes: string[];
  /** Packed history `ms:yes;ms:yes` (6-hourly, 14 days). One string so Firestore indexes one field. */
  history: string;
}

export interface PredictionMarketsSnapshot {
  fetchedAt: string;
  provider: 'polymarket';
  markets: TrackedMarket[];
  simulated?: boolean;
}

/** Watch regions named in a question (place names and demonyms, via the gazetteer). */
export function marketRegions(text: string): { regionIds: string[]; countryCodes: string[] } {
  const g = matchGazetteer(text);
  // US actions abroad are not domestic: the United States watch region is never assigned from a market.
  const regionIds = [...new Set([...g.countryCodes.flatMap(regionsForCountry), ...g.areaRegionIds])].filter((r) => r !== 'united-states');
  return { regionIds, countryCodes: g.countryCodes.filter((c) => c !== 'US') };
}

const yesPrice = (m: GammaMarket): number | null => {
  try {
    const outcomes = JSON.parse(m.outcomes ?? '[]') as string[];
    const prices = (JSON.parse(m.outcomePrices ?? '[]') as string[]).map(Number);
    const i = outcomes.findIndex((o) => o.toLowerCase() === 'yes');
    return i >= 0 && Number.isFinite(prices[i]) ? prices[i] : null;
  } catch {
    return null;
  }
};

export function unpackHistory(packed: string): [number, number][] {
  return packed
    .split(';')
    .map((p) => p.split(':').map(Number) as [number, number])
    .filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v));
}

export function appendHistory(packed: string, nowMs: number, yes: number): string {
  const pts = unpackHistory(packed).filter(([t]) => t >= nowMs - HISTORY_DAYS * 86_400_000);
  const last = pts[pts.length - 1];
  if (!last || nowMs - last[0] >= HISTORY_SPACING_MS - 5 * 60_000) pts.push([nowMs, Math.round(yes * 1000) / 1000]);
  return pts.map(([t, v]) => `${t}:${v}`).join(';');
}

/**
 * Picks the markets to track: open Yes/No markets in active events that name a watch region, with
 * real trading; one per event (its most-traded open market), most active events first.
 */
export function selectMarkets(events: GammaEvent[], nowMs: number, previous: TrackedMarket[] = []): TrackedMarket[] {
  const prev = new Map(previous.map((m) => [m.marketId, m]));
  const out: TrackedMarket[] = [];
  for (const e of [...events].sort((a, b) => (b.volume24hr ?? 0) - (a.volume24hr ?? 0))) {
    if (e.closed || (e.volume ?? 0) < MIN_EVENT_VOLUME) continue;
    const where = marketRegions(e.title);
    if (!where.regionIds.length) continue;
    const open = (e.markets ?? [])
      .filter((m) => m.active && !m.closed && (!m.endDate || Date.parse(m.endDate) > nowMs) && (m.volumeNum ?? 0) >= MIN_MARKET_VOLUME)
      .map((m) => ({ m, yes: yesPrice(m) }))
      .filter((x): x is { m: GammaMarket; yes: number } => x.yes !== null)
      .sort((a, b) => (b.m.volumeNum ?? 0) - (a.m.volumeNum ?? 0));
    const pick = open[0];
    if (!pick) continue;
    const before = prev.get(pick.m.id);
    out.push({
      marketId: pick.m.id,
      eventTitle: e.title,
      question: pick.m.question,
      eventSlug: e.slug,
      yes: pick.yes,
      change24h: typeof pick.m.oneDayPriceChange === 'number' ? pick.m.oneDayPriceChange : null,
      change7d: typeof pick.m.oneWeekPriceChange === 'number' ? pick.m.oneWeekPriceChange : null,
      volume: Math.round(pick.m.volumeNum ?? 0),
      volume24hEvent: Math.round(e.volume24hr ?? 0),
      endDate: pick.m.endDate ?? null,
      regionIds: where.regionIds,
      countryCodes: where.countryCodes,
      history: appendHistory(before?.history ?? '', nowMs, pick.yes),
    });
    if (out.length >= MAX_TRACKED) break;
  }
  return out;
}

export const marketUrl = (m: Pick<TrackedMarket, 'eventSlug'>) => `https://polymarket.com/event/${m.eventSlug}`;
export const pct = (p: number) => `${Math.round(p * 100)}%`;
