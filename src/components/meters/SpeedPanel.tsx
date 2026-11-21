import type { SpeedReport } from '@shared/domain/speed';
import { Panel } from '../ui/Panel';

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
const signed = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x)}`;

/** Who's first: outlets within shared stories, and sensors/official sources against the news. */
export function SpeedPanel({ report }: { report: SpeedReport | null | undefined }) {
  if (!report) return null;
  return (
    <Panel title={`Who's first — last ${report.windowDays} days`} designator="M8">
      <div className="space-y-2 px-2 py-1.5 text-2xs">
        <div>
          <h3 className="text-wt-fg-dim">NEWS OUTLETS — {report.storiesCompared} STORIES CARRIED BY 2+ PUBLISHERS</h3>
          {report.outlets.length === 0 ? (
            <p className="text-wt-fg-dim">No story carried by two or more publishers yet.</p>
          ) : (
            <table className="w-full" aria-label="Outlet speed">
              <thead className="text-wt-fg-dim">
                <tr>
                  <th className="py-0.5 text-left font-normal">PUBLISHER</th>
                  <th className="py-0.5 text-right font-normal">STORIES</th>
                  <th className="py-0.5 text-right font-normal">FIRST</th>
                  <th className="py-0.5 text-right font-normal" title="Median hours behind the first report, when not first">DELAY</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-wt-line">
                {report.outlets.map((o) => (
                  <tr key={o.sourceId}>
                    <td className="py-0.5">{o.name}</td>
                    <td className="py-0.5 text-right tabular-nums">{o.stories}</td>
                    <td className="py-0.5 text-right tabular-nums">
                      {o.first} ({pct(o.first, o.stories)})
                    </td>
                    <td className="py-0.5 text-right tabular-nums">{o.medianLagHours === null ? '—' : `${o.medianLagHours} h`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div>
          <h3 className="text-wt-fg-dim">SENSORS AND OFFICIAL SOURCES AGAINST THE NEWS</h3>
          <table className="w-full" aria-label="Source lead over news">
            <thead className="text-wt-fg-dim">
              <tr>
                <th className="py-0.5 text-left font-normal">KIND OF EVENT</th>
                <th className="py-0.5 text-right font-normal">RECORDS</th>
                <th className="py-0.5 text-right font-normal" title="Records paired with a news report on the same country within 48 hours">PAIRED</th>
                <th className="py-0.5 text-right font-normal">SOURCE FIRST</th>
                <th className="py-0.5 text-right font-normal" title="Median lead over the news; negative = the news was first">LEAD</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-wt-line">
              {report.kinds.map((k) => (
                <tr key={k.id} title={k.examples.map((x) => `${signed(x.lead)} ${k.unit}: ${x.source} → ${x.news}`).join('\n') || undefined}>
                  <td className="py-0.5">{k.label}</td>
                  <td className="py-0.5 text-right tabular-nums">{k.records}</td>
                  <td className="py-0.5 text-right tabular-nums">{k.paired}</td>
                  <td className="py-0.5 text-right tabular-nums">{k.paired ? pct(k.sourceFirst, k.paired) : '—'}</td>
                  <td className="py-0.5 text-right tabular-nums">{k.medianLead === null ? '—' : `${signed(k.medianLead)} ${k.unit === 'hours' ? 'h' : 'd'}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-wt-fg-dim">
          Times are feed publication times, and collection runs every 30 minutes, so differences under an hour are noise. Sources that give only a date (Yonhap days, WHO, sanctions lists, US advisories) are compared in whole days. A record and a news report are paired by kind of event and country within 48 hours, so pairs can be coincidences.
        </p>
      </div>
    </Panel>
  );
}
