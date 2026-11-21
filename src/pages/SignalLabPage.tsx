import { useEffect, useMemo, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { WATCH_REGIONS } from '@shared/domain/regions';
import { EVENT_CATEGORIES, type EventCategory } from '@shared/domain/types';
import { INDICATOR_CATALOG, getIndicator } from '@shared/domain/indicators/catalog';
import type { IndicatorState } from '@shared/domain/indicators/types';
import { bucketCounts } from '@shared/domain/history/trends';
import { coActivation, dataSufficiency, scoreIndicator, simulateIndicator, type IndicatorScorecard, type Outcome, type StatePoint } from '@shared/domain/history/backtest';
import { collectionStart } from '@shared/domain/history/replay';
import { useData } from '../state/DataContext';
import { useArchive } from '../data/useArchive';
import { formatUtc } from '../lib/time';
import { INDICATOR_STATE_TONE } from '../config/indicators';
import { SeriesChart } from '../components/charts/SeriesChart';
import { Panel } from '../components/ui/Panel';
import { Lamp, Tag } from '../components/ui/Tag';
import { LeadLagPanel } from '../components/meters/LeadLagPanel';

const H = 3_600_000;
const D = 24 * H;
const field = 'h-6 border border-wt-line-strong bg-wt-bg px-1 text-2xs';

interface BacktestResult {
  from: number;
  to: number;
  cards: IndicatorScorecard[];
  pairs: ReturnType<typeof coActivation>;
  sufficiency: ReturnType<typeof dataSufficiency>;
  outcomes: Outcome[];
}

/** Signal Lab: trends, backtesting and experimental-signal research (PDD §11, §7.3). */
export default function SignalLabPage() {
  const data = useData();
  const { archive, loading, error, load } = useArchive();
  const [days, setDays] = useState(30);
  const [category, setCategory] = useState<EventCategory | 'all'>('all');
  const [stepHours, setStepHours] = useState(6);
  const [horizon, setHorizon] = useState(72);
  const [includeElevated, setIncludeElevated] = useState(false);
  const [outcomeIds, setOutcomeIds] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<BacktestResult | null>(null);

  useEffect(() => {
    document.title = 'WATCHTOWER // SIGNAL LAB';
  }, []);

  // The window end is fixed when history is loaded, keeping render pure.
  // Rounded UP to the hour so the latest collection is inside the window.
  const [now, setNow] = useState(() => Math.ceil(Date.now() / H) * H);
  const from = now - days * D;

  const volume = useMemo(
    () =>
      archive
        ? bucketCounts(archive.events, from, now, days > 14 ? 24 : 6, category === 'all' ? undefined : (e) => e.category === category).map((b) => ({ t: b.start, v: b.count }))
        : [],
    [archive, from, now, days, category],
  );

  const outcomes: Outcome[] = useMemo(
    () =>
      (archive?.incidents ?? []).map((i) => {
        const times = i.evidence.map((l) => Date.parse(l.event.occurredAt ?? l.event.publishedAt ?? l.event.collectedAt));
        return { id: i.id, label: i.title, at: times.length ? Math.min(...times) : Date.parse(i.createdAt) };
      }),
    [archive],
  );

  async function runBacktest() {
    if (!archive) return;
    setRunning(true);
    setProgress(0);
    const chosen = outcomes.filter((o) => outcomeIds.includes(o.id));
    const active: IndicatorState[] = includeElevated ? ['TRIGGERED', 'ELEVATED'] : ['TRIGGERED'];
    const series: Record<string, StatePoint[]> = {};
    const cards: IndicatorScorecard[] = [];
    for (let i = 0; i < INDICATOR_CATALOG.length; i++) {
      const def = INDICATOR_CATALOG[i];
      // Yield to the browser between indicators so the page stays responsive.
      await new Promise((r) => setTimeout(r, 0));
      series[def.id] = simulateIndicator(def, archive.events, data.sourceStatus, from, now, stepHours);
      cards.push(scoreIndicator(def.id, series[def.id], chosen, horizon, active));
      setProgress((i + 1) / INDICATOR_CATALOG.length);
    }
    setResult({
      from,
      to: now,
      cards,
      pairs: coActivation(series, active),
      sufficiency: dataSufficiency(from, now, collectionStart(data.sourceStatus)),
      outcomes: chosen,
    });
    setRunning(false);
  }

  const experimental = INDICATOR_CATALOG.filter((d) => d.experimental);
  const evalById = new Map(data.indicatorEvaluations.map((e) => [e.indicatorId, e]));

  return (
    <div className="h-full space-y-1.5 overflow-y-auto p-1.5">
      <Panel title="Signal Lab" designator="L6" actions={<FlaskConical size={12} className="text-wt-fg-muted" aria-hidden />}>
        <div className="flex flex-wrap items-center gap-2 px-2 py-1.5 text-2xs">
          <span className="text-wt-fg-dim">HISTORY</span>
          <select aria-label="History window" className={field} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[7, 30, 90].map((d) => <option key={d} value={d}>LAST {d} DAYS</option>)}
          </select>
          <button
            onClick={() => {
              const end = Math.ceil(Date.now() / H) * H;
              setNow(end);
              setResult(null);
              void load(new Date(end - days * D - 32 * D).toISOString());
            }}
            disabled={loading}
            className="h-6 border border-wt-fg/60 px-2 hover:bg-wt-fg hover:text-wt-bg disabled:opacity-50"
          >
            {loading ? 'LOADING…' : 'LOAD HISTORY'}
          </button>
          {archive && (
            <span className="text-wt-fg-dim">
              {archive.origin === 'archive' ? `${archive.events.length} records · ${archive.raiHistory.length} RAI points · ${archive.reads} reads` : 'demo data'}
              {archive.truncated && <span className="text-wt-warn"> · limit reached</span>}
            </span>
          )}
        </div>
        {error && <p role="alert" className="px-2 pb-2 text-xs text-wt-crit">ERROR: {error}</p>}
      </Panel>

      {archive && (
        <>
          <Panel title="Trends" designator="T">
            <div className="space-y-3 p-2">
              <div>
                <div className="mb-1 flex items-center gap-2 text-2xs">
                  <span className="text-wt-fg-dim">RECORD VOLUME BY PUBLICATION TIME</span>
                  <select aria-label="Category" className={field} value={category} onChange={(e) => setCategory(e.target.value as EventCategory | 'all')}>
                    <option value="all">ALL CATEGORIES</option>
                    {EVENT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <SeriesChart title={`Records per ${days > 14 ? 'day' : '6 h'} (${category})`} points={volume} kind="bar" valueLabel="records" />
              </div>
              <div>
                <p className="mb-1 text-2xs text-wt-fg-dim">REGIONAL ACTIVITY INDEX HISTORY (one chart per region; gaps = not evaluable)</p>
                <div className="grid gap-x-4 gap-y-2 md:grid-cols-2 xl:grid-cols-3">
                  {WATCH_REGIONS.map((r) => (
                    <SeriesChart
                      key={r.id}
                      title={r.name}
                      kind="line"
                      yDomain={[0, 100]}
                      height={90}
                      valueLabel="RAI"
                      emptyText="No RAI history recorded yet."
                      points={archive.raiHistory.filter((p) => Date.parse(p.at) >= from).map((p) => ({ t: Date.parse(p.at), v: p.scores[r.id] ?? null }))}
                    />
                  ))}
                </div>
              </div>
            </div>
          </Panel>

          <Panel title="Backtest" designator="B">
            <div className="space-y-2 p-2 text-2xs">
              <p className="text-wt-fg-muted">
                Re-runs every indicator at fixed steps over the window, using only data available at each step. Then it compares when indicators
                fired with OUTCOMES you choose: each dossier counts as an outcome at its earliest evidence time. It answers: did the indicator fire
                before the outcome, how early, and how often did it fire with no outcome following?
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1">STEP
                  <select className={field} value={stepHours} onChange={(e) => setStepHours(Number(e.target.value))}>
                    {[1, 6, 12, 24].map((s) => <option key={s} value={s}>{s} H</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-1">HORIZON
                  <select className={field} value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}>
                    {[24, 72, 168].map((s) => <option key={s} value={s}>{s} H</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-1">
                  <input type="checkbox" className="accent-[#6aff9b]" checked={includeElevated} onChange={(e) => setIncludeElevated(e.target.checked)} />
                  COUNT ELEVATED AS FIRING
                </label>
              </div>
              <div>
                <p className="text-wt-fg-dim">OUTCOMES (dossiers)</p>
                {outcomes.length === 0 ? (
                  <p className="text-wt-fg-dim">No dossiers. Without outcomes, the backtest still reports how often each indicator fired and which fired together.</p>
                ) : (
                  outcomes.map((o) => (
                    <label key={o.id} className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        className="accent-[#6aff9b]"
                        checked={outcomeIds.includes(o.id)}
                        onChange={(e) => setOutcomeIds((xs) => (e.target.checked ? [...xs, o.id] : xs.filter((x) => x !== o.id)))}
                      />
                      <span className="tabular-nums text-wt-fg-dim">{formatUtc(new Date(o.at).toISOString())}</span> {o.label}
                    </label>
                  ))
                )}
              </div>
              <button onClick={() => void runBacktest()} disabled={running} className="h-6 border border-wt-fg/60 px-2 hover:bg-wt-fg hover:text-wt-bg disabled:opacity-50">
                {running ? `RUNNING… ${Math.round(progress * 100)}%` : 'RUN BACKTEST'}
              </button>
            </div>
            {result && (
              <div className="border-t border-wt-line">
                <p className={`px-2 py-1.5 text-2xs ${result.sufficiency.adequate ? 'text-wt-fg-muted' : 'text-wt-warn'}`}>
                  DATA SUFFICIENCY: {result.sufficiency.coveredDays} of {result.sufficiency.windowDays} days in this window were actually collected.
                  {!result.sufficiency.adequate && ' Below the 90-day minimum: treat these results as a test of the method, not evidence about the indicators.'}
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-2xs">
                    <thead className="bg-wt-bg2 tracking-widest text-wt-fg-dim">
                      <tr>
                        {['INDICATOR', 'FIRING EPISODES', 'HITS (LEAD)', 'MISSES', 'FALSE ALARMS', 'EVALUABLE'].map((h) => (
                          <th key={h} className="border-b border-wt-line px-2 py-1 font-normal">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.cards.map((c) => (
                        <tr key={c.indicatorId} className="border-b border-wt-line">
                          <td className="px-2 py-1">
                            {getIndicator(c.indicatorId)?.name}
                            {getIndicator(c.indicatorId)?.experimental && <Tag tone="warn">EXP</Tag>}
                          </td>
                          <td className="px-2 py-1 tabular-nums">{c.episodes}</td>
                          <td className="px-2 py-1 tabular-nums">{c.hits.length ? c.hits.map((h) => `${h.leadHours} h`).join(', ') : result.outcomes.length ? '0' : '—'}</td>
                          <td className="px-2 py-1 tabular-nums">{result.outcomes.length ? c.misses.length : '—'}</td>
                          <td className="px-2 py-1 tabular-nums" title={result.outcomes.length ? undefined : 'Choose outcomes to judge false alarms'}>{result.outcomes.length ? c.falseAlarms : '—'}</td>
                          <td className="px-2 py-1 tabular-nums">{Math.round(c.evaluableShare * 100)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="px-2 py-1.5 text-2xs">
                  <p className="text-wt-fg-dim">CO-ACTIVATION (share of firing steps in common)</p>
                  {result.pairs.length === 0 ? (
                    <p className="text-wt-fg-dim">No indicators fired together in this window.</p>
                  ) : (
                    result.pairs.slice(0, 10).map((p) => (
                      <p key={`${p.a}-${p.b}`}>
                        {getIndicator(p.a)?.name} ↔ {getIndicator(p.b)?.name}: {Math.round(p.jaccard * 100)}% ({p.overlapSteps} steps)
                      </p>
                    ))
                  )}
                  <p className="mt-1 text-wt-fg-dim">
                    Hit = an episode started within {horizon} h before the outcome. False alarm = an episode with no outcome in the following {horizon} h.
                    Co-activation means indicators fired together; it does not establish that they are independent corroboration.
                  </p>
                </div>
              </div>
            )}
          </Panel>
        </>
      )}

      <LeadLagPanel result={data.meters?.leadLag ?? null} />

      <Panel title="Experimental Signals — Unvalidated" designator="X">
        <p className="border-b border-wt-line px-2 py-1.5 text-2xs text-wt-warn">
          Research records for unvalidated signals. They never contribute to the Regional Activity Index unless a documented evaluation supports them.
        </p>
        <div className="divide-y divide-wt-line">
          {experimental.map((d) => {
            const ev = evalById.get(d.id);
            const r = d.research;
            return (
              <div key={d.id} className="px-2 py-2 text-2xs">
                <div className="mb-1 flex items-center gap-1.5 text-xs">
                  {ev && <Lamp tone={INDICATOR_STATE_TONE[ev.state]} label={ev.state} />}
                  {d.name}
                  <Tag tone="warn">EVIDENCE: {r?.evidenceQuality.toUpperCase() ?? 'NONE'}</Tag>
                  <span className="ml-auto text-wt-fg-dim">{ev?.state ?? '—'}</span>
                </div>
                {r && (
                  <dl className="grid grid-cols-[150px_1fr] gap-x-3 gap-y-0.5">
                    {([
                      ['HYPOTHESIS', r.hypothesis],
                      ['DATA AVAILABILITY', r.dataAvailability],
                      ['BASELINE PERIOD', r.baselinePeriod],
                      ['EXPECTED RELATIONSHIP', r.expectedRelationship],
                      ['HISTORICAL EXAMPLES', r.historicalExamples],
                      ['CONFOUNDERS', r.confounders],
                      ['FALSE POSITIVES', r.falsePositives],
                      ['RETROSPECTIVE RESULTS', r.retrospectiveResults],
                    ] as const).map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-wt-fg-dim">{k}</dt>
                        <dd className="text-wt-fg-muted">{v}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
