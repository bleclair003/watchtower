import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Crosshair } from 'lucide-react';
import { WATCH_REGIONS } from '@shared/domain/regions';
import type { IntelligenceEvent } from '@shared/domain/types';
import type { IndicatorEvaluation, RegionScore, ScoreHistoryPoint } from '@shared/domain/indicators/types';
import { regionChanges } from '@shared/domain/changes';
import { scoreDelta24h } from '@shared/domain/indicators/rai';
import { computeRegionStats } from '../../lib/filters';
import { formatAge } from '../../lib/time';
import { BAND_TONE, INDICATOR_STATE_TONE, RAI_DISCLAIMER } from '../../config/indicators';
import { Panel } from '../ui/Panel';
import { Lamp, Tag } from '../ui/Tag';

interface Props {
  events: IntelligenceEvent[];
  regionScores: RegionScore[];
  scoreHistory: ScoreHistoryPoint[];
  indicatorEvaluations: IndicatorEvaluation[];
  selectedRegionId: string | null;
  onSelect: (id: string | null) => void;
  now: number;
  className?: string;
}

function RaiTag({ score }: { score: RegionScore | undefined }) {
  if (!score || score.score === null) {
    return (
      <span title="Not evaluated: no indicator for this region has usable data">
        <Tag tone="inactive">RAI N/E</Tag>
      </span>
    );
  }
  return (
    <span title={`${score.band} · coverage ${Math.round(score.coverage * 100)}%`}>
      <Tag tone={BAND_TONE[score.band!]}>
        RAI {score.score} · {score.band}
      </Tag>
    </span>
  );
}

/** Contribution breakdown for the selected region: every point in the RAI is traceable. */
function Breakdown({ score }: { score: RegionScore }) {
  if (score.score === null) {
    return <p className="text-2xs text-wt-fg-dim">No evaluable indicators: required sources have no usable data.</p>;
  }
  return (
    <div className="space-y-0.5 text-2xs">
      {score.contributions.map((c) => (
        <div key={c.indicatorId} className="flex items-center gap-1.5">
          <Lamp tone={INDICATOR_STATE_TONE[c.state]} label={c.state} />
          <span className="truncate text-wt-fg-muted">{c.name}</span>
          <span className="ml-auto tabular-nums" title={c.capped ? 'Reduced by the per-source cap' : undefined}>
            +{c.applied.toFixed(1)}
            {c.capped && <span className="text-wt-warn">*</span>}
          </span>
        </div>
      ))}
      <div className="flex justify-between border-t border-wt-line pt-0.5 text-wt-fg-dim">
        <span>COVERAGE {Math.round(score.coverage * 100)}%</span>
        <Link to={`/indicators#${score.regionId}`} className="text-wt-info hover:underline" onClick={(e) => e.stopPropagation()}>
          INDICATORS →
        </Link>
      </div>
    </div>
  );
}

/** One line: what changed in the region in the last 24 hours. */
function ChangedLine({ c }: { c: ReturnType<typeof regionChanges> | undefined }) {
  if (!c) return null;
  const up = c.indicators.filter((x) => x.direction === 'up').length;
  const down = c.indicators.filter((x) => x.direction === 'down').length;
  const parts = [
    up ? `▲${up} indicator${up > 1 ? 's' : ''}` : '',
    down ? `▼${down} indicator${down > 1 ? 's' : ''}` : '',
    c.newStories.length ? `${c.newStories.length} new stor${c.newStories.length > 1 ? 'ies' : 'y'}` : '',
    c.warnings.length ? `${c.warnings.length} warning${c.warnings.length > 1 ? 's' : ''}` : '',
  ].filter(Boolean);
  return (
    <div className="mt-0.5 truncate text-2xs" title="Changes in the last 24 hours (details on the region page)">
      <span className="text-wt-fg-dim">24H: </span>
      <span className={up || c.warnings.length ? 'text-wt-warn' : 'text-wt-fg-muted'}>{parts.length ? parts.join(' · ') : 'no changes'}</span>
    </div>
  );
}

/**
 * Regional watchlist: Regional Activity Index, its 24 h change, active
 * indicators, and raw report volume (shown separately — volume is not a score).
 */
