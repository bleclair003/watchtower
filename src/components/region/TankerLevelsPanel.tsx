import { MIN_DAYS, type ZoneLevel } from '@shared/domain/tankerLevels';
import { useShipTraffic } from '../../data/useShipTraffic';
import { formatAge } from '../../lib/time';
import { Panel } from '../ui/Panel';
import { Tag } from '../ui/Tag';

/** Daily mean tankers, oldest first, with the last 24 h as the final point (marked). */
function Line({ z }: { z: ZoneLevel }) {
  const values = [...z.days.slice(-30).map((d) => d[1]), z.last24.mean];
  const w = 150;
  const h = 26;
  const max = Math.max(...values, 1);
  const x = (i: number) => (i / Math.max(values.length - 1, 1)) * (w - 4) + 2;
  const y = (v: number) => h - 2 - (v / max) * (h - 4);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values.length - 1;
  const tone = z.direction === 'surge' ? 'text-wt-warn' : z.direction === 'drop' ? 'text-wt-crit' : 'text-wt-fg';
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="block">
      {values.length > 1 && <polygon points={`${x(0)},${h - 2} ${pts} ${x(last)},${h - 2}`} fill="currentColor" className="text-wt-fg" opacity={0.12} />}
      {values.length > 1 && <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={1.2} className="text-wt-fg-muted" />}
      <circle cx={x(last)} cy={y(values[last])} r={2.6} fill="currentColor" className={tone} />
    </svg>
  );
}

/**
 * Tanker traffic levels in the Gulf of Finland (v0.78.0): tankers present per zone, from Fintraffic's
 * feed, each day against the zone's usual level.
 */
export function TankerLevelsPanel({ now }: { now: number }) {
  const { data, error } = useShipTraffic(true);
  const levels = data?.levels ?? [];
  if (!data && !error) return null;
  return (
    <Panel title="Tanker traffic — Gulf of Finland" designator="R8" actions={data?.simulated ? <Tag tone="warn">SIMULATED</Tag> : undefined}>
      <p className="border-b border-wt-line px-2 py-1 text-2xs text-wt-fg-dim">
        Tankers heard in each zone, counted every collection run from every ship Finland’s receivers hear: the line is each day’s average, the dot the last 24 hours.
        Three or more typical spreads from the zone’s own usual level is a SURGE or DROP; that needs {MIN_DAYS} days of history first.
        Weather, ice and receiver gaps move the counts too. Source: Fintraffic / digitraffic.fi, CC BY 4.0{data ? ` · updated ${formatAge(data.fetchedAt, now)} ago` : ''}.
      </p>
      {error && !data ? (
        <p className="px-2 py-1.5 text-2xs text-wt-fg-muted">{error}</p>
      ) : levels.length === 0 ? (
        <p className="px-2 py-1.5 text-2xs text-wt-fg-muted">No counts yet: they start with the first run that hears Finland’s feed.</p>
      ) : (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Tanker levels by zone">
          <table className="w-full text-2xs tabular-nums">
            <thead className="text-wt-fg-dim">
              <tr className="border-b border-wt-line">
                <th className="px-2 py-1 text-left font-normal">Zone</th>
                <th className="px-2 py-1 text-left font-normal">Days</th>
                <th className="px-2 py-1 text-right font-normal">Last 24 h</th>
                <th className="px-2 py-1 text-right font-normal">At anchor</th>
                <th className="px-2 py-1 text-right font-normal">Usual</th>
                <th className="px-2 py-1 text-right font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {levels.map((z) => (
                <tr key={z.id} className="border-b border-wt-line last:border-0">
                  <td className="px-2 py-1">{z.name}</td>
                  <td className="px-2 py-1"><Line z={z} /></td>
                  <td className="px-2 py-1 text-right">{z.last24.hours ? z.last24.mean : '—'}</td>
                  <td className="px-2 py-1 text-right">{z.last24.hours ? z.last24.anchored : '—'}</td>
                  <td className="px-2 py-1 text-right">{z.centre ?? '—'}</td>
                  <td className="px-2 py-1 text-right">
                    {z.direction === 'surge' ? (
                      <Tag tone="warn">SURGE {z.score}</Tag>
                    ) : z.direction === 'drop' ? (
                      <Tag tone="crit">DROP {z.score}</Tag>
                    ) : z.score === null ? (
                      <span className="text-wt-fg-dim">building ({z.days.length}/{MIN_DAYS} days)</span>
                    ) : (
                      z.score
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
