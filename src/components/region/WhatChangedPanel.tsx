import { describeChange, type RegionChanges } from '@shared/domain/changes';
import { INDICATOR_STATE_TONE } from '../../config/indicators';
import { formatAge } from '../../lib/time';
import { Panel } from '../ui/Panel';
import { Tag } from '../ui/Tag';

const MAX_STORIES = 5;
const MAX_WARNINGS = 5;

/** Region diff against about 24 hours ago: indicator state changes, new stories, official warnings (the RAI change is in the page header). */
export function WhatChangedPanel({ changes, now }: { changes: RegionChanges; now: number }) {
  const { indicators, newStories, warnings } = changes;
  const quiet = indicators.length === 0 && newStories.length === 0 && warnings.length === 0;
  return (
    <Panel title="What changed — last 24 h" designator="R0">
      <div className="space-y-1.5 px-2 py-1.5 text-2xs">
        {quiet && <p className="text-wt-fg-dim">No indicator changes, new stories or official warnings.</p>}

        {indicators.length > 0 && (
          <div>
            <h3 className="text-wt-fg-dim">INDICATORS</h3>
            <ul className="space-y-0.5">
              {indicators.map((c) => (
                <li key={c.indicatorId} className="flex items-center gap-1.5">
                  <span className={c.direction === 'up' ? 'text-wt-warn' : c.direction === 'down' ? 'text-wt-info' : 'text-wt-fg-dim'} aria-hidden>
                    {c.direction === 'up' ? '▲' : c.direction === 'down' ? '▼' : '•'}
                  </span>
                  <span className="truncate">{c.name}</span>
                  <span className="ml-auto shrink-0 text-wt-fg-dim">{describeChange(c).replace(c.to, '').trim()}</span>
                  <Tag tone={INDICATOR_STATE_TONE[c.to]}>{c.to}</Tag>
                  <span className="shrink-0 tabular-nums text-wt-fg-dim">{formatAge(c.at, now)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {newStories.length > 0 && (
          <div>
            <h3 className="text-wt-fg-dim">NEW STORIES ({newStories.length})</h3>
            <ul className="space-y-0.5">
              {newStories.slice(0, MAX_STORIES).map((s) => (
                <li key={s.url} className="flex gap-1.5">
                  <a href={s.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline" title={s.title}>
                    {s.title}
                  </a>
                  <span className="shrink-0 text-wt-fg-dim">
                    {s.reports > 1 ? `${s.reports} reports · ${s.publishers} pub.` : '1 report'}
                    {s.official ? ' · official' : ''}
                  </span>
                </li>
              ))}
            </ul>
            {newStories.length > MAX_STORIES && <p className="text-wt-fg-dim">+{newStories.length - MAX_STORIES} more in Latest reports.</p>}
          </div>
        )}

        {warnings.length > 0 && (
          <div>
            <h3 className="text-wt-fg-dim">OFFICIAL WARNINGS</h3>
            <ul className="space-y-0.5">
              {warnings.slice(0, MAX_WARNINGS).map((e) => (
                <li key={e.id} className="flex gap-1.5">
                  <a href={e.sourceUrl} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-wt-warn hover:underline" title={e.title}>
                    {e.title}
                  </a>
                  <span className="shrink-0 tabular-nums text-wt-fg-dim">{formatAge(e.publishedAt ?? e.collectedAt, now)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Panel>
  );
}