export function RegionalWatchlist({ events, regionScores, scoreHistory, indicatorEvaluations, selectedRegionId, onSelect, now, className }: Props) {
  const stats = useMemo(() => computeRegionStats(events, now), [events, now]);
  const changes = useMemo(
    () => new Map(WATCH_REGIONS.map((r) => [r.id, regionChanges({ events, indicatorEvaluations, regionScores, scoreHistory }, r.id, now)])),
    [events, indicatorEvaluations, regionScores, scoreHistory, now],
  );

  return (
    <Panel
      title="Regional Watch"
      designator="A1"
      actions={
        selectedRegionId && (
          <button onClick={() => onSelect(null)} className="text-2xs text-wt-fg-muted hover:text-wt-fg">
            [ALL]
          </button>
        )
      }
      className={className}
      bodyClassName="overflow-y-auto"
    >
      <ul className="divide-y divide-wt-line">
        {WATCH_REGIONS.map((r) => {
          const s = stats.find((x) => x.regionId === r.id)!;
          const score = regionScores.find((x) => x.regionId === r.id);
          const delta = scoreDelta24h(scoreHistory, r.id, score?.score ?? null, now);
          const selected = selectedRegionId === r.id;
          return (
            <li key={r.id} className={selected ? 'bg-wt-info/10 outline outline-1 -outline-offset-1 outline-wt-info' : ''}>
              <button
                onClick={() => onSelect(selected ? null : r.id)}
                aria-pressed={selected}
                className={`block w-full px-2 py-1.5 text-left transition-colors ${selected ? '' : 'hover:bg-wt-bg2'}`}
              >
                <div className="flex items-center gap-1.5">
                  {selected && <Crosshair size={11} className="text-wt-info" aria-hidden />}
                  <span className={`text-xs tracking-wide ${selected ? 'text-wt-info' : 'text-wt-fg'}`}>{r.name.toUpperCase()}</span>
                  <span className="ml-auto">
                    <RaiTag score={score} />
                  </span>
                </div>
                <dl className="mt-1 grid grid-cols-4 gap-1 text-2xs">
                  <div title="RAI change versus about 24 hours ago">
                    <dt className="text-wt-fg-dim">Δ RAI 24H</dt>
                    <dd className={`tabular-nums ${delta && delta > 0 ? 'text-wt-warn' : delta && delta < 0 ? 'text-wt-info' : 'text-wt-fg-muted'}`}>
                      {delta === null ? '—' : delta > 0 ? `+${delta}` : delta}
                    </dd>
                  </div>
                  <div title="Indicators currently ELEVATED or TRIGGERED">
                    <dt className="text-wt-fg-dim">IND</dt>
                    <dd className={`tabular-nums ${score?.activeIndicators ? 'text-wt-warn' : 'text-wt-fg-muted'}`}>
                      {score && score.score !== null ? score.activeIndicators : '—'}
                    </dd>
                  </div>
                  <div title="Reports in the last 24 h (volume, not severity)">
                    <dt className="text-wt-fg-dim">RPT 24H</dt>
                    <dd className="tabular-nums">
                      {s.last24h}
                      {s.delta !== 0 && <span className="text-wt-fg-dim"> ({s.delta > 0 ? `+${s.delta}` : s.delta})</span>}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-wt-fg-dim">LATEST</dt>
                    <dd className="tabular-nums text-wt-fg-muted">{s.latestAt ? formatAge(s.latestAt, now) : '—'}</dd>
                  </div>
                </dl>
                <ChangedLine c={changes.get(r.id)} />
                <div className="mt-0.5 text-2xs text-wt-fg-dim">
                  ASSESSED: {score?.evaluatedAt && score.score !== null ? `${formatAge(score.evaluatedAt, now)} ago` : 'NOT EVALUABLE'}
                </div>
              </button>
              {selected && (
                <div className="space-y-1 px-2 pb-2">
                  {score && <Breakdown score={score} />}
                  <Link to={`/regions/${r.id}`} className="inline-block text-2xs text-wt-info hover:underline">
                    OPEN {r.shortCode} REGION PAGE →
                  </Link>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="border-t border-wt-line px-2 py-1.5 text-2xs leading-snug text-wt-fg-dim">{RAI_DISCLAIMER}</p>
    </Panel>
  );
}
