import { useCallback, useEffect, useId, useMemo, useRef, useState, type MouseEvent } from 'react';
import { formatUtc } from '../../lib/time';

/**
 * Minimal single-series time chart (line or bar), dependency-free SVG.
 *
 * Follows the project's dataviz rules: one series per chart (small multiples
 * instead of a legend), 2px line / 4px-rounded bars with 2px gaps, recessive
 * grid, text in text tokens (never the series colour), a hover crosshair with
 * tooltip, and a table view for accessibility. Null values are drawn as gaps —
 * missing data is never interpolated into a value.
 */
export interface SeriesPoint {
  t: number;
  v: number | null;
}

interface Props {
  title: string;
  points: SeriesPoint[];
  kind: 'line' | 'bar';
  /** Fixed y-domain (e.g. [0, 100] for RAI); otherwise 0..max. */
  yDomain?: [number, number];
  height?: number;
  valueLabel: string;
  emptyText?: string;
}

const PAD = { l: 30, r: 8, t: 8, b: 18 };

export function SeriesChart({ title, points, kind, yDomain, height = 120, valueLabel, emptyText = 'No data in range.' }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  // Draw in real pixels (not a scaled viewBox) so text and strokes keep their intended size.
  const [W, setW] = useState(600);
  const observer = useRef<ResizeObserver | null>(null);
  // Callback ref: re-attaches whenever the measured element changes (e.g. empty → populated).
  const boxRef = useCallback((el: HTMLElement | null) => {
    observer.current?.disconnect();
    if (!el) return;
    observer.current = new ResizeObserver(([entry]) => setW(Math.max(200, Math.round(entry.contentRect.width))));
    observer.current.observe(el);
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);
  const [showTable, setShowTable] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const titleId = useId();

  const { x, y, yMax, ticks } = useMemo(() => {
    const ts = points.map((p) => p.t);
    const t0 = Math.min(...ts);
    const t1 = Math.max(...ts);
    const vals = points.map((p) => p.v).filter((v): v is number => v !== null);
    const yMax = yDomain ? yDomain[1] : Math.max(1, ...vals);
    const yMin = yDomain ? yDomain[0] : 0;
    const innerW = W - PAD.l - PAD.r;
    const innerH = height - PAD.t - PAD.b;
    const x = (t: number) => PAD.l + (t1 === t0 ? innerW / 2 : ((t - t0) / (t1 - t0)) * innerW);
    const y = (v: number) => PAD.t + innerH - ((v - yMin) / (yMax - yMin || 1)) * innerH;
    const ticks = [yMin, Math.round((yMin + yMax) / 2), yMax];
    return { x, y, yMax, ticks };
  }, [points, yDomain, height, W]);

  if (!points.length || points.every((p) => p.v === null)) {
    return (
      <figure className="text-2xs" ref={boxRef}>
        <figcaption className="text-wt-fg-muted">{title}</figcaption>
        <p className="py-3 text-wt-fg-dim">{emptyText}</p>
      </figure>
    );
  }

  // Line path with gaps at nulls.
  let d = '';
  let pen = false;
  for (const p of points) {
    if (p.v === null) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`;
    pen = true;
  }
  const barW = Math.max(2, (W - PAD.l - PAD.r) / points.length - 2);
  const base = y(yDomain ? yDomain[0] : 0);

  function onMove(e: MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current!.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(x(p.t) - px) < Math.abs(x(points[best].t) - px)) best = i;
    });
    setHover(best);
  }

  const hp = hover !== null ? points[hover] : null;

  return (
    <figure className="text-2xs" ref={boxRef}>
      <div className="flex items-center justify-between">
        <figcaption id={titleId} className="text-wt-fg-muted">{title}</figcaption>
        <button className="text-wt-fg-dim hover:text-wt-fg" onClick={() => setShowTable((s) => !s)} aria-pressed={showTable}>
          [{showTable ? 'CHART' : 'TABLE'}]
        </button>
      </div>
      {showTable ? (
        <div className="max-h-48 overflow-y-auto">
          <table className="w-full text-left tabular-nums">
            <thead className="text-wt-fg-dim">
              <tr><th className="font-normal">Time (UTC)</th><th className="font-normal">{valueLabel}</th></tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.t}><td>{formatUtc(new Date(p.t).toISOString())}</td><td>{p.v ?? '—'}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${height}`}
            width={W}
            height={height}
            className="block max-w-full"
            role="img"
            aria-labelledby={titleId}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          >
            {ticks.map((tk) => (
              <g key={tk}>
                <line x1={PAD.l} x2={W - PAD.r} y1={y(tk)} y2={y(tk)} stroke="var(--color-wt-line)" strokeWidth={1} />
                <text x={PAD.l - 4} y={y(tk) + 3} textAnchor="end" fontSize="9" fill="var(--color-wt-fg-dim)">{tk}</text>
              </g>
            ))}
            <text x={PAD.l} y={height - 4} fontSize="9" fill="var(--color-wt-fg-dim)">{formatUtc(new Date(points[0].t).toISOString()).slice(5, 16)}</text>
            <text x={W - PAD.r} y={height - 4} textAnchor="end" fontSize="9" fill="var(--color-wt-fg-dim)">
              {formatUtc(new Date(points[points.length - 1].t).toISOString()).slice(5, 16)}
            </text>
            {kind === 'line' ? (
              <path d={d} fill="none" stroke="var(--color-wt-fg)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            ) : (
              points.map((p) =>
                p.v ? (
                  <path
                    key={p.t}
                    d={roundedTopBar(x(p.t) - barW / 2, y(p.v), barW, base - y(p.v), Math.min(4, barW / 2))}
                    fill="var(--color-wt-fg)"
                    opacity={hover === null || points[hover].t === p.t ? 0.85 : 0.45}
                  />
                ) : null,
              )
            )}
            {kind === 'line' &&
              points.length <= 60 &&
              points.map((p) => (p.v === null ? null : <circle key={p.t} cx={x(p.t)} cy={y(p.v)} r={hover !== null && points[hover].t === p.t ? 4 : 0} fill="var(--color-wt-fg)" stroke="var(--color-wt-panel)" strokeWidth={2} />))}
            {hp && <line x1={x(hp.t)} x2={x(hp.t)} y1={PAD.t} y2={base} stroke="var(--color-wt-fg-dim)" strokeDasharray="2 2" />}
            {kind === 'line' && hp?.v !== null && hp && <circle cx={x(hp.t)} cy={y(hp.v!)} r={4} fill="var(--color-wt-fg)" stroke="var(--color-wt-panel)" strokeWidth={2} />}
          </svg>
          {hp && (
            <div
              role="status"
              className="pointer-events-none absolute top-0 border border-wt-line-strong bg-wt-panel px-1.5 py-0.5 text-2xs whitespace-nowrap"
              style={{ left: `${Math.min(75, (x(hp.t) / W) * 100)}%` }}
            >
              <div className="text-wt-fg-dim">{formatUtc(new Date(hp.t).toISOString())}</div>
              <div className="text-wt-fg">
                {valueLabel}: {hp.v ?? 'no data'}
              </div>
            </div>
          )}
          <span className="sr-only">Maximum {yMax}.</span>
        </div>
      )}
    </figure>
  );
}

/** Bar with rounded top corners anchored flat on the baseline. */
function roundedTopBar(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return '';
  const rr = Math.min(r, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}
