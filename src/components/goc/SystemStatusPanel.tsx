import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { SourceHealth } from '@shared/domain/types';
import { useData } from '../../state/DataContext';
import { formatAge, formatUtc } from '../../lib/time';
import { Lamp, Tag } from '../ui/Tag';
import { HEALTH_TONE } from '../../config/categories';

function Cell({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 border-r border-wt-line px-2.5 py-1.5 last:border-r-0 ${className}`}>
      <span className="text-2xs tracking-widest text-wt-fg-dim">{label}</span>
      <div className="min-w-0 text-xs">{children}</div>
    </div>
  );
}

/**
 * Bottom status strip. Everything here reflects real application state —
 * subsystems that do not exist yet are reported as such, never as "OK".
 */
export function SystemStatusPanel({ now }: { now: number }) {
  const { sourceStatus, mode, loadedAt, error, events, previousSessionAt, refresh, loading } = useData();

  const counts = sourceStatus.reduce<Partial<Record<SourceHealth, number>>>((acc, s) => {
    acc[s.health] = (acc[s.health] ?? 0) + 1;
    return acc;
  }, {});
  const newSinceLast = previousSessionAt
    ? events.filter((e) => Date.parse(e.collectedAt) > Date.parse(previousSessionAt)).length
    : null;

  return (
    <section aria-label="System status" className="grid shrink-0 grid-cols-2 border border-wt-line bg-wt-panel md:grid-cols-4 xl:grid-cols-7">
      <Cell label="SOURCE HEALTH">
        <Link to="/sources" className="flex flex-wrap items-center gap-x-2 gap-y-0.5 hover:underline">
          {(Object.keys(HEALTH_TONE) as SourceHealth[])
            .filter((h) => counts[h])
            .map((h) => (
              <span key={h} className="flex items-center gap-1 whitespace-nowrap">
                <Lamp tone={HEALTH_TONE[h]} label={h} />
                <span className="tabular-nums">{counts[h]}</span>
                <span className="text-2xs text-wt-fg-muted">{h.replace('_', ' ')}</span>
              </span>
            ))}
        </Link>
      </Cell>
      <Cell label="DATABASE / FRESHNESS">
        {error ? (
          <span className="text-wt-crit">LOAD ERROR: {error}</span>
        ) : (
          <span className="flex items-center gap-1.5">
            <Tag tone={mode === 'demo' ? 'warn' : 'ok'}>{mode === 'demo' ? 'DEMO FIXTURES' : 'FIRESTORE'}</Tag>
            <span className="text-wt-fg-muted tabular-nums" title={formatUtc(loadedAt, true)}>
              {loadedAt ? `${formatAge(loadedAt, now)} ago` : '—'}
            </span>
            <button
              onClick={() => void refresh()}
              disabled={loading}
              className="text-2xs text-wt-fg-muted hover:text-wt-fg disabled:opacity-50"
            >
              [{loading ? 'LOADING' : 'RELOAD'}]
            </button>
          </span>
        )}
      </Cell>
      <Cell label="COLLECTION">
        <span className="text-wt-inactive">NO COLLECTOR RUNS</span>
        <div className="text-2xs text-wt-fg-dim">Interval: none (Phase 2)</div>
      </Cell>
      <Cell label="COLLECTION ERRORS">
        <span className="text-wt-inactive">N/A — NOT COLLECTING</span>
      </Cell>
      <Cell label="INDICATORS">
        <span className="text-wt-inactive">ENGINE OFFLINE</span>
        <div className="text-2xs text-wt-fg-dim">Phase 3</div>
      </Cell>
      <Cell label="ALERT DELIVERY">
        <span className="text-wt-inactive">NOT CONFIGURED</span>
        <div className="text-2xs text-wt-fg-dim">Phase 4</div>
      </Cell>
      <Cell label="NEW SINCE LAST SESSION">
        {newSinceLast == null ? (
          <span className="text-wt-fg-muted">FIRST SESSION</span>
        ) : (
          <span className="tabular-nums">
            {newSinceLast}
            <span className="ml-1 text-2xs text-wt-fg-dim">since {formatUtc(previousSessionAt)}</span>
          </span>
        )}
      </Cell>
    </section>
  );
}
