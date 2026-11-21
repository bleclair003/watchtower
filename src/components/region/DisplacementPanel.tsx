import { figureChange, type DisplacementSnapshot } from '@shared/domain/displacement';
import { countryName } from '../../lib/regionSummary';
import { Panel } from '../ui/Panel';

const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : n > 0 ? String(n) : '—');

function Change({ now, before }: { now: number; before: number | undefined }) {
  const c = figureChange(now, before);
  if (c === null || Math.abs(c) < 0.05) return null;
  return <span className={`ml-1 ${c > 0 ? 'text-wt-warn' : 'text-wt-fg-dim'}`}>{c > 0 ? '▲' : '▼'}{Math.abs(c * 100) >= 100 ? `${(c + 1).toFixed(1)}×` : `${Math.round(Math.abs(c) * 100)}%`}</span>;
}

/** UNHCR displacement figures for a region's countries (context, not alerts). */
export function DisplacementPanel({ countries, data }: { countries: string[]; data: DisplacementSnapshot | null }) {
  const rows = data ? countries.flatMap((c) => data.rows.filter((r) => r.country === c)) : [];
  const shown = rows.filter((r) => r.latest.refugeesAbroad + r.latest.asylumSeekersAbroad + r.latest.idps + r.latest.refugeesHosted + r.latest.asylumSeekersHosted >= 1000);
  const missing = countries.filter((c) => !rows.some((r) => r.country === c));
  return (
    <Panel title={`Displacement — UNHCR ${data ? data.year : ''}`} designator="R5b">
      {!data ? (
        <p className="px-2 py-1.5 text-2xs text-wt-fg-dim">No UNHCR figures loaded yet.</p>
      ) : (
        <>
          <table className="w-full text-2xs" aria-label="Displacement figures">
            <thead className="text-wt-fg-dim">
              <tr>
                <th className="px-2 py-0.5 text-left font-normal">Country</th>
                <th className="px-1 py-0.5 text-right font-normal" title="Refugees and asylum seekers from the country, living abroad">Fled abroad</th>
                <th className="px-1 py-0.5 text-right font-normal" title="Internally displaced people">IDPs</th>
                <th className="px-2 py-0.5 text-right font-normal" title="Refugees and asylum seekers hosted in the country">Hosted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-wt-line">
              {shown.map(({ country, latest: l, previous: p }) => (
                <tr key={country}>
                  <td className="px-2 py-0.5">{countryName(country)}</td>
                  <td className="px-1 py-0.5 text-right tabular-nums">
                    {fmt(l.refugeesAbroad + l.asylumSeekersAbroad)}
                    <Change now={l.refugeesAbroad + l.asylumSeekersAbroad} before={p ? p.refugeesAbroad + p.asylumSeekersAbroad : undefined} />
                  </td>
                  <td className="px-1 py-0.5 text-right tabular-nums">
                    {fmt(l.idps)}
                    <Change now={l.idps} before={p?.idps} />
                  </td>
                  <td className="px-2 py-0.5 text-right tabular-nums">
                    {fmt(l.refugeesHosted + l.asylumSeekersHosted)}
                    <Change now={l.refugeesHosted + l.asylumSeekersHosted} before={p ? p.refugeesHosted + p.asylumSeekersHosted : undefined} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-2 py-1 text-2xs text-wt-fg-dim">
            {data.simulated ? 'SIMULATED figures (demo mode). ' : ''}
            Change against {data.previousYear} shown when 5% or more. {data.year} figures are mid-year until UNHCR's annual release; IDP figures largely from IDMC.
            {rows.length > shown.length ? ` ${rows.length - shown.length} countr${rows.length - shown.length === 1 ? 'y' : 'ies'} under 1,000 people omitted.` : ''}
            {missing.length ? ` No UNHCR figures: ${missing.map(countryName).join(', ')}.` : ''}{' '}
            <a href="https://www.unhcr.org/refugee-statistics/download" target="_blank" rel="noreferrer" className="underline hover:text-wt-fg">Source: UNHCR Refugee Data Finder</a>
          </p>
        </>
      )}
    </Panel>
  );
}
