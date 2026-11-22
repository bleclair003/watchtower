import { Fragment, useEffect, useMemo, useState } from 'react';
import { ExternalLink, FlaskConical } from 'lucide-react';
import { WATCH_REGIONS } from '@shared/domain/regions';
import { INDICATOR_CATALOG, CATALOG_VERSION } from '@shared/domain/indicators/catalog';
import { describeCondition } from '@shared/domain/indicators/conditions';
import { evaluateAll } from '@shared/domain/indicators/evaluate';
import { computeAllRegionScores, RAI_BANDS, SOURCE_CAP_SHARE } from '@shared/domain/indicators/rai';
import type { IndicatorDefinition, IndicatorEvaluation, RegionScore } from '@shared/domain/indicators/types';
import { useData } from '../state/DataContext';
import { useNow } from '../hooks/useNow';
import { formatAge, formatUtc } from '../lib/time';
import { safeExternalUrl } from '../lib/sanitize';
import { BAND_TONE, INDICATOR_STATE_LABEL, INDICATOR_STATE_TONE, RAI_DISCLAIMER } from '../config/indicators';
import { Panel } from '../components/ui/Panel';
import { Lamp, Tag } from '../components/ui/Tag';

function IndicatorRow({
  def,
  ev,
  open,
  onToggle,
  eventsById,
  now,
}: {
  def: IndicatorDefinition;
  ev: IndicatorEvaluation | undefined;
  open: boolean;
  onToggle: () => void;
  eventsById: Map<string, { title: string; sourceUrl: string; publishedAt: string | null }>;
  now: number;
}) {
  const state = ev?.state ?? 'UNKNOWN';
  return (
    <Fragment>
      <tr onClick={onToggle} className={`cursor-pointer border-b border-wt-line align-top ${open ? 'bg-wt-info/[0.06]' : 'hover:bg-wt-bg2'}`}>
        <td className="px-2 py-1">
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <Lamp tone={INDICATOR_STATE_TONE[state]} label={state} />
            <Tag tone={INDICATOR_STATE_TONE[state]}>{INDICATOR_STATE_LABEL[state]}</Tag>
          </span>
        </td>
        <td className="px-2 py-1">
          <button className="text-left hover:underline" aria-expanded={open} onClick={(e) => { e.stopPropagation(); onToggle(); }}>
            {def.name}
          </button>
          <div className="text-2xs text-wt-fg-dim">{def.id}</div>
        </td>
        <td className="px-2 py-1 tabular-nums whitespace-nowrap" title="matched · elevated threshold · trigger threshold">
          {ev && ['NORMAL', 'ELEVATED', 'TRIGGERED'].includes(state) ? (
            <>
              {ev.matchedCount} <span className="text-wt-fg-dim">/ E{ev.elevatedAt} T{ev.triggeredAt}</span>
            </>
          ) : (
            '—'
          )}
        </td>
        <td className="px-2 py-1 tabular-nums">{def.windowHours} h</td>
        <td className="px-2 py-1 text-2xs whitespace-nowrap">
          {!def.baseline ? (
            <span className="text-wt-fg-dim">NONE</span>
          ) : ev?.baseline.status === 'sufficient' && ev.baseline.method === 'robust' ? (
            <span title={`Usually ${ev.baseline.median} per window (median of ${ev.baseline.samples} earlier windows), typical spread ${ev.baseline.spread}. Score = distance from usual in spreads: 2+ unusual (elevated), 3+ very unusual (triggered).`}>
              ~{ev.baseline.median} ± {ev.baseline.spread}{' '}
              <span className={(ev.baseline.score ?? 0) >= 2 ? 'font-bold text-wt-warn' : 'text-wt-fg-dim'}>
                score {(ev.baseline.score ?? 0) > 0 ? '+' : ''}
                {ev.baseline.score}
              </span>
            </span>
          ) : ev?.baseline.status === 'sufficient' ? (
            <span>μ {ev.baseline.meanPerWindow ?? 0}</span>
          ) : (
            <span className="text-wt-warn" title="Not enough collection history; fixed thresholds apply">
              BUILDING ({ev?.baseline.historyDays ?? 0}/{def.baseline.days + def.windowHours / 24} d)
            </span>
          )}
        </td>
        <td className="px-2 py-1 text-2xs whitespace-nowrap text-wt-fg-muted">{ev ? formatAge(ev.stateSince, now) : '—'}</td>
        <td className="px-2 py-1 text-2xs whitespace-nowrap text-wt-fg-muted">{ev?.lastTriggeredAt ? formatUtc(ev.lastTriggeredAt) : 'NEVER'}</td>
        <td className="px-2 py-1 text-right tabular-nums text-wt-fg-muted">
          {def.experimental ? '—' : `${def.weight}·${def.severity[0].toUpperCase()}`}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-wt-line bg-wt-bg2/40">
          <td />
          <td colSpan={7} className="px-2 py-2">
            <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-2xs">
              <dt className="text-wt-fg-dim">DESCRIPTION</dt>
              <dd>{def.description}</dd>
              <dt className="text-wt-fg-dim">RATIONALE</dt>
              <dd className="text-wt-fg-muted">{def.rationale}</dd>
              <dt className="text-wt-fg-dim">CONDITION</dt>
              <dd className="font-mono break-words text-wt-info">{describeCondition(def.match)}</dd>
              <dt className="text-wt-fg-dim">THRESHOLDS</dt>
              <dd>
                elevated ≥ {def.elevated.countAtLeast}, triggered ≥ {def.triggered.countAtLeast}
                {def.triggered.distinctSourcesAtLeast ? ` from ≥ ${def.triggered.distinctSourcesAtLeast} sources` : ''}
                {def.baseline &&
                  ` · baseline ${def.baseline.days} d: trigger also needs ≥ ${def.baseline.triggerRatio}× mean, elevated ≥ ${def.baseline.elevatedRatio}× mean`}
              </dd>
              <dt className="text-wt-fg-dim">REQUIRED SOURCES</dt>
              <dd>{def.requiredSourceIds.join(', ')}</dd>
              <dt className="text-wt-fg-dim">ASSESSMENT</dt>
              <dd>{ev?.reason ?? 'Not evaluated yet.'}</dd>
              <dt className="text-wt-fg-dim">EVALUATED</dt>
              <dd>{ev ? `${formatUtc(ev.evaluatedAt)} · config v${ev.configVersion}` : '—'}</dd>
              <dt className="text-wt-fg-dim">EVIDENCE</dt>
              <dd>
                {ev?.evidenceEventIds.length ? (
                  <ul className="space-y-0.5">
                    {ev.evidenceEventIds.map((id) => {
                      const e = eventsById.get(id);
                      const url = safeExternalUrl(e?.sourceUrl);
                      return (
                        <li key={id} className="flex gap-1.5">
                          <span className="tabular-nums text-wt-fg-dim">{e?.publishedAt?.slice(0, 10) ?? '—'}</span>
                          {e ? <span>{e.title}</span> : <span className="text-wt-fg-dim">record {id} (outside dashboard window)</span>}
                          {url && (
                            <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="text-wt-info" aria-label="Open source">
                              <ExternalLink size={10} />
                            </a>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <span className="text-wt-fg-dim">none in window</span>
                )}
              </dd>
            </dl>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function IndicatorTable(props: {
  defs: IndicatorDefinition[];
  evals: Map<string, IndicatorEvaluation>;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  eventsById: Map<string, { title: string; sourceUrl: string; publishedAt: string | null }>;
  now: number;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] border-collapse text-left text-xs">
        <thead className="bg-wt-bg2 text-2xs tracking-widest text-wt-fg-dim">
          <tr>
            {['STATE', 'INDICATOR', 'MATCHED', 'WINDOW', 'BASELINE', 'SINCE', 'LAST TRIGGERED', 'WT·SEV'].map((h) => (
              <th key={h} className="border-b border-wt-line px-2 py-1 font-normal">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.defs.map((d) => (
            <IndicatorRow
              key={d.id}
              def={d}
              ev={props.evals.get(d.id)}
              open={props.openId === d.id}
              onToggle={() => props.setOpenId(props.openId === d.id ? null : d.id)}
              eventsById={props.eventsById}
              now={props.now}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScoreSummary({ score }: { score: RegionScore | undefined }) {
  if (!score || score.score === null) return <Tag tone="inactive">RAI N/E</Tag>;
  return (
    <span className="flex items-center gap-2">
      <Tag tone={BAND_TONE[score.band!]}>RAI {score.score} · {score.band}</Tag>
      <span className="text-2xs text-wt-fg-dim">coverage {Math.round(score.coverage * 100)}%</span>
    </span>
  );
}

/** Indicator & Warning Engine: every indicator, its state, and the evidence behind it. */
export default function IndicatorsPage() {
  const data = useData();
  const now = useNow(60_000).getTime();
  const [openId, setOpenId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ at: number; evals: IndicatorEvaluation[]; scores: RegionScore[] } | null>(null);

  useEffect(() => {
    document.title = 'WATCHTOWER // INDICATORS';
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (hash) document.getElementById(`region-${hash}`)?.scrollIntoView();
  }, []);

  const showing = preview ? preview.evals : data.indicatorEvaluations;
  const scores = preview ? preview.scores : data.regionScores;
  const evals = useMemo(() => new Map(showing.map((e) => [e.indicatorId, e])), [showing]);
  const eventsById = useMemo(() => new Map(data.events.map((e) => [e.id, e])), [data.events]);
  const counts = showing.reduce<Record<string, number>>((acc, e) => ((acc[e.state] = (acc[e.state] ?? 0) + 1), acc), {});
  const lastEval = data.indicatorEvaluations[0]?.evaluatedAt ?? null;

  function runPreview() {
    const at = Date.now();
    const { evaluations } = evaluateAll(INDICATOR_CATALOG, data.events, data.sourceStatus, at, data.indicatorEvaluations);
    setPreview({ at, evals: evaluations, scores: computeAllRegionScores(INDICATOR_CATALOG, evaluations, at) });
  }

  const operational = INDICATOR_CATALOG.filter((d) => !d.experimental);
  const experimental = INDICATOR_CATALOG.filter((d) => d.experimental);

  return (
    <div className="h-full space-y-1.5 overflow-y-auto p-1.5">
      <Panel
        title="Indicator & Warning Engine"
        designator="I1"
        actions={
          <span className="flex items-center gap-2 text-2xs">
            {preview ? (
              <>
                <Tag tone="info">BROWSER PREVIEW {formatUtc(new Date(preview.at).toISOString())}</Tag>
                <button className="text-wt-fg-muted hover:text-wt-fg" onClick={() => setPreview(null)}>[SHOW RECORDED]</button>
              </>
            ) : (
              <button
                className="text-wt-fg-muted hover:text-wt-fg"
                onClick={runPreview}
                title="Re-run the same deterministic engine in this browser on the loaded data, at the current time. Nothing is saved."
              >
                [EVALUATE NOW — PREVIEW]
              </button>
            )}
          </span>
        }
      >
        <div className="grid gap-x-6 gap-y-1 px-2 py-2 text-2xs md:grid-cols-2">
          <div className="space-y-1">
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {(['TRIGGERED', 'ELEVATED', 'NORMAL', 'UNKNOWN', 'DATA_UNAVAILABLE', 'DISABLED'] as const)
                .filter((s) => counts[s])
                .map((s) => (
                  <span key={s} className="flex items-center gap-1">
                    <Lamp tone={INDICATOR_STATE_TONE[s]} label={s} />
                    <span className="tabular-nums">{counts[s]}</span>
                    <span className="text-wt-fg-muted">{INDICATOR_STATE_LABEL[s]}</span>
                  </span>
                ))}
            </div>
            <p className="text-wt-fg-muted">
              {preview
                ? 'Showing a browser-side preview. Recorded states come from the collector and are what alerts (Phase 4) will use.'
                : lastEval
                  ? `Recorded by the collector ${formatAge(lastEval, now)} ago · catalog v${CATALOG_VERSION}.`
                  : 'No recorded evaluation yet. The collector evaluates indicators after each run.'}
            </p>
          </div>
          <div className="space-y-1 text-wt-fg-dim">
            <p>{RAI_DISCLAIMER}</p>
            <p>
              Bands: {RAI_BANDS.slice().reverse().map((b) => `${b.min}+ ${b.band}`).join(' · ')}. These are display conventions,
              not validated thresholds. No single source can supply more than {Math.round(SOURCE_CAP_SHARE * 100)}% of a region’s
              maximum. UNKNOWN or NO DATA indicators lower coverage; they never count as calm.
            </p>
          </div>
        </div>
      </Panel>

      {WATCH_REGIONS.map((r) => {
        const defs = operational.filter((d) => d.regionId === r.id);
        if (!defs.length) return null;
        return (
          <section key={r.id} id={`region-${r.id}`}>
            <Panel title={r.name} designator={r.shortCode} actions={<ScoreSummary score={scores.find((s) => s.regionId === r.id)} />}>
              <IndicatorTable defs={defs} evals={evals} openId={openId} setOpenId={setOpenId} eventsById={eventsById} now={now} />
            </Panel>
          </section>
        );
      })}

      <Panel
        title="Experimental Signals — Unvalidated"
        designator="X1"
        actions={<FlaskConical size={12} className="text-wt-warn" aria-hidden />}
      >
        <p className="border-b border-wt-line px-2 py-1.5 text-2xs text-wt-warn">
          Hypotheses under investigation. They never contribute to the Regional Activity Index, and no values are shown without a real, legally
          accessible data source.
        </p>
        <IndicatorTable defs={experimental} evals={evals} openId={openId} setOpenId={setOpenId} eventsById={eventsById} now={now} />
      </Panel>
    </div>
  );
}
