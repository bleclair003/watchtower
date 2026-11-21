import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import {
  MARKETS_SOURCE_ID,
  SHARP_MOVE,
  marketUrl,
  pct,
  selectMarkets,
  type GammaEvent,
  type PredictionMarketsSnapshot,
  type TrackedMarket,
} from '../../shared/domain/predictionMarkets.ts';
import { contentHash } from '../lib/hash.ts';
import { LIMITS, truncate } from '../lib/text.ts';
import type { AdapterContext, AdapterResult, SourceAdapter } from './types.ts';

export { MARKETS_SOURCE_ID };
/** Public, documented Gamma API (read-only, no key). The website itself may not be scraped (Terms of Use). */
export const GAMMA_EVENTS = 'https://gamma-api.polymarket.com/events?active=true&closed=false&tag_slug=geopolitics&limit=60&order=volume24hr&ascending=false';
export const MARKETS_EVERY_MINUTES = 55;

/** One record per market, day and direction when the Yes price moves 15 points or more in 24 hours. */
export function marketMoveEvents(markets: TrackedMarket[], nowMs: number): IntelligenceEvent[] {
  const nowIso = new Date(nowMs).toISOString();
  const day = nowIso.slice(0, 10);
  return markets.flatMap((m) => {
    if (m.change24h === null || Math.abs(m.change24h) < SHARP_MOVE) return [];
    const direction = m.change24h > 0 ? 'up' : 'down';
    const before = Math.min(1, Math.max(0, m.yes - m.change24h));
    const id = contentHash(MARKETS_SOURCE_ID, m.marketId, day, direction);
    return [{
      id,
      contentHash: id,
      dataOrigin: 'live' as const,
      sourceId: MARKETS_SOURCE_ID,
      sourceName: 'Polymarket — prediction market odds',
      sourceClass: 'aggregator' as const,
      sourceUrl: marketUrl(m),
      title: truncate(`Market odds ${direction === 'up' ? 'rose' : 'fell'}: "${m.question}" ${pct(before)} → ${pct(m.yes)} in 24 h (Polymarket)`, LIMITS.title),
      summary: truncate(
        `Traders on Polymarket price "${m.question}" at ${pct(m.yes)}, ${direction} ${Math.round(Math.abs(m.change24h) * 100)} points in 24 hours (market volume $${m.volume.toLocaleString('en-US')}). ` +
          'These are betting odds, not WATCHTOWER’s assessment; markets can move on rumours and on a few large bets.',
        LIMITS.summary,
      ),
      category: 'economic' as const,
      regionIds: m.regionIds,
      countryCodes: m.countryCodes,
      publishedAt: nowIso,
      occurredAt: null,
      collectedAt: nowIso,
      credibility: 'single-source' as const,
      verificationStatus: 'unreviewed' as const,
      locationPrecision: m.countryCodes.length ? ('country' as const) : ('none' as const),
      metadata: { subtype: 'market-odds-move', marketId: m.marketId, direction, yes: m.yes, change24h: m.change24h, volume: m.volume },
    }];
  });
}

export interface PolymarketState {
  lastFetchedAt: string;
  latest: PredictionMarketsSnapshot | null;
}

/** Polymarket geopolitics markets that name a watch region, about once an hour. */
export const polymarketOdds: SourceAdapter<PolymarketState> = {
  sourceId: MARKETS_SOURCE_ID,
  async collect(ctx: AdapterContext<PolymarketState>): Promise<AdapterResult<PolymarketState>> {
    if (ctx.state && ctx.now - Date.parse(ctx.state.lastFetchedAt) < MARKETS_EVERY_MINUTES * 60_000) {
      return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: ctx.state };
    }
    const res = await ctx.fetch(GAMMA_EVENTS, undefined, { Accept: 'application/json' }, { maxBytes: 16 * 1024 * 1024, timeoutMs: 30_000 });
    if (res.kind !== 'ok') throw new Error('Polymarket: unexpected 304');
    const body = JSON.parse(res.body) as unknown;
    if (!Array.isArray(body)) throw new Error('Polymarket: unexpected response');
    const markets = selectMarkets(body as GammaEvent[], ctx.now, ctx.state?.latest?.markets ?? []);
    const nowIso = new Date(ctx.now).toISOString();
    return {
      events: marketMoveEvents(markets, ctx.now),
      rejected: [],
      itemsSeen: markets.length,
      notModified: false,
      state: { lastFetchedAt: nowIso, latest: { fetchedAt: nowIso, provider: 'polymarket', markets } },
    };
  },
};
