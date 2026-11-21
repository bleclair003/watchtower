import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { WATCH_REGIONS } from '@shared/domain/regions';
import { scoreDelta24h } from '@shared/domain/indicators/rai';
import { useData } from '../state/DataContext';
import { useNow } from '../hooks/useNow';
import { summarizeRegion } from '../lib/regionSummary';
import { BAND_TONE, RAI_DISCLAIMER } from '../config/indicators';
import { Panel } from '../components/ui/Panel';
import { Tag } from '../components/ui/Tag';

/** Index of the watch regions: one card each, linking to the region page. */
export default function RegionsPage() {
  const data = useData();
  const now = useNow(60_000).getTime();
  useEffect(() => {
    document.title = 'WATCHTOWER // REGIONS';
  }, []);

  const cards = useMemo(
    () =>
      WATCH_REGIONS.map((r) => {
        const score = data.regionScores.find((s) => s.regionId === r.id);
        const summary = summarizeRegion(data.events, r.id, now);
        const delta = score ? scoreDelta24h(data.scoreHistory, r.id, score.score, now) : null;
        return { r, score, summary, delta };
      }),
    [data.events, data.regionScores, data.scoreHistory, now],
  );

  return (
    <div className="h-full space-y-1.5 overflow-y-auto p-1.5">
      <Panel title="Watch Regions" designator="R0">
        <p className="px-2 py-1.5 text-2xs text-wt-fg-dim">{RAI_DISCLAIMER}</p>
        <ul className="grid border-t border-l border-wt-line sm:grid-cols-2 xl:grid-cols-3">
          {cards.map(({ r, score, summary, delta }) => (
            <li key={r.id} className="border-r border-b border-wt-line bg-wt-panel">
              <Link to={`/regions/${r.id}`} className="block h-full p-2 hover:bg-wt-info/[0.06]">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm tracking-wider text-wt-fg">{r.name.toUpperCase()}</span>
                  {score && score.score !== null ? (
                    <Tag tone={BAND_TONE[score.band!]}>
                      RAI {score.score} · {score.band}
                    </Tag>
                  ) : (
                    <Tag tone="inactive">RAI N/E</Tag>
                  )}
                </div>
                <p className="mt-0.5 text-2xs text-wt-fg-muted">{r.description}</p>
                <dl className="mt-1.5 grid grid-cols-3 gap-1 text-2xs">
                  <div>
                    <dt className="text-wt-fg-dim">Δ RAI 24H</dt>
                    <dd className="tabular-nums">{delta === null ? '—' : delta > 0 ? `+${delta}` : delta}</dd>
                  </div>
                  <div>
                    <dt className="text-wt-fg-dim">ACTIVE IND</dt>
                    <dd className={`tabular-nums ${score?.activeIndicators ? 'text-wt-warn' : ''}`}>{score?.activeIndicators ?? 0}</dd>
                  </div>
                  <div>
                    <dt className="text-wt-fg-dim">REPORTS 24H</dt>
                    <dd className="tabular-nums">{summary.last24h}</dd>
                  </div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
