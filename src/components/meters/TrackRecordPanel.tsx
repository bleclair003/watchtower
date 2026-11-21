import type { TrackRecordReport } from '@shared/domain/trackRecord';
import { Panel } from '../ui/Panel';

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');

/** How often each source's leading reports were carried by another publisher within 48 hours. */
export function TrackRecordPanel({ report }: { report: TrackRecordReport | null | undefined }) {
  if (!report) return null;
  const rows = report.sources.filter((s) => s.leading + s.pending > 0);
  return (
    <Panel title="Source track record" designator="M9">
      <div className="space-y-1.5 px-2 py-1.5 text-2xs">
        {rows.length === 0 ? (
          <p className="text-wt-fg-dim">No reports to judge yet.</p>
        ) : (
          <table className="w-full" aria-label="Source track record">
            <thead className="text-wt-fg-dim">
              <tr>
                <th className="py-0.5 text-left font-normal">PUBLISHER</th>
                <th className="py-0.5 text-right font-normal" title="Reports no other publisher had carried first, old enough to judge">LEADING</th>
                <th className="py-0.5 text-right font-normal" title="Carried by another publisher within 48 hours">CONFIRMED</th>
                <th className="py-0.5 text-right font-normal" title="Strike and attack headlines among them">STRIKES</th>
                <th className="py-0.5 text-right font-normal" title="Median hours until another publisher carried it">HOURS</th>
                <th className="py-0.5 text-right font-normal" title="Leading reports under 48 hours old">PENDING</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-wt-line">
              {rows.map((s) => (
                <tr key={s.sourceId}>
                  <td className="py-0.5">{s.publisher}</td>
                  <td className="py-0.5 text-right tabular-nums">{s.leading}</td>
                  <td className="py-0.5 text-right tabular-nums">
                    {s.confirmed} ({pct(s.confirmed, s.leading)})
                  </td>
                  <td className="py-0.5 text-right tabular-nums">{s.strikeLeading ? `${s.strikeConfirmed}/${s.strikeLeading}` : '—'}</td>
                  <td className="py-0.5 text-right tabular-nums">{s.medianHoursToConfirm === null ? '—' : s.medianHoursToConfirm}</td>
                  <td className="py-0.5 text-right tabular-nums text-wt-fg-dim">{s.pending}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-wt-fg-dim">
          A leading report is one no other publisher had carried in the 48 hours before it; it is confirmed when another publisher carries the same story within 48 hours (same story, or 3+ shared content words). Judged from {report.judgedFrom.slice(0, 10)}, over at most {report.windowDays} days.
        </p>
        <p className="text-wt-warn">
          A low rate is not a finding of error. Exclusives, a regional focus, official releases nobody re-reports, and outlets WATCHTOWER does not collect all lower it. It shows how often others picked a report up — nothing about whether it was true.
        </p>
      </div>
    </Panel>
  );
}
