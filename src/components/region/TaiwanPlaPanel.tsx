import { PLA_ABOVE, PLA_BASELINE_DAYS, PLA_LEVEL_LABEL, PLA_MIN_DAYS, PLA_SURGE, type TaiwanPlaSnapshot } from '@shared/domain/taiwanPla';
import { formatAge } from '../../lib/time';
import { Panel } from '../ui/Panel';
import { Tag } from '../ui/Tag';

const W = 300;
const H = 64;

/** Daily aircraft (bars) and ships (line), last 90 published days. */
function Chart({ days }: { days: TaiwanPlaSnapshot['days'] }) {
  const max = Math.max(1, ...days.map((d) => Math.max(d[1] ?? 0, d[3] ?? 0)));
  const bw = W / Math.max(days.length, 1);
  const y = (v: number) => H - 2 - (v / max) * (H - 6);
  const ships = days.map((d, i) => (d[3] === null ? null : `${(i * bw + bw / 2).toFixed(1)},${y(d[3]).toFixed(1)}`)).filter(Boolean).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-16 w-full" preserveAspectRatio="none" aria-hidden>
      {days.map((d, i) => (d[1] ? <rect key={d[0]} x={i * bw + 0.5} y={y(d[1])} width={Math.max(bw - 1, 0.5)} height={H - 2 - y(d[1])} className="fill-wt-fg" opacity={0.55} /> : null))}
      <polyline points={ships} fill="none" stroke="currentColor" strokeWidth={1.2} className="text-wt-info" />
    </svg>
  );
}

/** PLA activity around Taiwan (v0.82.0): Taiwan MND daily counts via Skyfaring's PLA Tracker. */
export function TaiwanPlaPanel({ data, now }: { data: TaiwanPlaSnapshot | null; now: number }) {
  if (!data) return null;
  const l = data.latest;
  const tone = l?.level === 'surge' ? 'crit' : l?.level === 'above' ? 'warn' : 'muted';
  const score = (s: number | null, usual: number | null) => (s === null || usual === null ? `building (${PLA_MIN_DAYS} days needed)` : `usual ${usual} · ${s > 0 ? '+' : ''}${s} spreads`);
  return (
    <Panel title="PLA activity around Taiwan" designator="TW" actions={data.simulated ? <Tag tone="warn">SIMULATED</Tag> : undefined}>
      <p className="border-b border-wt-line px-2 py-1 text-2xs text-wt-fg-dim">
        Chinese military aircraft and ships Taiwan’s Ministry of National Defense counted around Taiwan each day (24 hours to 06:00, UTC+8). Each day is compared with the{' '}
        {PLA_BASELINE_DAYS} days before it: {PLA_ABOVE}+ typical spreads is ABOVE USUAL (often a routine “joint combat readiness patrol”), {PLA_SURGE}+ is a SURGE (large
        exercises). Read from Skyfaring’s PLA Tracker, which transcribes the MND releases (the MND site does not allow automated reading): a secondary source.
      </p>
      {l && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 px-2 py-1.5 text-2xs sm:grid-cols-4" aria-label="Latest day">
          <div>
            <p className="text-wt-fg-dim">LATEST</p>
            <p className="tabular-nums">{l.date}</p>
            <Tag tone={tone}>{PLA_LEVEL_LABEL[l.level]}</Tag>
          </div>
          <div>
            <p className="text-wt-fg-dim">AIRCRAFT</p>
            <p className="text-xs tabular-nums">
              {l.aircraft ?? '—'} {l.crossed !== null && l.aircraft ? <span className="text-2xs text-wt-fg-muted">({l.crossed} crossed the median line)</span> : null}
            </p>
            <p className="text-wt-fg-muted">{score(l.aircraftScore, l.aircraftUsual)}</p>
          </div>
          <div>
            <p className="text-wt-fg-dim">SHIPS</p>
            <p className="text-xs tabular-nums">{l.ships ?? '—'}</p>
            <p className="text-wt-fg-muted">{score(l.shipsScore, l.shipsUsual)}</p>
          </div>
          <div>
            <p className="text-wt-fg-dim">SCALE</p>
            <p className="text-wt-fg-muted">{data.yearMax ? `busiest day in a year: ${data.yearMax.aircraft} aircraft (${data.yearMax.date})` : '—'}</p>
            {l.balloons > 0 && <p className="text-wt-fg-muted">{l.balloons} balloon(s)</p>}
          </div>
        </div>
      )}
      <div className="border-t border-wt-line px-2 py-1">
        <Chart days={data.days} />
        <p className="text-2xs text-wt-fg-dim">
          Last {data.days.length} published days: bars aircraft, line ships. {data.totalDays} days on record since {data.firstDate}. Source: ROC Ministry of National Defense;
          compilation: Skyfaring’s PLA Tracker (pla-tracker.skyfaring.net), CC BY 4.0. Read {formatAge(data.fetchedAt, now)} ago.
        </p>
      </div>
    </Panel>
  );
}
