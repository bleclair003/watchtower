import { useEffect, useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { buildSitrep, sitrepToMarkdown, type Sitrep } from '@shared/domain/history/sitrep';
import { useData } from '../state/DataContext';
import { useArchive } from '../data/useArchive';
import { mergeSourceStatus } from '../lib/sourceHealth';
import { formatUtc } from '../lib/time';
import { safeExternalUrl } from '../lib/sanitize';
import { Panel } from '../components/ui/Panel';
import { Tag } from '../components/ui/Tag';

const PERIODS = [
  { label: '6H', hours: 6 },
  { label: '24H', hours: 24 },
  { label: '7D', hours: 168 },
] as const;

const toLocalInput = (t: number) => new Date(t - new Date(t).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/** SITREP: deterministic situation report for a chosen period. */
export default function SitrepPage() {
  const data = useData();
  const { archive, loading, error, load } = useArchive();
  const [period, setPeriod] = useState<number | 'custom'>(24);
  const [customFrom, setCustomFrom] = useState(() => toLocalInput(Date.now() - 48 * 3_600_000));
  const [customTo, setCustomTo] = useState(() => toLocalInput(Date.now()));
  const [range, setRange] = useState<{ from: number; to: number; generatedAt: number } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    document.title = 'WATCHTOWER // SITREP';
  }, []);

  function generate() {
    const to = period === 'custom' ? new Date(customTo).getTime() : Date.now();
    const from = period === 'custom' ? new Date(customFrom).getTime() : to - period * 3_600_000;
    if (!(from < to)) return;
    setRange({ from, to, generatedAt: Date.now() });
    setCopied(false);
    // Load from slightly before the period so RAI history has a start-of-period point.
    void load(new Date(from - 12 * 3_600_000).toISOString());
  }

  const sitrep: Sitrep | null = useMemo(() => {
    if (!archive || !range) return null;
    return buildSitrep({
      from: range.from,
      to: range.to,
      now: range.generatedAt,
      events: archive.events,
      evaluations: data.indicatorEvaluations,
      transitions: archive.transitions,
      currentScores: data.regionScores,
      scoreHistory: archive.raiHistory,
      alerts: archive.alerts,
      sourceStatus: mergeSourceStatus(data.sourceStatus, range.generatedAt),
      incidents: archive.incidents,
      eventsTruncated: archive.truncated,
    });
  }, [archive, range, data.indicatorEvaluations, data.regionScores, data.sourceStatus]);

  return (
    <div className="h-full space-y-1.5 overflow-y-auto p-1.5">
      <Panel title="SITREP — Situation Report" designator="S6">
        <div className="flex flex-wrap items-center gap-2 border-b border-wt-line px-2 py-1.5 text-2xs">
          <span className="text-wt-fg-dim">PERIOD</span>
          {PERIODS.map((p) => (
            <button
              key={p.label}
              aria-pressed={period === p.hours}
              onClick={() => setPeriod(p.hours)}
              className={`h-6 border px-2 ${period === p.hours ? 'border-wt-info text-wt-info' : 'border-wt-line-strong text-wt-fg-muted hover:text-wt-fg'}`}
            >
              {p.label}
            </button>
          ))}
          <button
            aria-pressed={period === 'custom'}
            onClick={() => setPeriod('custom')}
            className={`h-6 border px-2 ${period === 'custom' ? 'border-wt-info text-wt-info' : 'border-wt-line-strong text-wt-fg-muted hover:text-wt-fg'}`}
          >
            CUSTOM
          </button>
          {period === 'custom' && (
            <>
              <input aria-label="From" type="datetime-local" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-6 border border-wt-line-strong bg-wt-bg px-1 text-2xs" />
              <span>→</span>
              <input aria-label="To" type="datetime-local" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-6 border border-wt-line-strong bg-wt-bg px-1 text-2xs" />
            </>
          )}
          <button onClick={generate} disabled={loading} className="h-6 border border-wt-fg/60 px-2 hover:bg-wt-fg hover:text-wt-bg disabled:opacity-50">
            {loading ? 'LOADING…' : 'GENERATE'}
          </button>
          {sitrep && (
            <button
              className="ml-auto text-wt-fg hover:underline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(sitrepToMarkdown(sitrep));
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              [{copied ? 'COPIED' : 'EXPORT INTELLIGENCE CONTEXT (MARKDOWN)'}]
            </button>
          )}
        </div>
        <p className="px-2 py-1.5 text-2xs text-wt-fg-dim">
          Generated deterministically from recorded data. Every line comes from WATCHTOWER records, and items link to their sources. No AI text and
          no inference. The Markdown export is a ready-to-paste evidence packet for analysis in Claude.
        </p>
        {error && <p role="alert" className="px-2 pb-2 text-xs text-wt-crit">ERROR: {error}</p>}
        {archive && (
          <p className="px-2 pb-1.5 text-2xs text-wt-fg-dim">
            Source: {archive.origin === 'archive' ? `Firestore archive (${archive.events.length} records, ${archive.reads} reads)` : 'dashboard data (demo mode, no archive)'}
            {archive.truncated && <span className="text-wt-warn"> · query limit reached, some records may be missing</span>}
          </p>
        )}
      </Panel>

      {sitrep && (
        <>
          <p className="px-1 text-xs">
            <span className="text-wt-fg-dim">PERIOD </span>
            {formatUtc(sitrep.from)} → {formatUtc(sitrep.to)} <span className="text-wt-fg-dim">· generated {formatUtc(sitrep.generatedAt)}</span>
          </p>
          {sitrep.sections.map((sec, i) => (
            <Panel key={sec.key} title={`${i + 1}. ${sec.title}`} designator={`§${i + 1}`} actions={<Tag>{sec.items.length}</Tag>}>
              {sec.items.length === 0 ? (
                <p className="px-2 py-1.5 text-2xs text-wt-fg-dim">{sec.empty}</p>
              ) : (
                <ul className="divide-y divide-wt-line">
                  {sec.items.map((it, j) => {
                    const url = safeExternalUrl(it.url);
                    return (
                      <li key={j} className="flex items-start gap-2 px-2 py-1 text-xs">
                        {it.at && <span className="text-2xs whitespace-nowrap text-wt-fg-muted tabular-nums">{formatUtc(it.at)}</span>}
                        <span className="min-w-0 flex-1">{it.text}</span>
                        {url && (
                          <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="text-wt-info" aria-label="Open source">
                            <ExternalLink size={11} />
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          ))}
          <Panel title="Limitations" designator="!">
            <ul className="space-y-0.5 px-2 py-1.5 text-2xs text-wt-fg-muted">
              {sitrep.limitations.map((l) => <li key={l}>• {l}</li>)}
            </ul>
          </Panel>
        </>
      )}
    </div>
  );
}
