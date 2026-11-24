import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ExternalLink, Trash2 } from 'lucide-react';
import { EVENT_CATEGORIES, type EventCategory } from '@shared/domain/types';
import { WATCH_REGIONS, getRegion } from '@shared/domain/regions';
import { INDICATOR_CATALOG, getIndicator } from '@shared/domain/indicators/catalog';
import {
  EVIDENCE_ASSESSMENTS,
  INCIDENT_STATUSES,
  LIMITS,
  type EvidenceAssessment,
  type Incident,
  type IncidentStatus,
} from '@shared/domain/incidents/types';
import { addWithMembers, buildTimeline, incidentToMarkdown, suggestRelated, validateIncident, type TimelineBasis } from '@shared/domain/incidents/logic';
import { HypothesesBoard } from '../components/dossier/HypothesesBoard';
import { useData } from '../state/DataContext';
import { useAuth } from '../state/AuthContext';
import { useNow } from '../hooks/useNow';
import { formatAge, formatUtc } from '../lib/time';
import { safeExternalUrl } from '../lib/sanitize';
import { CREDIBILITY_LABELS } from '../config/categories';
import { ASSESSMENT_HELP, ASSESSMENT_TONE, STATUS_TONE } from '../config/incidents';
import { BAND_TONE, INDICATOR_STATE_TONE } from '../config/indicators';
import { Panel } from '../components/ui/Panel';
import { Lamp, Tag } from '../components/ui/Tag';

