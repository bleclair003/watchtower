import { ExternalLink } from 'lucide-react';
import { gFromKp, type SpaceWeatherSnapshot } from '@shared/domain/spaceWeather';
import { formatAge } from '../../lib/time';
import { safeExternalUrl } from '../../lib/sanitize';
import { Panel } from '../ui/Panel';
import { Tag } from '../ui/Tag';

const fmt = (t: string) => `${t.slice(8, 10)}/${t.slice(5, 7)} ${t.slice(11, 16)} UTC`;
const tone = (n: number) => (n >= 3 ? 'crit' : n >= 1 ? 'warn' : 'muted') as 'crit' | 'warn' | 'muted';

/** Space weather: NOAA scales now and for three days, Kp, CMEs heading for Earth (NASA DONKI), notable NOAA messages. */
export function SpaceWeatherPanel({ data, now, designator = 'M10' }: { data: SpaceWeatherSnapshot | null; now: number; designator?: string }) {
  if (!data) return null;
  const cur = data.now ?? { r: 0, s: 0, g: 0 };
  return (
    <Panel title="Space weather" designator={designator} actions={data.simulated ? <Tag tone="warn">SIMULATED</Tag> : undefined}>
      <div className="space-y-1.5 px-2 py-1.5 text-2xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-wt-fg-dim">NOW</span>
          <Tag tone={tone(cur.r >= 3 ? cur.r : 0)}>R{cur.r} radio</Tag>
          <Tag tone={tone(cur.s >= 2 ? cur.s : 0)}>S{cur.s} radiation</Tag>
          <Tag tone={tone(cur.g)}>G{cur.g} geomagnetic</Tag>
          {data.kp && (
            <span className="text-wt-fg-muted">
              Kp {data.kp.latest} (24 h max {data.kp.max24h})
            </span>
          )}
        </div>
        {data.forecast.length > 0 && (
          <table className="w-full tabular-nums">
            <caption className="text-left text-wt-fg-dim">NOAA three-day outlook</caption>
            <thead className="text-wt-fg-dim">
              <tr>
                <th className="text-left font-normal">Day</th>
                <th className="text-right font-normal" title="Probability of minor (R1–R2) / major (R3+) radio blackouts">Radio R1+ / R3+</th>
                <th className="text-right font-normal" title="Probability of a solar radiation storm (S1+)">Radiation S1+</th>
                <th className="text-right font-normal">Geomagnetic</th>
              </tr>
            </thead>
            <tbody>
              {data.forecast.map((d) => (
                <tr key={d.date}>
                  <td>{d.date}</td>
                  <td className="text-right">
                    {d.rMinor ?? '—'}% / {d.rMajor ?? '—'}%
                  </td>
                  <td className="text-right">{d.s ?? '—'}%</td>
                  <td className="text-right">G{d.g ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div>
          <h3 className="text-wt-fg-dim">CMES HEADING FOR EARTH (NASA WSA-ENLIL MODEL)</h3>
          {data.arrivals.length === 0 ? (
            <p className="text-wt-fg-muted">None predicted. {data.cmes7d} CMEs measured in 7 days{data.fastest7d ? `, fastest ${data.fastest7d} km/s` : ''}; most miss Earth.</p>
          ) : (
            <ul className="divide-y divide-wt-line">
              {data.arrivals.map((a) => {
                const url = safeExternalUrl(a.url);
                const past = Date.parse(a.arrival) < now;
                return (
                  <li key={a.cmeId} className="flex flex-wrap items-center gap-x-2 py-0.5">
                    <span className="tabular-nums text-wt-fg">{fmt(a.arrival)}</span>
                    <Tag tone={a.kpHigh !== null && gFromKp(a.kpHigh) >= 2 ? 'crit' : 'warn'}>{past ? 'DUE (±7 h)' : a.glancing ? 'GLANCING' : 'DIRECT'}</Tag>
                    <span className="text-wt-fg-muted">
                      {a.kpLow !== null ? `Kp ${a.kpLow === a.kpHigh ? a.kpLow : `${a.kpLow}–${a.kpHigh}`}` : 'Kp not modelled'}
                      {a.speed ? ` · ${a.speed} km/s` : ''}
                      {a.start ? ` · left the Sun ${fmt(a.start)}` : ''}
                    </span>
                    {url && (
                      <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="text-wt-info underline" aria-label={`NASA model run for the CME arriving ${fmt(a.arrival)}`}>
                        model <ExternalLink size={9} className="inline" aria-hidden />
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {data.messages.length > 0 && (
          <div>
            <h3 className="text-wt-fg-dim">NOAA WATCHES, WARNINGS AND ALERTS (72 H)</h3>
            <ul>
              {data.messages.map((m) => (
                <li key={`${m.code}-${m.serial}`}>
                  <span className="tabular-nums text-wt-fg-dim">{fmt(m.issued)}</span> {m.headline}
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-wt-fg-dim">
          NASA DONKI and NOAA SWPC (US government), updated {formatAge(data.fetchedAt, now)} ago. Arrival times are model predictions, usually within about ±7 hours; storm strength is known only on arrival.
        </p>
      </div>
    </Panel>
  );
}
