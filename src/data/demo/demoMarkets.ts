import type { PredictionMarketsSnapshot, TrackedMarket } from '@shared/domain/predictionMarkets';

/** SIMULATED market odds for demo mode and tests (flagged `simulated`). Invented questions. */
export function buildDemoMarkets(now: number): PredictionMarketsSnapshot {
  const hist = (vals: number[]) => vals.map((v, i) => `${now - (vals.length - 1 - i) * 6 * 3_600_000}:${v}`).join(';');
  const m = (id: string, question: string, regionIds: string[], yes: number, change24h: number, vals: number[]): TrackedMarket => ({
    marketId: id, eventTitle: question, question, eventSlug: `demo-${id}`, yes, change24h, change7d: null, volume: 500_000, volume24hEvent: 20_000, endDate: null, regionIds, countryCodes: [], history: hist(vals),
  });
  return {
    fetchedAt: new Date(now).toISOString(),
    provider: 'polymarket',
    simulated: true,
    markets: [
      m('d1', '[SIMULATED] Demo ceasefire holds through month end?', ['middle-east'], 0.41, -0.18, [0.6, 0.62, 0.59, 0.58, 0.41]),
      m('d2', '[SIMULATED] Demo strait reopens to normal traffic?', ['middle-east'], 0.12, 0.02, [0.1, 0.1, 0.11, 0.12]),
      m('d3', '[SIMULATED] Demo border talks resume?', ['eastern-europe'], 0.27, 0.05, [0.2, 0.22, 0.27]),
    ],
  };
}
