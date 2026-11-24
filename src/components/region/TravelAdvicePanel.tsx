import { GOVERNMENT_LABEL, JOINT_WINDOW_HOURS, type GovernmentAdvice, type TravelAdviceSnapshot } from '@shared/domain/travelAdvice';
import { getRegion } from '@shared/domain/regions';
import { countryName } from '../../lib/regionSummary';
import { formatAge, formatUtc } from '../../lib/time';
import { safeExternalUrl } from '../../lib/sanitize';
import { Panel } from '../ui/Panel';
import { Tag } from '../ui/Tag';

/** Higher = more severe: US 1–4, Canada 0–3 (shifted to 1–4). */
const tone = (sev: number) => (sev >= 4 ? 'text-wt-crit' : sev === 3 ? 'text-wt-warn' : 'text-wt-fg');

function Cell({ a, sev, now }: { a?: GovernmentAdvice; sev: number | null; now: number }) {
  if (!a) return <td className="px-2 py-1 text-wt-fg-dim">—</td>;
  const url = a.url ? safeExternalUrl(a.url) : null;
  const text = <span className={sev === null ? '' : tone(sev)}>{a.label || '—'}</span>;
  return (
    <td className="px-2 py-1 align-top">
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="hover:underline">
          {text}
        </a>
      ) : (
        text
      )}
      {a.at && <p className="text-wt-fg-dim tabular-nums">{formatAge(a.at, now)} ago</p>}
    </td>
  );
}

/**
 * Travel advice by government for a region's countries (v0.83.0): US State Department, Canada, UK FCDO
 * (no levels: its latest change note) and CDC health notices; joint raises flagged above the table.
 */
export function TravelAdvicePanel({ data, regionId, now }: { data: TravelAdviceSnapshot | null; regionId: string; now: number }) {
  const region = getRegion(regionId);
  if (!data || !region) return null;
  const rows = data.countries.filter((c) => region.countryCodes.includes(c.country));
  const joint = data.joint.filter((j) => region.countryCodes.includes(j.country));
  if (!rows.length && !joint.length) return null;
  return (
    <Panel title="Travel advice by government" designator="TA" actions={data.simulated ? <Tag tone="warn">SIMULATED</Tag> : undefined}>
      <p className="border-b border-wt-line px-2 py-1 text-2xs text-wt-fg-dim">
        Each government’s latest advice for the region’s countries. A raise by two or more within {JOINT_WINDOW_HOURS} hours is a JOINT RAISE: governments act on information
        they often cannot publish, but they also share it, so it is agreement, not independent proof. The UK publishes no levels: its latest change note is shown. Canada:
        Open Government Licence – Canada. Built {formatAge(data.generatedAt, now)} ago.
      </p>
      {joint.length > 0 && (
        <ul aria-label="Joint raises" className="border-b border-wt-line px-2 py-1 text-2xs">
          {joint.map((j) => (
            <li key={`${j.country}-${j.first}`} className="flex flex-wrap items-baseline gap-x-2 py-0.5">
              <Tag tone={j.level === 'strong' ? 'crit' : 'warn'}>JOINT RAISE</Tag>
              <span>
                {countryName(j.country)}: {j.governments.map((g) => GOVERNMENT_LABEL[g] ?? g).join(', ')}
              </span>
              <span className="text-wt-fg-dim tabular-nums">
                {formatUtc(j.first)} to {formatUtc(j.last)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 0 && (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Travel advice by country">
          <table className="w-full text-2xs">
            <thead className="text-wt-fg-dim">
              <tr className="border-b border-wt-line">
                <th className="px-2 py-1 text-left font-normal">Country</th>
                <th className="px-2 py-1 text-left font-normal">United States</th>
                <th className="px-2 py-1 text-left font-normal">Canada</th>
                <th className="px-2 py-1 text-left font-normal">United Kingdom</th>
                <th className="px-2 py-1 text-left font-normal">CDC health</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.country} className="border-b border-wt-line last:border-0">
                  <td className="px-2 py-1 align-top">{countryName(r.country)}</td>
                  <Cell a={r.us} sev={r.us?.level ?? null} now={now} />
                  <Cell a={r.ca} sev={r.ca ? (r.ca.level ?? 0) + 1 : null} now={now} />
                  <Cell a={r.uk} sev={null} now={now} />
                  <td className="px-2 py-1 align-top">
                    {r.cdc?.length
                      ? r.cdc.map((n) => {
                          const url = safeExternalUrl(n.url);
                          return (
                            <p key={n.url}>
                              {url ? (
                                <a href={url} target="_blank" rel="noopener noreferrer" className={`hover:underline ${tone(n.level)}`}>
                                  {n.title}
                                </a>
                              ) : (
                                n.title
                              )}
                            </p>
                          );
                        })
                      : <span className="text-wt-fg-dim">—</span>}
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