type Svc = typeof import('../data/incidentsService');
const field = 'border border-wt-line-strong bg-wt-bg px-1.5 text-xs text-wt-fg focus:border-wt-info focus:outline-none';
const lag = (h: number | null) => (h === null ? null : h < 1 ? '<1 h' : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} d`);

/** One incident dossier: curated evidence, assessments, timeline, notes, context. */
export default function DossierPage() {
  const { id = '' } = useParams();
  const data = useData();
  const canEdit = useAuth().can('editIncidents');
  const live = data.mode !== 'demo';
  const now = useNow(60_000).getTime();
  const navigate = useNavigate();
  const [svc, setSvc] = useState<Svc | null>(null);
  const [stored, setStored] = useState<Incident | null>(null);
  const [draft, setDraft] = useState<Incident | null>(null);
  const [others, setOthers] = useState<Incident[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [basis, setBasis] = useState<TimelineBasis>('occurred');
  const [noteText, setNoteText] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exported, setExported] = useState<string | null>(null);

  async function load(s: Svc) {
    try {
      const [inc, all] = await Promise.all([s.getIncident(id), s.listIncidents()]);
      if (!inc) return setNotFound(true);
      setStored(inc);
      setDraft(inc);
      setOthers(all.filter((x) => x.id !== id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    if (!live) return;
    import('../data/incidentsService').then((s) => {
      setSvc(s);
      void load(s);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the dossier id or backend changes
  }, [live, id]);

  useEffect(() => {
    document.title = `WATCHTOWER // DOSSIER${draft ? ` // ${draft.title}` : ''}`;
  }, [draft]);

  const dirty = useMemo(() => !!draft && !!stored && JSON.stringify(draft) !== JSON.stringify(stored), [draft, stored]);
  const problems = draft ? validateIncident(draft) : [];
  const timeline = useMemo(() => (draft ? buildTimeline(draft.evidence, basis) : []), [draft, basis]);
  const suggestions = useMemo(() => (draft ? suggestRelated(draft, data.events) : []), [draft, data.events]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const update = (patch: Partial<Incident> | ((d: Incident) => Incident)) =>
    setDraft((d) => (d ? (typeof patch === 'function' ? patch(d) : { ...d, ...patch }) : d));

  async function save() {
    if (!svc || !draft || !stored) return;
    setSaving(true);
    try {
      const saved = await svc.saveIncident(draft, stored.version);
      setStored(saved);
      setDraft(saved);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!live) {
    return (
      <div className="p-3 text-xs text-wt-warn">
        Dossiers need the live backend. <Link to="/dossiers" className="text-wt-info hover:underline">Back to dossiers</Link>
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="p-3 text-xs">
        <p className="text-wt-warn">DOSSIER NOT FOUND (it may have been deleted).</p>
        <Link to="/dossiers" className="text-wt-info hover:underline">[BACK TO DOSSIERS]</Link>
      </div>
    );
  }
  if (!draft || !stored) return <p className="p-3 text-xs text-wt-fg-muted">{error ? `ERROR: ${error}` : 'LOADING DOSSIER…'}</p>;

  const regionScores = data.regionScores.filter((s) => draft.regionIds.includes(s.regionId));
  const relevantIndicators = INDICATOR_CATALOG.filter((d) => !d.experimental && draft.regionIds.includes(d.regionId));
  const evalById = new Map(data.indicatorEvaluations.map((e) => [e.indicatorId, e]));
  const counts = EVIDENCE_ASSESSMENTS.map((a) => [a, draft.evidence.filter((e) => e.assessment === a).length] as const);

  return (
    <div className="h-full space-y-1.5 overflow-y-auto p-1.5">
      {/* Save bar */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border border-wt-line-strong bg-wt-bg2 px-2 py-1 text-2xs">
        <Link to="/dossiers" className="text-wt-fg-muted hover:text-wt-fg">[◂ DOSSIERS]</Link>
        <Tag tone={STATUS_TONE[draft.status]}>{draft.status}</Tag>
        <span className="text-wt-fg-dim">v{stored.version} · saved {formatAge(stored.updatedAt, now)} ago</span>
        {!canEdit ? (
          <Tag tone="inactive" title="Viewers can read dossiers; editors and the owner change them.">READ ONLY</Tag>
        ) : dirty ? (
          <Tag tone="warn">UNSAVED CHANGES</Tag>
        ) : (
          <span className="text-wt-fg-dim">all changes saved</span>
        )}
        {problems.length > 0 && <span className="text-wt-warn">{problems[0]}</span>}
        {error && <span role="alert" className="text-wt-crit">{error}</span>}
        {canEdit && <span className="ml-auto flex gap-2">
          {dirty && (
            <button className="text-wt-fg-muted hover:text-wt-fg" onClick={() => setDraft(stored)}>[DISCARD]</button>
          )}
          <button
            disabled={!dirty || saving || problems.length > 0}
            onClick={() => void save()}
            className="border border-wt-fg/60 px-2 py-0.5 hover:bg-wt-fg hover:text-wt-bg disabled:opacity-40"
          >
            {saving ? 'SAVING…' : 'SAVE'}
          </button>
          {error?.includes('changed elsewhere') && svc && (
            <button className="text-wt-info hover:underline" onClick={() => void load(svc)}>[RELOAD]</button>
          )}
        </span>}
      </div>

      {/* Viewers: every control below is disabled by this fieldset (the security rules refuse their writes anyway). */}
      <fieldset disabled={!canEdit} className="m-0 min-w-0 space-y-1.5 border-0 p-0">

      {/* Header */}
      <Panel title="Dossier" designator="D5">
        <div className="grid gap-2 p-2 text-xs md:grid-cols-[1fr_auto_auto]">
          <label className="flex flex-col gap-0.5">
            <span className="text-2xs text-wt-fg-dim">TITLE</span>
            <input className={`${field} h-7`} maxLength={LIMITS.title} value={draft.title} onChange={(e) => update({ title: e.target.value })} />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-2xs text-wt-fg-dim">STATUS</span>
            <select className={`${field} h-7`} value={draft.status} onChange={(e) => update({ status: e.target.value as IncidentStatus })}>
              {INCIDENT_STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-2xs text-wt-fg-dim">CATEGORY</span>
            <select className={`${field} h-7`} value={draft.category} onChange={(e) => update({ category: e.target.value as EventCategory })}>
              {EVENT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-1 px-2 pb-2 text-2xs">
          <span className="self-center text-wt-fg-dim">REGIONS</span>
          {WATCH_REGIONS.map((r) => {
            const on = draft.regionIds.includes(r.id);
            return (
              <button
                key={r.id}
                aria-pressed={on}
                onClick={() => update({ regionIds: on ? draft.regionIds.filter((x) => x !== r.id) : [...draft.regionIds, r.id] })}
                className={`h-5 border px-1.5 ${on ? 'border-wt-info text-wt-info' : 'border-wt-line text-wt-fg-muted hover:text-wt-fg'}`}
              >
                {r.shortCode}
              </button>
            );
          })}
        </div>
        <label className="block px-2 pb-2">
          <span className="text-2xs text-wt-fg-dim">OPERATOR SUMMARY: your current understanding; cite evidence below</span>
          <textarea
            className={`${field} mt-0.5 block w-full py-1`}
            rows={4}
            maxLength={LIMITS.summary}
            value={draft.summary}
            onChange={(e) => update({ summary: e.target.value })}
          />
        </label>
        <div className="flex flex-wrap gap-2 border-t border-wt-line px-2 py-1 text-2xs text-wt-fg-muted">
          {counts.map(([a, n]) => (
            <span key={a} title={ASSESSMENT_HELP[a]}>
              <Tag tone={ASSESSMENT_TONE[a]}>{a}</Tag> {n}
            </span>
          ))}
          <span className="ml-auto text-wt-fg-dim">Opened {formatUtc(draft.createdAt)}</span>
        </div>
      </Panel>

      <div className="grid gap-1.5 xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* Timeline + evidence */}
        <Panel
          title={`Timeline & evidence (${draft.evidence.length})`}
          designator="T1"
          actions={
            <span role="group" aria-label="Timeline clock" className="flex text-2xs">
              {(['occurred', 'published', 'collected'] as const).map((b) => (
                <button
                  key={b}
                  aria-pressed={basis === b}
                  onClick={() => setBasis(b)}
                  className={`h-5 border border-wt-line-strong px-1.5 uppercase -ml-px ${basis === b ? 'bg-wt-fg text-wt-bg' : 'text-wt-fg-muted hover:text-wt-fg'}`}
                >
                  {b}
                </button>
              ))}
            </span>
          }
        >
          <p className="border-b border-wt-line px-2 py-1 text-2xs text-wt-fg-dim">
            Ordered by when each item {basis === 'occurred' ? 'reportedly happened' : basis === 'published' ? 'was published' : 'was collected by WATCHTOWER'}.
            Items without that time fall back to the next available time, flagged ↳. Assessments are yours; source credibility is shown separately.
          </p>
          {timeline.length === 0 ? (
            <p className="p-3 text-xs text-wt-fg-muted">NO EVIDENCE YET. Add related records from the suggestions, or use + DOSSIER on any feed item.</p>
          ) : (
            <ol className="divide-y divide-wt-line">
              {timeline.map((t) => {
                const e = t.link.event;
                const url = safeExternalUrl(e.sourceUrl);
                const cred = CREDIBILITY_LABELS[e.credibility];
                const idx = draft.evidence.findIndex((l) => l.event.eventId === e.eventId);
                return (
                  <li key={e.eventId} className="px-2 py-1.5 text-xs">
                    <div className="flex flex-wrap items-start gap-1.5">
                      <span className="text-2xs whitespace-nowrap text-wt-fg-muted tabular-nums" title={`ordered by ${t.basisUsed}`}>
                        {t.basisUsed !== basis && '↳ '}
                        {formatUtc(t.at)}
                      </span>
                      <span className="min-w-0 flex-1">{e.title}</span>
                      <select
                        aria-label="Assessment"
                        title={ASSESSMENT_HELP[t.link.assessment]}
                        className={`${field} h-5 text-2xs`}
                        value={t.link.assessment}
                        onChange={(ev) =>
                          update((d) => ({ ...d, evidence: d.evidence.map((l, i) => (i === idx ? { ...l, assessment: ev.target.value as EvidenceAssessment } : l)) }))
                        }
                      >
                        {EVIDENCE_ASSESSMENTS.map((a) => <option key={a}>{a}</option>)}
                      </select>
                      <button
                        aria-label="Remove evidence"
                        className="text-wt-fg-dim hover:text-wt-crit"
                        onClick={() => update((d) => ({ ...d, evidence: d.evidence.filter((_, i) => i !== idx) }))}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-2xs">
                      <Tag tone={ASSESSMENT_TONE[t.link.assessment]}>{t.link.assessment}</Tag>
                      <Tag tone={cred.tone} title={cred.label}>{cred.code}</Tag>
                      {e.dataOrigin !== 'live' && <Tag tone="warn">{e.dataOrigin}</Tag>}
                      <span className="text-wt-fg-dim">{e.sourceName}</span>
                      {url && (
                        <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="text-wt-info" aria-label="Open source">
                          <ExternalLink size={10} />
                        </a>
                      )}
                    </div>
                    <div className="mt-0.5 text-2xs text-wt-fg-dim tabular-nums">
                      OCC {e.occurredAt ? formatUtc(e.occurredAt) : 'not stated'} · PUB {e.publishedAt ? formatUtc(e.publishedAt) : 'not stated'} · COL{' '}
                      {formatUtc(e.collectedAt)}
                      {lag(t.reportingLagHours) && ` · reported ${lag(t.reportingLagHours)} after occurrence`}
                      {lag(t.collectionLagHours) && ` · collected ${lag(t.collectionLagHours)} after publication`}
                    </div>
                    <input
                      aria-label="Evidence note"
                      className={`${field} mt-1 h-6 w-full text-2xs`}
                      maxLength={LIMITS.evidenceNote}
                      placeholder="What does this establish, or not establish?"
                      value={t.link.note}
                      onChange={(ev) => update((d) => ({ ...d, evidence: d.evidence.map((l, i) => (i === idx ? { ...l, note: ev.target.value } : l)) }))}
                    />
                  </li>
                );
              })}
            </ol>
          )}
        </Panel>

        <div className="space-y-1.5">
          {/* Regional context */}
          <Panel title="Regional context" designator="C1">
            {draft.regionIds.length === 0 ? (
              <p className="p-2 text-2xs text-wt-fg-muted">Choose regions above to see their activity index and indicators.</p>
            ) : (
              <div className="space-y-1 p-2 text-2xs">
                {regionScores.map((s) => (
                  <div key={s.regionId} className="flex items-center gap-1.5">
                    <span className="w-20">{getRegion(s.regionId)?.shortCode}</span>
                    {s.score === null ? <Tag tone="inactive">RAI N/E</Tag> : <Tag tone={BAND_TONE[s.band!]}>RAI {s.score} · {s.band}</Tag>}
                  </div>
                ))}
                <p className="pt-1 text-wt-fg-dim">RELATED INDICATORS (tick to attach to this dossier)</p>
                {relevantIndicators.map((d) => {
                  const ev = evalById.get(d.id);
                  const on = draft.indicatorIds.includes(d.id);
                  return (
                    <label key={d.id} className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        className="accent-[#6aff9b]"
                        checked={on}
                        onChange={() => update({ indicatorIds: on ? draft.indicatorIds.filter((x) => x !== d.id) : [...draft.indicatorIds, d.id] })}
                      />
                      {ev && <Lamp tone={INDICATOR_STATE_TONE[ev.state]} label={ev.state} />}
                      <span className="truncate">{d.name}</span>
                      <span className="ml-auto text-wt-fg-dim">{ev?.state ?? '—'}</span>
                    </label>
                  );
                })}
                {draft.indicatorIds
                  .filter((idx) => !relevantIndicators.some((d) => d.id === idx))
                  .map((idx) => (
                    <div key={idx} className="text-wt-fg-muted">• {getIndicator(idx)?.name ?? idx} (other region)</div>
                  ))}
              </div>
            )}
          </Panel>

          {/* Suggestions */}
          <Panel title={`Possibly related (${suggestions.length})`} designator="R1">
            <p className="border-b border-wt-line px-2 py-1 text-2xs text-wt-fg-dim">
              Matched on shared title terms or country, from records currently on the dashboard. Nothing is linked unless you add it.
            </p>
            {suggestions.length === 0 ? (
              <p className="p-2 text-2xs text-wt-fg-muted">No related records found.</p>
            ) : (
              <ul className="divide-y divide-wt-line">
                {suggestions.map((s) => (
                  <li key={s.event.id} className="px-2 py-1 text-2xs">
                    <div className="flex items-start gap-1.5">
                      <span className="min-w-0 flex-1 text-xs">{s.event.title}</span>
                      <button
                        className="whitespace-nowrap text-wt-fg hover:underline"
                        onClick={() => {
                          try {
                            update((d) => addWithMembers(d, s.event, data.events, new Date().toISOString()).incident);
                          } catch (e) {
                            setError(e instanceof Error ? e.message : String(e));
                          }
                        }}
                      >
                        [+ ADD]
                      </button>
                    </div>
                    <p className="text-wt-fg-dim">{s.reasons.join(' · ')}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      {/* Competing hypotheses (v0.81.0) */}
      <HypothesesBoard incident={draft} onChange={(f) => update(f)} />

      <div className="grid gap-1.5 xl:grid-cols-2">
        {/* Notes */}
        <Panel title={`Analyst notes (${draft.notes.length})`} designator="N1">
          <div className="space-y-1 p-2">
            <textarea
              aria-label="New note"
              className={`${field} block w-full py-1`}
              rows={3}
              maxLength={LIMITS.noteText}
              placeholder="Observation, hypothesis, open question… (dated automatically)"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
            />
            <button
              disabled={!noteText.trim()}
              className="text-2xs text-wt-fg hover:underline disabled:opacity-40"
              onClick={() => {
                const at = new Date().toISOString();
                update((d) => ({ ...d, notes: [...d.notes, { id: crypto.randomUUID().slice(0, 12), text: noteText.trim(), createdAt: at, updatedAt: at }] }));
                setNoteText('');
              }}
            >
              [+ ADD NOTE]
            </button>
          </div>
          <ul className="divide-y divide-wt-line">
            {[...draft.notes].reverse().map((n) => (
              <li key={n.id} className="px-2 py-1.5 text-xs">
                <div className="flex items-center gap-2 text-2xs text-wt-fg-dim">
                  <span className="tabular-nums">{formatUtc(n.createdAt)}</span>
                  <button
                    className="ml-auto hover:text-wt-crit"
                    aria-label="Delete note"
                    onClick={() => update((d) => ({ ...d, notes: d.notes.filter((x) => x.id !== n.id) }))}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
                <p className="whitespace-pre-wrap">{n.text}</p>
              </li>
            ))}
          </ul>
        </Panel>

        <div className="space-y-1.5">
          {/* Linked incidents */}
          <Panel title="Linked dossiers" designator="L1">
            <div className="space-y-1 p-2 text-2xs">
              {draft.linkedIncidentIds.map((lid) => {
                const o = others.find((x) => x.id === lid);
                return (
                  <div key={lid} className="flex items-center gap-1.5">
                    {o ? <Link to={`/dossiers/${lid}`} className="text-wt-info hover:underline">{o.title}</Link> : <span className="text-wt-fg-dim">{lid} (deleted)</span>}
                    <button
                      className="ml-auto text-wt-fg-dim hover:text-wt-crit"
                      aria-label="Unlink dossier"
                      onClick={() => update({ linkedIncidentIds: draft.linkedIncidentIds.filter((x) => x !== lid) })}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                );
              })}
              <select
                aria-label="Link another dossier"
                className={`${field} h-6 w-full text-2xs`}
                value=""
                onChange={(e) => e.target.value && update({ linkedIncidentIds: [...draft.linkedIncidentIds, e.target.value] })}
              >
                <option value="">+ link another dossier…</option>
                {others.filter((o) => !draft.linkedIncidentIds.includes(o.id)).map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
              </select>
            </div>
          </Panel>

          {/* Export & delete */}
          <Panel title="Export & manage" designator="X1">
            <div className="space-y-1.5 p-2 text-2xs">
              <p className="text-wt-fg-dim">
                Export the dossier as a Markdown evidence packet (sources, timeline, assessments, notes, caveats), ready to paste into Claude.
                Unsaved changes are included.
              </p>
              <button
                className="text-wt-fg hover:underline"
                onClick={async () => {
                  const md = incidentToMarkdown(draft, new Date().toISOString());
                  setExported(md);
                  try {
                    await navigator.clipboard.writeText(md);
                  } catch {
                    /* clipboard may be unavailable; text is shown below */
                  }
                }}
              >
                [COPY AS MARKDOWN]
              </button>
              {exported && (
                <textarea aria-label="Markdown export" readOnly rows={6} value={exported} className={`${field} block w-full py-1 font-mono text-2xs`} />
              )}
              <div className="border-t border-wt-line pt-1.5">
                {confirmDelete ? (
                  <span className="flex gap-2">
                    <button
                      className="text-wt-crit hover:underline"
                      onClick={async () => {
                        try {
                          await svc!.deleteIncident(draft.id);
                          navigate('/dossiers');
                        } catch (e) {
                          setError(e instanceof Error ? e.message : String(e));
                        }
                      }}
                    >
                      [CONFIRM: DELETE PERMANENTLY]
                    </button>
                    <button className="text-wt-fg-muted" onClick={() => setConfirmDelete(false)}>[KEEP]</button>
                  </span>
                ) : (
                  <button className="text-wt-fg-muted hover:text-wt-crit" onClick={() => setConfirmDelete(true)}>[DELETE DOSSIER]</button>
                )}
              </div>
            </div>
          </Panel>
        </div>
      </div>
      </fieldset>
    </div>
  );
}
