import { marketUrl, pct } from '../predictionMarkets.ts';
import type { MeterInput } from './input.ts';
import type { Meter, MeterComponent } from './types.ts';
import { levelFromScore, meter } from './util.ts';

/**
 * Prediction markets: the largest 24-hour move in the odds of the tracked watch-region questions
 * (Polymarket). Level by the biggest move in percentage points: 5 / 10 / 20 / 30.
 */
export function marketOdds(input: MeterInput): Meter {
  const pm = input.predictionMarkets;
  const markets = pm?.markets ?? [];
  const moving = markets.filter((m) => m.change24h !== null).sort((a, b) => Math.abs(b.change24h!) - Math.abs(a.change24h!));
  const top = moving[0];
  const points = top ? Math.round(Math.abs(top.change24h!) * 100) : 0;
  const components: MeterComponent[] = moving.slice(0, 6).map((m) => ({
    label: m.question,
    value: `${pct(m.yes)} (${m.change24h! >= 0 ? '+' : '−'}${Math.round(Math.abs(m.change24h!) * 100)} in 24 h)`,
    active: Math.abs(m.change24h!) >= 0.1,
  }));
  return meter({
    id: 'markets',
    kind: 'markets',
    family: 'topic',
    name: 'Prediction markets',
    regionId: null,
    level: pm ? levelFromScore(points, [5, 10, 20, 30]) : null,
    label: pm ? (top ? `MAX MOVE ${points} PTS` : 'NO MOVES') : 'NO DATA',
    value: pm ? points : null,
    reading: !pm
      ? 'No market data loaded.'
      : top
        ? `Biggest 24-hour move among ${markets.length} tracked questions: "${top.question}" ${top.change24h! >= 0 ? 'up' : 'down'} ${points} points to ${pct(top.yes)}.`
        : `${markets.length} questions tracked; no 24-hour change reported.`,
    components,
    evidence: moving.slice(0, 4).map((m) => ({ title: `${m.question} — ${pct(m.yes)}`, url: marketUrl(m), at: pm!.fetchedAt, why: 'Polymarket odds' })),
    asOf: pm?.fetchedAt ?? null,
    baseline: 'none',
    notes: ['Betting odds on Polymarket, not WATCHTOWER’s assessment. Markets can move on rumours and on a few large bets; only markets with real trading are tracked.'],
  });
}
