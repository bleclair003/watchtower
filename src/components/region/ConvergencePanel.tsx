import { Link } from 'react-router-dom';
import { FEED_LABEL, type ConvergenceSnapshot } from '@shared/domain/convergence';
import { countryFeedLabel, COUNTRY_WINDOW_HOURS, type CountryHotspot } from '@shared/domain/countryConvergence';
import { formatAge, formatUtc } from '../../lib/time';
import { safeExternalUrl } from '../../lib/sanitize';
import { countryName } from '../../lib/regionSummary';
import { Panel } from '../ui/Panel';
import { Tag } from '../ui/Tag';
import { anomalySummary, LEVEL_TEXT } from '../map/ConvergenceCard';

function CountryRow({ h }: { h: CountryHotspot }) {
  const anomalies = h.signals.filter((s) => s.role === 'anomaly');
  return (
    <li className="border-b border-wt-line px-2 py-1.5 text-2xs last:border-0">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <Tag tone={h.level === 'strong' ? 'crit' : 'warn'}>{LEVEL_TEXT[h.level]}</Tag>
        <span className="text-wt-fg">{countryName(h.country)}</span>
        <span className="tabular-nums text-wt-fg-muted">last signal {formatUtc(h.last)}</span>
      </div>
      <p className="mt-0.5">
        {h.types
          .filter((t) => t.role === 'anomaly')
          .map((t) => `${t.label} ×${t.count}`)
          .join(' · ')}
      </p>
      <p className="text-wt-fg-dim">Feeds: {h.feeds.map(countryFeedLabel).join(', ')}</p>
      <details className="mt-0.5">
        <summary className="cursor-pointer text-wt-fg-muted">Signals ({h.signalCount})</summary>
        <ul className="mt-0.5 space-y-0.5">
          {[...anomalies, ...h.signals.filter((s) => s.role === 'context')].map((s) => {
            const url = safeExternalUrl(s.url);
            return (
              <li key={s.eventId}>
                <span className="text-wt-fg-dim">{formatUtc(s.at)} · {s.role} · </span>
                {url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {s.title}
                  </a>
                ) : (
                  s.title
                )}
              </li>
            );
          })}
        </ul>
      </details>
    </li>
  );
}

/**
 * Signal convergence in a region: map hotspots (v0.79.0), each opening the map on its card, and country
 * hotspots for signals without a position (v0.80.0).
 */
export function ConvergencePanel({ data, regionId, now }: { data: ConvergenceSnapshot | null; regionId: string; now: number }) {
  if (!data) return null;
  const hotspots = data.hotspots.filter((h) => h.regionIds.includes(regionId));
  const countries = (data.countries ?? []).filter((h) => h.regionIds.includes(regionId));
  return (
    <Panel title="Signal convergence" designator="CV" actions={data.simulated ? <Tag tone="warn">SIMULATED</Tag> : undefined}>
      <p className="border-b border-wt-line px-2 py-1 text-2xs text-wt-fg-dim">
        Places and countries where different kinds of signal from at least two separate feeds line up (WATCH: 2 feeds, STRONG: 3 or more): on the map within {data.radiusKm} km in{' '}
        {data.windowHours} hours, by country in {COUNTRY_WINDOW_HOURS} hours. A coincidence worth a look, not proof of a link. Checked {formatAge(data.generatedAt, now)} ago; a new
        or upgraded hotspot is also a record, so alert rules can use it.
      </p>
      <h3 className="px-2 pt-1.5 text-2xs text-wt-fg-dim">ON THE MAP</h3>
      {hotspots.length === 0 ? (
        <p className="px-2 py-1 text-2xs text-wt-fg-muted">No map hotspots in this region from {data.signalsChecked} located signals.</p>
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
      <h3 className="border-t border-wt-line px-2 pt-1.5 text-2xs text-wt-fg-dim">BY COUNTRY</h3>
      {countries.length === 0 ? (
        <p className="px-2 py-1 pb-1.5 text-2xs text-wt-fg-muted">No country hotspots in this region.</p>
      ) : (
        <ul aria-label="Country convergence">
          {countries.map((h) => (
            <CountryRow key={h.country} h={h} />
          ))}
        </ul>
      )}
    </Panel>
  );
}
