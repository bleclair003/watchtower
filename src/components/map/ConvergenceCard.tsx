import { ExternalLink, X } from 'lucide-react';
import { FEED_LABEL, type ConvergenceSnapshot, type Hotspot } from '@shared/domain/convergence';
import { getRegion } from '@shared/domain/regions';
import { formatAge, formatUtc } from '../../lib/time';
import { safeExternalUrl } from '../../lib/sanitize';
import { Tag } from '../ui/Tag';
import { CONVERGENCE_COLOR } from './WorldMap';

const fmt = (lat: number, lon: number) => `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;

export const LEVEL_TEXT = { watch: 'WATCH', strong: 'STRONG' } as const;

/** One-line summary of a hotspot's anomaly types ("Ship went dark ×5 · GPS interference (high) ×1"). */
export const anomalySummary = (h: Hotspot) =>
  h.types
    .filter((t) => t.role === 'anomaly')
    .map((t) => `${t.label} ×${t.count}`)
    .join(' · ');

/** One convergence hotspot: which kinds of signal line up, from which independent feeds, and every signal behind it. */
export function ConvergenceCard({ hotspot: h, snapshot, now, onClose }: { hotspot: Hotspot; snapshot: ConvergenceSnapshot; now: number; onClose: () => void }) {
  const anomalies = h.types.filter((t) => t.role === 'anomaly');
  const context = h.types.filter((t) => t.role === 'context');
  return (
    <section
      aria-label={`Signal convergence near ${fmt(h.lat, h.lon)}`}
      className="absolute right-2 bottom-2 z-10 max-h-[calc(100%-1rem)] w-[min(360px,calc(100%-1rem))] overflow-y-auto border border-wt-line-strong bg-wt-panel/95 text-2xs shadow-lg"
    >
      <header className="flex items-start gap-2 border-b border-wt-line px-2 py-1.5">
        <span className="mt-1 size-2.5 shrink-0 rounded-full border-2" style={{ borderColor: CONVERGENCE_COLOR[h.level] }} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-wt-fg">
            Signal convergence · {LEVEL_TEXT[h.level]} {snapshot.simulated && <Tag tone="warn">SIMULATED</Tag>}
          </p>
          <p className="text-wt-fg-muted">
            {h.feeds.length} independent feeds within {h.radiusKm} km of {fmt(h.lat, h.lon)}
            {h.regionIds.length > 0 && ` · ${h.regionIds.map((r) => getRegion(r)?.shortCode ?? r).join(', ')}`}
          </p>
        </div>
        <button onClick={onClose} aria-label="Close convergence details" className="text-wt-fg-muted hover:text-wt-fg">
          <X size={12} />
        </button>
      </header>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 px-2 py-1.5">
        <dt className="text-wt-fg-dim">ANOMALIES</dt>
        <dd>
          <ul>
            {anomalies.map((t) => (
              <li key={t.type}>
                {t.label} <span className="text-wt-fg-muted">×{t.count} · {FEED_LABEL[t.feed]}</span>
              </li>
            ))}
          </ul>
        </dd>
        {context.length > 0 && (
          <>
            <dt className="text-wt-fg-dim">CONTEXT</dt>
            <dd className="text-wt-fg-muted">{context.map((t) => `${t.label} ×${t.count}`).join(' · ')}</dd>
          </>
        )}
        <dt className="text-wt-fg-dim">SPAN</dt>
        <dd className="tabular-nums">
          {formatUtc(h.first)} to {formatUtc(h.last)}
        </dd>
        <dt className="text-wt-fg-dim">CHECKED</dt>
        <dd>
          {formatAge(snapshot.generatedAt, now)} ago · {snapshot.signalsChecked} located signals, last {snapshot.windowHours} h
        </dd>
      </dl>
      <p className="border-t border-wt-line px-2 py-1 text-wt-fg-dim">
        Different kinds of signal from {h.feeds.length} separate feeds ({h.feeds.map((f) => FEED_LABEL[f] ?? f).join(', ')}) in the same area at about the same time. That is a reason to look closer, not evidence that they are linked: busy sea lanes and standing jamming put signals together by chance.
      </p>
      <h3 className="border-t border-wt-line px-2 pt-1.5 text-wt-fg-dim">
        SIGNALS ({h.signalCount}
        {h.signals.length < h.signalCount ? `, ${h.signals.length} shown` : ''})
      </h3>
      <ul className="px-2 pb-1.5">
        {h.signals.map((s, i) => {
          const url = s.url ? safeExternalUrl(s.url) : null;
          return (
            <li key={`${s.type}-${s.eventId ?? i}`} className="border-b border-wt-line py-1 last:border-0">
              <p className="text-wt-fg-dim">
                {formatUtc(s.at)} · {s.type === 'mil-air' || s.type === 'sanctioned-ship' || s.type === 'gnss-medium' ? 'context' : 'anomaly'}
                {s.detail ? ` · ${s.detail}` : ''}
              </p>
              <p>
                {url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {s.title} <ExternalLink size={9} className="inline" aria-hidden />
                  </a>
                ) : (
                  s.title
                )}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
