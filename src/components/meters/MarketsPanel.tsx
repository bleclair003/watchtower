import { ExternalLink } from 'lucide-react';
import { marketUrl, pct, unpackHistory, type PredictionMarketsSnapshot } from '@shared/domain/predictionMarkets';
import { getRegion } from '@shared/domain/regions';
import { formatAge } from '../../lib/time';
import { safeExternalUrl } from '../../lib/sanitize';
import { Panel } from '../ui/Panel';
import { Tag } from '../ui/Tag';
import { Sparkline } from './MeterCard';

/** Prediction-market odds (Polymarket) for all tracked questions, or one region's. */
export function MarketsPanel({ data, regionId, now, designator = 'M6' }: { data: PredictionMarketsSnapshot | null; regionId?: string; now: number; designator?: string }) {
  if (!data) return null;
  const list = regionId ? data.markets.filter((m) => m.regionIds.includes(regionId)) : data.markets;
  if (regionId && list.length === 0) return null;
  return (
    <Panel title={`Prediction markets (${list.length})`} designator={designator} actions={data.simulated ? <Tag tone="warn">SIMULATED</Tag> : undefined}>
      <p className="border-b border-wt-line px-2 py-1 text-2xs text-wt-fg-dim">
        Betting odds on Polymarket — what traders price, not WATCHTOWER’s assessment. Thin markets move on a few large bets, so only questions with real trading are shown. Updated {formatAge(data.fetchedAt, now)} ago.
      </p>
      <ul className="divide-y divide-wt-line text-2xs" aria-label="Prediction markets">
        {list.map((m) => {
          const url = safeExternalUrl(marketUrl(m));
          const move = m.change24h === null ? null : Math.round(m.change24h * 100);
          return (
            <li key={m.marketId} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-2 py-1">
              <span className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                {url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="hover:underline">
                    {m.question} <ExternalLink size={9} className="inline" aria-hidden />
                  </a>
                ) : (
                  m.question
                )}
                {!regionId && <span className="text-wt-fg-dim"> · {m.regionIds.map((r) => getRegion(r)?.shortCode ?? r).join('/')}</span>}
              </span>
              <Sparkline points={unpackHistory(m.history).map(([t, v]) => ({ t, v: v * 100 }))} width={72} height={18} />
              <span className="w-10 text-right tabular-nums text-wt-fg">{pct(m.yes)}</span>
              <span className={`w-14 text-right tabular-nums ${move !== null && Math.abs(move) >= 15 ? 'text-wt-warn' : 'text-wt-fg-dim'}`} title="Change in 24 hours, percentage points">
                {move === null ? '—' : `${move >= 0 ? '+' : '−'}${Math.abs(move)} 24h`}
              </span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
