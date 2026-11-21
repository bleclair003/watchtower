import { useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { CHOKEPOINT_STALE_DAYS, CHOKEPOINT_STATUS_LABEL, type ChokepointReading, type ChokepointSnapshot } from '@shared/domain/chokepoints';
import { getRegion } from '@shared/domain/regions';
import { Tag } from '../ui/Tag';

interface Props {
  item: ChokepointReading;
  snapshot: ChokepointSnapshot;
  now: number;
  onClose: () => void;
}

const TONE = { normal: 'ok', reduced: 'warn', severe: 'crit', 'sudden-drop': 'crit', 'insufficient-data': 'muted' } as const;

/** Daily transits for one chokepoint: trend against the 2025 average, with the status and its limits. */
export function ChokepointCard({ item, snapshot, now, onClose }: Props) {
  const lagDays = item.latestDate ? Math.floor((now - Date.parse(`${item.latestDate}T12:00:00Z`)) / 86_400_000) : null;
  const stale = lagDays !== null && lagDays > CHOKEPOINT_STALE_DAYS;
  const region = item.regionId ? getRegion(item.regionId) : undefined;
  const change = item.mean7 !== null && item.ref2025 ? Math.round((item.mean7 / item.ref2025.total - 1) * 100) : null;
  return (
    <section
      aria-label={`Chokepoint: ${item.name}`}
      className="absolute right-2 bottom-2 z-10 max-h-[calc(100%-1rem)] w-[min(340px,calc(100%-1rem))] overflow-y-auto border border-wt-line-strong bg-wt-panel/95 text-2xs shadow-lg"
    >
      <header className="flex items-start gap-2 border-b border-wt-line px-2 py-1.5">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-wt-fg">
            {item.name} <Tag tone={TONE[item.status]}>{CHOKEPOINT_STATUS_LABEL[item.status]}</Tag> {snapshot.simulated && <Tag tone="warn">SIMULATED</Tag>}
          </p>
          <p className={stale ? 'text-wt-warn' : 'text-wt-fg-muted'}>
            Ship transits a day · data to {item.latestDate ?? '—'}
            {lagDays !== null && ` (${lagDays} d behind)`}
            {region && ` · ${region.shortCode}`}
          </p>
        </div>
        <button onClick={onClose} aria-label="Close chokepoint details" className="text-wt-fg-muted hover:text-wt-fg">
          <X size={12} />
        </button>
      </header>
      <dl className="grid grid-cols-3 gap-x-2 border-b border-wt-line px-2 py-1.5 tabular-nums">
        <div>
          <dt className="text-wt-fg-dim">LAST 7 DAYS</dt>
          <dd className="text-sm text-wt-fg">{item.mean7?.toFixed(1) ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-wt-fg-dim">2025 AVERAGE</dt>
          <dd className="text-sm text-wt-fg">{item.ref2025?.total.toFixed(1) ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-wt-fg-dim">CHANGE</dt>
          <dd className="text-sm text-wt-fg">{change === null ? '—' : `${change > 0 ? '+' : change < 0 ? '−' : ''}${Math.abs(change)}%`}</dd>
        </div>
      </dl>
      <TransitChart series={item.series} reference={item.ref2025?.total ?? null} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 border-t border-wt-line px-2 py-1.5">
        <dt className="text-wt-fg-dim">PREVIOUS 4 WEEKS</dt>
        <dd className="tabular-nums">{item.meanPrior28?.toFixed(1) ?? '—'} a day</dd>
        <dt className="text-wt-fg-dim">TANKERS (2025)</dt>
        <dd className="tabular-nums">{item.ref2025?.tanker.toFixed(1) ?? '—'} a day</dd>
        <dt className="text-wt-fg-dim">SOURCE</dt>
        <dd className="text-wt-fg-muted">
          {snapshot.simulated ? (
            'Simulated demo data'
          ) : (
            <a href="https://portwatch.imf.org/pages/chokepoints" target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-0.5 text-wt-info underline">
              International Monetary Fund, PortWatch <ExternalLink size={9} aria-hidden />
            </a>
          )}
        </dd>
      </dl>
      <p className="border-t border-wt-line px-2 py-1 text-wt-fg-dim">
        Counts of container, bulk, general cargo, ro-ro and tanker transits from satellite and terrestrial AIS (UN Global Platform). Ships with AIS switched off are not counted. Data runs several days behind. The 2025 average was already lowered by the Red Sea crisis for Suez and Bab el-Mandeb.
      </p>
    </section>
  );
}

const W = 320;
const H = 90;
const PAD = { l: 26, r: 6, t: 8, b: 16 };

/** Daily transits (one line) with the 2025 average as a dashed reference; hover shows the day. */
function TransitChart({ series, reference }: { series: ChokepointReading['series']; reference: number | null }) {
  const [hover, setHover] = useState<number | null>(null);
  if (series.length < 2) return <p className="px-2 py-1.5 text-wt-fg-dim">Not enough daily data for a chart.</p>;
  const max = Math.max(...series.map((d) => d[1]), reference ?? 0) * 1.1 || 1;
  const x = (i: number) => PAD.l + (i / (series.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const path = series.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[1]).toFixed(1)}`).join(' ');
  const h = hover === null ? null : series[hover];
  return (
    <div className="px-2 py-1.5">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Daily ship transits, ${series[0][0]} to ${series[series.length - 1][0]}${reference ? `, 2025 average ${reference.toFixed(1)}` : ''}`}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          setHover(Math.max(0, Math.min(series.length - 1, Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (series.length - 1)))));
        }}
        onMouseLeave={() => setHover(null)}
      >
        <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} stroke="var(--color-wt-line)" strokeWidth={1} />
        <text x={PAD.l - 3} y={y(0)} textAnchor="end" dominantBaseline="middle" fill="var(--color-wt-fg-dim)" fontSize={8}>0</text>
        <text x={PAD.l - 3} y={y(max / 1.1)} textAnchor="end" dominantBaseline="middle" fill="var(--color-wt-fg-dim)" fontSize={8}>{Math.round(max / 1.1)}</text>
        {reference !== null && (
          <>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(reference)} y2={y(reference)} stroke="var(--color-wt-fg-muted)" strokeWidth={1} strokeDasharray="3 3" />
            <text x={W - PAD.r} y={y(reference) - 3} textAnchor="end" fill="var(--color-wt-fg-muted)" fontSize={8}>2025 avg {reference.toFixed(1)}</text>
          </>
        )}
        <path d={path} fill="none" stroke="var(--color-wt-info)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {h && hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={y(0)} stroke="var(--color-wt-fg-dim)" strokeWidth={1} />
            <circle cx={x(hover)} cy={y(h[1])} r={3} fill="var(--color-wt-info)" stroke="var(--color-wt-panel)" strokeWidth={1.5} />
          </>
        )}
        <text x={PAD.l} y={H - 3} fill="var(--color-wt-fg-dim)" fontSize={8}>{series[0][0]}</text>
        <text x={W - PAD.r} y={H - 3} textAnchor="end" fill="var(--color-wt-fg-dim)" fontSize={8}>{series[series.length - 1][0]}</text>
      </svg>
      <p className="h-3 text-wt-fg-muted tabular-nums" aria-live="polite">
        {h ? `${h[0]}: ${h[1]} ships, ${h[2]} tankers` : 'Hover for daily counts'}
      </p>
    </div>
  );
}
