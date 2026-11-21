import { useMemo } from 'react';
import { ExternalLink } from 'lucide-react';
import type { Meter, MeterLevel, MetersSnapshot } from '@shared/domain/meters/types';
import { unpackValues } from '@shared/domain/meters/history';
import type { Tone } from '../../config/categories';
import { formatAge } from '../../lib/time';
import { safeExternalUrl } from '../../lib/sanitize';
import { Tag } from '../ui/Tag';

export const LEVEL_TONE: Record<string, Tone> = { '0': 'ok', '1': 'muted', '2': 'info', '3': 'warn', '4': 'crit', null: 'inactive' };
export const levelTone = (l: MeterLevel) => LEVEL_TONE[String(l)];

/** Compact text for table cells. */
export function cellLabel(m: Meter): string {
  if (m.kind === 'escalation') return m.label.replace('RUNG ', 'R').replace(' · ', ' ');
  if (m.kind === 'corroboration' || m.kind === 'visibility') return m.value === null ? '—' : `${m.value}%`;
  if (m.kind === 'language') return m.value === null ? '—' : `${m.value > 0 ? '+' : m.value < 0 ? '−' : '±'}${Math.abs(m.value)}°`;
  if (m.baseline === 'building' && m.level === null) return m.kind === 'air-surge' ? `${m.value ?? 0}/72H` : 'BUILDING';
  return m.label;
}

/** Values of one meter across the recent runs, oldest first. */
export function meterSeries(history: MetersSnapshot['history'], id: string): { t: number; v: number }[] {
  return history.flatMap((p) => {
    const v = unpackValues(p.packed)[id];
    return v === undefined ? [] : [{ t: Date.parse(p.at), v }];
  });
}

/** Minimal line of a meter's recent values (no axes; the card states the current reading). */
export function Sparkline({ points, width = 160, height = 28, emptyText = 'History builds with each run.' }: { points: { t: number; v: number }[]; width?: number; height?: number; emptyText?: string }) {
  if (points.length < 2) return emptyText ? <span className="text-2xs text-wt-fg-dim">{emptyText}</span> : <span style={{ width }} className="inline-block" aria-hidden />;
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const vs = points.map((p) => p.v);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const x = (t: number) => (t1 === t0 ? 0 : ((t - t0) / (t1 - t0)) * (width - 4) + 2);
  const y = (v: number) => (hi === lo ? height / 2 : height - 3 - ((v - lo) / (hi - lo)) * (height - 6));
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  return (
    <svg width={width} height={height} role="img" aria-label={`Recent values from ${lo} to ${hi}; now ${last.v}`} className="text-wt-fg-muted">
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.t)} cy={y(last.v)} r={2.5} className="fill-wt-fg" />
    </svg>
  );
}

/** Full meter: reading, parts, evidence, limits and recent history. */
export function MeterCard({ meter: m, history, now, simulated }: { meter: Meter; history: MetersSnapshot['history']; now: number; simulated?: boolean }) {
  const series = useMemo(() => meterSeries(history, m.id), [history, m.id]);
  return (
    <article aria-label={m.name} className="space-y-1.5 text-2xs">
      <header className="flex flex-wrap items-center gap-1.5">
        <h3 className="text-xs tracking-wider text-wt-fg">{m.name.toUpperCase()}</h3>
        <Tag tone={levelTone(m.level)}>{m.label}</Tag>
        {m.baseline === 'building' && <Tag tone="inactive" title="The usual level needs more stored history before comparisons are made">BASELINE BUILDING</Tag>}
        {simulated && <Tag tone="warn">SIMULATED</Tag>}
      </header>
      <p className="text-wt-fg">{m.reading}</p>
      <div className="flex items-center gap-2">
        <Sparkline points={series} />
        <span className="text-wt-fg-dim">{m.asOf ? `data as of ${formatAge(m.asOf, now)} ago` : 'no dated data'}</span>
      </div>
      {m.components.length > 0 && (
        <table className="w-full">
          <tbody className="divide-y divide-wt-line">
            {m.components.map((c, i) => (
              <tr key={`${c.label}-${i}`}>
                <td className={`py-0.5 pr-2 ${c.active ? 'text-wt-warn' : 'text-wt-fg-muted'}`}>
                  {c.active ? '● ' : '○ '}
                  {c.label}
                </td>
                <td className="py-0.5 text-right tabular-nums">
                  {c.value}
                  {c.note && <span className="block text-wt-fg-dim">{c.note}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {m.evidence.length > 0 && (
        <div>
          <h4 className="text-wt-fg-dim">EVIDENCE</h4>
          <ul className="space-y-0.5">
            {m.evidence.map((e, i) => {
              const url = e.url ? safeExternalUrl(e.url) : null;
              return (
                <li key={`${e.title}-${i}`} className="flex gap-1.5">
                  <span className="min-w-0 flex-1">
                    {url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="hover:underline">
                        {e.title} <ExternalLink size={9} className="inline" aria-hidden />
                      </a>
                    ) : (
                      e.title
                    )}
                    {e.why && <span className="text-wt-fg-dim"> · {e.why}</span>}
                  </span>
                  {e.at && <span className="shrink-0 tabular-nums text-wt-fg-dim">{formatAge(e.at, now)}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {m.notes.map((n) => (
        <p key={n} className="text-wt-fg-dim">
          {n}
        </p>
      ))}
    </article>
  );
}
