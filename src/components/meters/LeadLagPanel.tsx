import type { LeadLagResult } from '@shared/domain/meters/types';
import { Panel } from '../ui/Panel';

/** Signal Lab: which meters rose before RAI rises (tallies from the collector's long meter history). */
export function LeadLagPanel({ result }: { result: LeadLagResult | null }) {
  const enough = !!result && result.rows.some((r) => r.rises >= result.minRises);
  return (
    <Panel title="Lead/lag lab — meters before RAI rises" designator="LL" id="lead-lag">
      <div className="space-y-1.5 px-3 py-2 text-2xs">
        <p className="text-wt-fg-muted">
          For each RAI rise (+10 or more within 24 hours in a region), each meter is checked: did it rise in the 72 hours before (LED), only in the 24 hours after (FOLLOWED), or neither (FLAT)? This shows association in WATCHTOWER’s own data, not cause.
        </p>
        {!result ? (
          <p className="text-wt-fg-dim">Not computed yet: the collector builds the meter history from its next run.</p>
        ) : (
          <>
            <p className={enough ? 'text-wt-fg' : 'text-wt-warn'}>{result.note}</p>
            {result.rows.length > 0 && (
              <table className="w-full" aria-label="Lead/lag tallies">
                <thead className="text-wt-fg-dim">
                  <tr>
                    <th className="py-0.5 text-left font-normal">METER</th>
                    <th className="py-0.5 text-right font-normal">RISES</th>
                    <th className="py-0.5 text-right font-normal">LED</th>
                    <th className="py-0.5 text-right font-normal">FOLLOWED</th>
                    <th className="py-0.5 text-right font-normal">FLAT</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-wt-line">
                  {result.rows.map((r) => (
                    <tr key={r.meterKind}>
                      <td className="py-0.5">{r.meterKind}</td>
                      <td className="py-0.5 text-right tabular-nums">{r.rises}</td>
                      <td className={`py-0.5 text-right tabular-nums ${enough && r.rises >= result.minRises && r.led / r.rises >= 0.5 ? 'text-wt-warn' : ''}`}>{r.led}</td>
                      <td className="py-0.5 text-right tabular-nums">{r.followed}</td>
                      <td className="py-0.5 text-right tabular-nums">{r.flat}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="text-wt-fg-dim">History: {result.historyDays} days, one point every 3 hours (kept 120 days).</p>
          </>
        )}
      </div>
    </Panel>
  );
}
