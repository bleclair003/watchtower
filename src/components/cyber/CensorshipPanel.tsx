import { CENSOR_TARGETS, type CensorshipSnapshot, type CensorStatus } from '@shared/domain/censorship';
import { formatAge } from '../../lib/time';
import { Panel } from '../ui/Panel';
import { Tag } from '../ui/Tag';

const CELL: Record<CensorStatus, string> = {
  // Light text on the red tint (red on red fails the contrast check).
  blocked: 'bg-wt-crit/25 text-wt-fg',
  partial: 'bg-wt-warn/20 text-wt-warn',
  ok: 'text-wt-fg-muted',
  'no-data': 'text-wt-fg-dim',
};
const LABEL: Record<CensorStatus, string> = { blocked: 'blocked', partial: 'partial', ok: 'ok', 'no-data': '—' };

/** Censorship grid: countries × apps and sites, from OONI measurements (last 2 days). */
export function CensorshipPanel({ data, now }: { data: CensorshipSnapshot | null; now: number }) {
  if (!data || data.countries.length === 0) return null;
  const countries = [...data.countries].sort((a, b) => a.name.localeCompare(b.name));
  const newCount = countries.reduce((a, c) => a + c.targets.filter((t) => t.isNew).length, 0);
  return (
    <Panel title={`Internet censorship (${countries.length} countries)`} designator="C5" actions={data.simulated ? <Tag tone="warn">SIMULATED</Tag> : newCount ? <Tag tone="crit">{newCount} NEW</Tag> : undefined}>
      <p className="border-b border-wt-line px-2 py-1 text-2xs text-wt-fg-dim">
        Share of OONI volunteer tests that failed (anomalous or a confirmed block page) in the last 2 days: blocked 50%+, partial 20–50%. A NEW tag means clearly worse than the 14 days before. Network faults can also cause failures. Data: OONI, CC BY-NC-SA 4.0.
      </p>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Censorship by country and service">
        <table className="w-full text-2xs">
          <thead className="text-wt-fg-dim">
            <tr className="border-b border-wt-line">
              <th className="px-2 py-1 text-left font-normal">Country</th>
              {CENSOR_TARGETS.map((t) => (
                <th key={t.id} className="px-1 py-1 text-center font-normal">
                  {t.label}
                </th>
              ))}
              <th className="px-2 py-1 text-right font-normal">Read</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-wt-line">
            {countries.map((c) => (
              <tr key={c.cc}>
                <td className="px-2 py-0.5 whitespace-nowrap text-wt-fg">
                  <a href={`https://explorer.ooni.org/country/${c.cc}`} target="_blank" rel="noopener noreferrer nofollow" className="hover:underline">
                    {c.name}
                  </a>
                </td>
                {CENSOR_TARGETS.map((t) => {
                  const r = c.targets.find((x) => x.id === t.id);
                  const st: CensorStatus = r?.status ?? 'no-data';
                  return (
                    <td key={t.id} className={`px-1 py-0.5 text-center tabular-nums ${CELL[st]}`} title={r ? `${r.tests} tests in 2 days; failed ${r.share === null ? '—' : `${Math.round(r.share * 100)}%`} (14 days before: ${r.priorShare === null ? '—' : `${Math.round(r.priorShare * 100)}%`})` : 'not measured'}>
                      {LABEL[st]}
                      {r?.isNew && <span className="ml-0.5 font-bold text-wt-fg">NEW</span>}
                    </td>
                  );
                })}
                <td className="px-2 py-0.5 text-right whitespace-nowrap text-wt-fg-dim">{formatAge(c.fetchedAt, now)} ago</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
