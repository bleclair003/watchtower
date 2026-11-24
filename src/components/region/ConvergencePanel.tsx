import { Link } from 'react-router-dom';
import { FEED_LABEL, type ConvergenceSnapshot } from '@shared/domain/convergence';
import { formatAge, formatUtc } from '../../lib/time';
import { Panel } from '../ui/Panel';
import { Tag } from '../ui/Tag';
import { anomalySummary, LEVEL_TEXT } from '../map/ConvergenceCard';

/**
 * Signal convergence hotspots in a region (v0.79.0): places where different kinds of signal from separate
 * feeds line up. Each row opens the map on the hotspot with its card shown.
 */
export function ConvergencePanel({ data, regionId, now }: { data: ConvergenceSnapshot | null; regionId: string; now: number }) {
  if (!data) return null;
  const hotspots = data.hotspots.filter((h) => h.regionIds.includes(regionId));
  return (
    <Panel title="Signal convergence" designator="CV" actions={data.simulated ? <Tag tone="warn">SIMULATED</Tag> : undefined}>
      <p className="border-b border-wt-line px-2 py-1 text-2xs text-wt-fg-dim">
        Places where different kinds of signal from at least two separate feeds line up within {data.radiusKm} km in the last {data.windowHours} hours (WATCH: 2 feeds, STRONG: 3 or more). A coincidence worth a look, not proof of a link. Checked{' '}
        {formatAge(data.generatedAt, now)} ago.
      </p>
      {hotspots.length === 0 ? (
        <p className="px-2 py-1.5 text-2xs text-wt-fg-muted">No hotspots in this region from {data.signalsChecked} located signals.</p>
      ) : (
        <ul aria-label="Convergence hotspots">
          {hotspots.map((h) => (
            <li key={h.id} className="border-b border-wt-line px-2 py-1.5 text-2xs last:border-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <Tag tone={h.level === 'strong' ? 'crit' : 'warn'}>{LEVEL_TEXT[h.level]}</Tag>
                <span className="tabular-nums text-wt-fg-muted">
                  {h.lat.toFixed(1)}°, {h.lon.toFixed(1)}° · {h.radiusKm} km · last signal {formatUtc(h.last)}
                </span>
                <Link to={`/?at=${h.lat.toFixed(3)},${h.lon.toFixed(3)},6.0&sel=conv:${encodeURIComponent(h.id)}`} className="ml-auto text-wt-info underline">
                  Show on the map
                </Link>
              </div>
              <p className="mt-0.5">{anomalySummary(h)}</p>
              <p className="text-wt-fg-dim">Feeds: {h.feeds.map((f) => FEED_LABEL[f] ?? f).join(', ')}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
