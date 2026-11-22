import { useMemo } from 'react';
import { ExternalLink } from 'lucide-react';
import { SECTORS, sectorName, type UkraineFrontSnapshot } from '@shared/domain/ukraineFront';
import { interceptRate } from '@shared/domain/airAttacks';
import { formatAge } from '../../lib/time';
import { safeExternalUrl } from '../../lib/sanitize';
import { Panel } from '../ui/Panel';
import { Tag } from '../ui/Tag';
import { Sparkline } from '../meters/MeterCard';

const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Ukraine front: General Staff daily activity per sector, trends, and territorial claims in headlines. */
export function UkraineFrontPanel({ data, now }: { data: UkraineFrontSnapshot | null; now: number }) {
  const full = useMemo(() => (data?.reports ?? []).filter((r) => r.fullDay && r.total !== null), [data]);
  const latest = full[0] ?? null;
  const prior = full.slice(1, 8);
  const rows = useMemo(() => {
    if (!latest) return [];
    return SECTORS.map((s) => {
      const n = latest.sectors[s.id] ?? 0;
      const avg = prior.length ? prior.reduce((a, r) => a + (r.sectors[s.id] ?? 0), 0) / prior.length : null;
      return { id: s.id, n, avg, quiet: latest.quiet.includes(s.id), places: latest.places[s.id] ?? [], series: [...full].reverse().slice(-14).map((r) => ({ t: Date.parse(`${r.day}T12:00:00Z`), v: r.sectors[s.id] ?? 0 })) };
    })
      .filter((r) => r.n > 0 || (r.avg ?? 0) > 0)
      .sort((a, b) => b.n - a.n);
  }, [latest, prior, full]);
  if (!data) return null;
  const totals = [...full].reverse().slice(-21).map((r) => ({ t: Date.parse(`${r.day}T12:00:00Z`), v: r.total ?? 0 }));
  const today = data.today;
  return (
    <Panel title="Ukraine front" designator="UA" actions={data.simulated ? <Tag tone="warn">SIMULATED</Tag> : undefined}>
      <div className="space-y-1.5 px-2 py-1.5 text-2xs">
        {latest ? (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-wt-fg">
                <span className="text-sm tabular-nums">{latest.total}</span> combat engagements on {fmtDay(latest.day)}
              </span>
              <span className="text-wt-fg-muted tabular-nums">
                {[
                  latest.airstrikes !== null && `${latest.airstrikes} airstrikes`,
                  latest.guidedBombs !== null && `${latest.guidedBombs} guided bombs`,
                  latest.kamikazeDrones !== null && `${latest.kamikazeDrones.toLocaleString('en-US')} kamikaze drones`,
                  latest.shelling !== null && `${latest.shelling.toLocaleString('en-US')} shelling attacks`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              <Sparkline points={totals} width={120} height={22} emptyText="" />
            </div>
            {today && today.day > latest.day && (
              <p className="text-wt-fg-muted">
                Today so far ({formatAge(today.asOf, now)} ago): {today.total ?? '?'} engagements
                {Object.keys(today.sectors).length > 0 &&
                  `, most in ${Object.entries(today.sectors)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 2)
                    .map(([s, n]) => `${sectorName(s)} ${n}`)
                    .join(', ')}`}
                .
              </p>
            )}
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Activity by sector">
              <table className="w-full">
                <thead className="text-wt-fg-dim">
                  <tr className="border-b border-wt-line">
                    <th className="py-0.5 pr-2 text-left font-normal">Sector</th>
                    <th className="py-0.5 pr-2 text-right font-normal" title="Attacks or engagements on the latest full day">
                      {fmtDay(latest.day)}
                    </th>
                    <th className="py-0.5 pr-2 text-right font-normal" title="Mean of the 7 days before">
                      7-day avg
                    </th>
                    <th className="py-0.5 pr-2 text-left font-normal">14 days</th>
                    <th className="py-0.5 text-left font-normal">Settlements named</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-wt-line">
                  {rows.map((r) => {
                    const hot = r.avg !== null && r.n >= 5 && r.n >= 1.5 * r.avg;
                    return (
                      <tr key={r.id}>
                        <td className="py-0.5 pr-2 whitespace-nowrap text-wt-fg">{sectorName(r.id)}</td>
                        <td className={`py-0.5 pr-2 text-right tabular-nums ${hot ? 'text-wt-warn' : ''}`}>{r.quiet ? 'quiet' : r.n}</td>
                        <td className="py-0.5 pr-2 text-right tabular-nums text-wt-fg-muted">{r.avg === null ? '—' : r.avg.toFixed(1)}</td>
                        <td className="py-0.5 pr-2">
                          <Sparkline points={r.series} width={64} height={14} emptyText="" />
                        </td>
                        <td className="py-0.5 text-wt-fg-dim">{r.places.join(', ')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {latest.quiet.length > 0 && <p className="text-wt-fg-dim">No Russian offensive action reported in: {latest.quiet.map(sectorName).join(', ')}.</p>}
          </>
        ) : (
          <p className="text-wt-fg-muted">No General Staff report read yet; the first runs fill in the last two weeks.</p>
        )}

        {(data.air?.length ?? 0) > 0 && (
          <div>
            <h3 className="text-wt-fg-dim">OVERNIGHT AIR ATTACKS (UKRAINIAN AIR FORCE)</h3>
            {(() => {
              const nights = data.air!;
              const last = nights[0];
              const rate = interceptRate(last);
              const trend = [...nights].reverse().slice(-21).map((r) => ({ t: Date.parse(`${r.day}T06:00:00Z`), v: (r.drones ?? 0) + (r.missiles ?? 0) }));
              return (
                <>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-wt-fg">
                      Night to {fmtDay(last.day)}: <span className="text-sm tabular-nums">{last.drones ?? '?'}</span> drones,{' '}
                      <span className={`text-sm tabular-nums ${(last.missiles ?? 0) >= 40 ? 'text-wt-warn' : ''}`}>{last.missiles ?? 0}</span> missiles
                      {last.ballistic ? ` (${last.ballistic} ballistic)` : ''}
                    </span>
                    <span className="text-wt-fg-muted tabular-nums">
                      {rate !== null && `${Math.round(rate * 100)}% shot down or suppressed`}
                      {last.hitLocations !== null && ` · hits at ${last.hitLocations} locations`}
                    </span>
                    <Sparkline points={trend} width={120} height={22} emptyText="" />
                  </div>
                  <table className="mt-1 w-full tabular-nums">
                    <thead className="text-wt-fg-dim">
                      <tr className="border-b border-wt-line">
                        <th className="py-0.5 pr-2 text-left font-normal">Night to</th>
                        <th className="py-0.5 pr-2 text-right font-normal">Drones</th>
                        <th className="py-0.5 pr-2 text-right font-normal">Missiles</th>
                        <th className="py-0.5 pr-2 text-right font-normal">Down</th>
                        <th className="py-0.5 text-right font-normal">Hit locations</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-wt-line">
                      {nights.slice(0, 7).map((r) => {
                        const rr = interceptRate(r);
                        return (
                          <tr key={r.day}>
                            <td className="py-0.5 pr-2">
                              <a href={safeExternalUrl(r.url) ?? undefined} target="_blank" rel="noopener noreferrer nofollow" className="hover:underline">
                                {fmtDay(r.day)}
                              </a>
                            </td>
                            <td className="py-0.5 pr-2 text-right">{r.drones ?? '—'}</td>
                            <td className="py-0.5 pr-2 text-right">{r.missiles ?? '—'}</td>
                            <td className="py-0.5 pr-2 text-right text-wt-fg-muted">{rr === null ? '—' : `${Math.round(rr * 100)}%`}</td>
                            <td className="py-0.5 text-right text-wt-fg-muted">{r.hitLocations ?? '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </>
              );
            })()}
          </div>
        )}

        <div>
          <h3 className="text-wt-fg-dim">TERRITORIAL CLAIMS IN HEADLINES (14 DAYS)</h3>
          {data.claims.length === 0 ? (
            <p className="text-wt-fg-muted">No headline in the feeds claimed a settlement captured or retaken.</p>
          ) : (
            <ul className="divide-y divide-wt-line">
              {data.claims.map((c) => {
                const url = safeExternalUrl(c.url);
                return (
                  <li key={`${c.side}-${c.place}-${c.at}`} className="flex flex-wrap items-start gap-x-2 py-0.5">
                    <span className="w-14 shrink-0 tabular-nums text-wt-fg-dim">{formatAge(c.at, now)} ago</span>
                    <Tag tone={c.side === 'russia' ? 'crit' : 'info'}>{c.side === 'russia' ? 'Russian claim' : 'Ukrainian claim'}</Tag>
                    <span className="text-wt-fg">{c.place}</span>
                    <span className="min-w-0 basis-full text-wt-fg-muted sm:basis-0 sm:flex-1">
                      {url ? (
                        <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="hover:underline">
                          {c.title} <ExternalLink size={9} className="inline" aria-hidden />
                        </a>
                      ) : (
                        c.title
                      )}{' '}
                      · {c.source}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <p className="text-wt-fg-dim">
          Activity figures are Ukraine’s General Staff’s (one side), read from Ukrinform’s English reports; per-sector counts are parsed from text and approximate. Claims are taken from headlines and are not verified. Front-line map:{' '}
          <a href="https://deepstatemap.live/" target="_blank" rel="noopener noreferrer nofollow" className="text-wt-info underline">
            DeepStateMap.live
          </a>{' '}
          (opens their site; lines on this map need an API key, requested).
        </p>
      </div>
    </Panel>
  );
}
