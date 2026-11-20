import { useMemo } from 'react';
import { Crosshair } from 'lucide-react';
import { WATCH_REGIONS } from '@shared/domain/regions';
import type { IntelligenceEvent } from '@shared/domain/types';
import { computeRegionStats } from '../../lib/filters';
import { formatAge } from '../../lib/time';
import { Panel } from '../ui/Panel';
import { Tag } from '../ui/Tag';

interface Props {
  events: IntelligenceEvent[];
  selectedRegionId: string | null;
  onSelect: (id: string | null) => void;
  now: number;
  className?: string;
}

/**
 * Regional watchlist. The Regional Activity Index (RAI) column honestly reads
 * "N/E" (not evaluated) until the Phase 3 indicator engine exists — report
 * volume is shown separately and is not a score.
 */
export function RegionalWatchlist({ events, selectedRegionId, onSelect, now, className }: Props) {
  const stats = useMemo(() => computeRegionStats(events, now), [events, now]);

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
          const selected = selectedRegionId === r.id;
          return (
            <li key={r.id}>
              <button
                onClick={() => onSelect(selected ? null : r.id)}
                aria-pressed={selected}
                className={`block w-full px-2 py-1.5 text-left transition-colors ${
                  selected ? 'bg-wt-info/10 outline outline-1 -outline-offset-1 outline-wt-info' : 'hover:bg-wt-bg2'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  {selected && <Crosshair size={11} className="text-wt-info" aria-hidden />}
                  <span className={`text-xs tracking-wide ${selected ? 'text-wt-info' : 'text-wt-fg'}`}>{r.name.toUpperCase()}</span>
                  <span className="ml-auto" title="Regional Activity Index — not evaluated until the Phase 3 indicator engine is built">
                    <Tag tone="inactive">RAI N/E</Tag>
                  </span>
                </div>
                <dl className="mt-1 grid grid-cols-4 gap-1 text-2xs">
                  <div>
                    <dt className="text-wt-fg-dim">RPT 24H</dt>
                    <dd className="tabular-nums">{s.last24h}</dd>
                  </div>
                  <div>
                    <dt className="text-wt-fg-dim">Δ PRIOR</dt>
                    <dd className={`tabular-nums ${s.delta > 0 ? 'text-wt-warn' : s.delta < 0 ? 'text-wt-info' : 'text-wt-fg-muted'}`}>
                      {s.delta > 0 ? `+${s.delta}` : s.delta}
                    </dd>
                  </div>
                  <div title="Active indicators — engine not deployed (Phase 3)">
                    <dt className="text-wt-fg-dim">IND</dt>
                    <dd className="text-wt-inactive">—</dd>
                  </div>
                  <div>
                    <dt className="text-wt-fg-dim">LATEST</dt>
                    <dd className="tabular-nums text-wt-fg-muted">{s.latestAt ? formatAge(s.latestAt, now) : '—'}</dd>
                  </div>
                </dl>
                <div className="mt-0.5 text-2xs text-wt-fg-dim">ASSESSED: NEVER</div>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="border-t border-wt-line px-2 py-1.5 text-2xs leading-snug text-wt-fg-dim">
        RPT = report count (volume, not severity). RAI and indicators come online with the Phase 3 engine.
      </p>
    </Panel>
  );
}
