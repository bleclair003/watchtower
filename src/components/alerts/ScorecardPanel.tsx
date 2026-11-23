import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import {
  MIN_REVIEWED,
  MISSED_NOTE_MAX,
  MISSED_TITLE_MAX,
  NOISY_MIN,
  NOISY_PRECISION,
  pct,
  validateMissed,
  type MissedIncident,
  type MissedKind,
  type Scorecard,
  type Share,
} from '@shared/domain/alerts/scorecard';
import { FEEDBACK_LABEL, FEEDBACK_VERDICTS } from '@shared/domain/alerts/types';
import { EVENT_CATEGORIES, type EventCategory } from '@shared/domain/types';
import { getRegion, WATCH_REGIONS } from '@shared/domain/regions';
import { formatUtc } from '../../lib/time';
import { safeExternalUrl } from '../../lib/sanitize';
import { SEVERITY_TONE } from '../../config/alerts';
import { Tag } from '../ui/Tag';
import { VERDICT_TONE } from './FeedbackControls';

const of = (s: Share) => (s.of ? `${s.n} of ${s.of}` : 'none yet');
const regionCode = (id: string) => (id === 'none' ? 'NO REGION' : getRegion(id)?.shortCode ?? id);

function Stat({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: 'ok' | 'warn' | 'crit' }) {
  const color = tone === 'crit' ? 'text-wt-crit' : tone === 'warn' ? 'text-wt-warn' : tone === 'ok' ? 'text-wt-fg' : 'text-wt-fg';
  return (
    <div className="min-w-0 border border-wt-line px-2 py-1.5">
      <div className="text-2xs tracking-widest text-wt-fg-dim">{label}</div>
      <div className={`text-lg tabular-nums ${color}`}>{value}</div>
      <div className="text-2xs text-wt-fg-muted">{detail}</div>
    </div>
  );
}

/** One horizontal bar split by verdict, with a legend that carries the numbers. */
function VerdictBar({ sc }: { sc: Scorecard }) {
  const total = sc.reviewed.n;
  if (!total) return null;
  const fill: Record<string, string> = { ok: 'bg-wt-fg', muted: 'bg-wt-fg-dim', crit: 'bg-wt-crit', warn: 'bg-wt-warn' };
  return (
    <div className="space-y-1">
      <div className="flex h-2.5 gap-0.5" aria-hidden="true">
        {FEEDBACK_VERDICTS.filter((v) => sc.verdicts[v]).map((v) => (
          <span key={v} className={fill[VERDICT_TONE[v]]} style={{ flex: sc.verdicts[v] }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5 text-2xs">
        {FEEDBACK_VERDICTS.map((v) => (
          <Tag key={v} tone={VERDICT_TONE[v]}>
            {FEEDBACK_LABEL[v].toUpperCase()} {sc.verdicts[v]}
          </Tag>
        ))}
      </div>
    </div>
  );
}

const blank = (): MissedIncident => {
  const t = new Date().toISOString();
  return {
    id: '',
    title: '',
    occurredAt: t.slice(0, 16) + 'Z',
    kind: 'missed',
    lateHours: null,
    regionIds: [],
    category: 'military',
    url: '',
    note: '',
    createdAt: t,
    updatedAt: t,
    version: 0,
  };
};

function MissedForm({ initial, onSave, onCancel }: { initial: MissedIncident; onSave: (m: MissedIncident) => Promise<void>; onCancel: () => void }) {
  const [m, setM] = useState<MissedIncident>(initial);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof MissedIncident>(k: K, v: MissedIncident[K]) => setM((x) => ({ ...x, [k]: v }));
  const input = 'h-6 border border-wt-line-strong bg-wt-bg px-1 text-2xs';
  const submit = async () => {
    const now = Date.now();
    const iso = new Date(now).toISOString();
    const next: MissedIncident = {
      ...m,
      title: m.title.trim(),
      url: m.url.trim(),
      note: m.note.trim(),
      id: m.id || `m-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      updatedAt: iso,
      createdAt: m.version ? m.createdAt : iso,
      version: m.version + 1,
    };
    const p = validateMissed(next, now);
    setProblems(p);
    if (p.length) return;
    setBusy(true);
    try {
      await onSave(next);
    } catch (e) {
      setProblems([e instanceof Error ? e.message : String(e)]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="space-y-1.5 border-b border-wt-line px-2 py-2 text-2xs"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label className="flex flex-col gap-0.5">
        <span className="text-wt-fg-dim">WHAT HAPPENED</span>
        <input className={input} value={m.title} maxLength={MISSED_TITLE_MAX} onChange={(e) => set('title', e.target.value)} required />
      </label>
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-wt-fg-dim">WHEN (UTC)</span>
          <input
            type="datetime-local"
            className={input}
            value={m.occurredAt.slice(0, 16)}
            onChange={(e) => set('occurredAt', e.target.value ? `${e.target.value.slice(0, 16)}Z` : '')}
          />
        </label>
        <fieldset className="flex flex-col gap-0.5">
          <legend className="text-wt-fg-dim">WATCHTOWER</legend>
          <span className="flex h-6 items-center gap-2">
            {(['missed', 'late'] as MissedKind[]).map((k) => (
              <label key={k} className="flex items-center gap-1">
                <input type="radio" name="missed-kind" checked={m.kind === k} onChange={() => setM((x) => ({ ...x, kind: k, lateHours: k === 'missed' ? null : x.lateHours }))} />
                {k === 'missed' ? 'MISSED IT' : 'CAUGHT IT LATE'}
              </label>
            ))}
          </span>
        </fieldset>
        {m.kind === 'late' && (
          <label className="flex flex-col gap-0.5">
            <span className="text-wt-fg-dim">HOURS LATE</span>
            <input
              type="number"
              min={0.1}
              step={0.1}
              className={`${input} w-20`}
              value={m.lateHours ?? ''}
              onChange={(e) => set('lateHours', e.target.value === '' ? null : Number(e.target.value))}
            />
          </label>
        )}
        <label className="flex flex-col gap-0.5">
          <span className="text-wt-fg-dim">CATEGORY</span>
          <select className={input} value={m.category} onChange={(e) => set('category', e.target.value as EventCategory)}>
            {EVENT_CATEGORIES.map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
          </select>
        </label>
      </div>
      <fieldset className="flex flex-wrap items-center gap-2">
        <legend className="mb-0.5 text-wt-fg-dim">REGIONS</legend>
        {WATCH_REGIONS.map((r) => (
          <label key={r.id} className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={m.regionIds.includes(r.id)}
              onChange={(e) => set('regionIds', e.target.checked ? [...m.regionIds, r.id] : m.regionIds.filter((x) => x !== r.id))}
            />
            {r.shortCode}
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-0.5">
        <span className="text-wt-fg-dim">WHERE YOU LEARNED OF IT (LINK, OPTIONAL)</span>
        <input className={input} value={m.url} maxLength={500} placeholder="https://" onChange={(e) => set('url', e.target.value)} />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-wt-fg-dim">NOTE (OPTIONAL): which source would have caught it?</span>
        <textarea className="border border-wt-line-strong bg-wt-bg px-1 text-2xs" rows={2} maxLength={MISSED_NOTE_MAX} value={m.note} onChange={(e) => set('note', e.target.value)} />
      </label>
      {problems.length > 0 && <p role="alert" className="text-wt-crit">{problems.join(' ')}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="border border-wt-fg px-2 text-wt-fg hover:bg-wt-fg hover:text-wt-bg disabled:opacity-50">
          {m.version ? 'SAVE CHANGES' : 'LOG IT'}
        </button>
        <button type="button" onClick={onCancel} className="text-wt-fg-muted hover:text-wt-fg">[CANCEL]</button>
      </div>
    </form>
  );
}

/**
 * The alert scorecard (v0.67.0): how many alerts were reviewed and what they turned out to be, per
 * rule and level; incidents WATCHTOWER missed or caught late; and how reliably the collector ran.
 */
export function ScorecardPanel({
  scorecard: sc,
  missed,
  canEdit,
  simulated = false,
  onSaveMissed,
  onDeleteMissed,
}: {
  scorecard: Scorecard;
  missed: MissedIncident[];
  canEdit: boolean;
  simulated?: boolean;
  onSaveMissed?: (m: MissedIncident) => Promise<void>;
  onDeleteMissed?: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<MissedIncident | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const thin = !sc.enoughReviews;
  const fpTone = sc.falsePositive.share != null && sc.falsePositive.share >= 0.2 ? 'crit' : undefined;
  const inWindow = missed.filter((m) => m.occurredAt >= sc.since);
  const canWrite = canEdit && !simulated && !!onSaveMissed;

  return (
    <div className="text-xs">
      <div className="border-b border-wt-line px-2 py-1.5 text-2xs text-wt-fg-muted">
        Last {sc.windowDays} days, since {formatUtc(sc.since)}. Built from the verdicts you and your editors give in the inbox and the incidents logged below.
        {simulated && <span className="text-wt-warn"> [SIMULATED] Demo numbers, not real alerts.</span>}
        {sc.capped && <span className="text-wt-warn"> Only the newest {sc.alerts} alerts were loaded.</span>}
        {thin && (
          <span className="text-wt-warn">
            {' '}Fewer than {MIN_REVIEWED} reviewed alerts: the shares below are too few to judge.
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-1.5 p-2 sm:grid-cols-4">
        <Stat label="REVIEWED" value={pct(sc.reviewed)} detail={`${of(sc.reviewed)} alerts`} />
        <Stat label="USEFUL" value={pct(sc.useful)} detail={`${of(sc.useful)} reviewed`} tone={thin ? undefined : 'ok'} />
        <Stat label="FALSE POSITIVES" value={pct(sc.falsePositive)} detail={`${of(sc.falsePositive)} reviewed`} tone={fpTone} />
        <Stat label="WARNING + CRITICAL USEFUL" value={pct(sc.highUseful)} detail={`${of(sc.highUseful)} reviewed`} />
      </div>
      <div className="px-2 pb-2"><VerdictBar sc={sc} /></div>

      <section className="border-t border-wt-line">
        <h3 className="px-2 pt-1.5 text-2xs tracking-widest text-wt-fg-dim">BY LEVEL</h3>
        <table className="w-full text-2xs tabular-nums">
          <thead className="text-wt-fg-dim">
            <tr><th className="px-2 py-1 text-left font-normal">LEVEL</th><th className="px-2 text-right font-normal">REVIEWED</th><th className="px-2 text-right font-normal">USEFUL</th></tr>
          </thead>
          <tbody>
            {sc.bySeverity.map((s) => (
              <tr key={s.severity} className="border-t border-wt-line">
                <td className="px-2 py-1"><Tag tone={SEVERITY_TONE[s.severity]}>{s.severity}</Tag></td>
                <td className="px-2 text-right">{s.reviewed}</td>
                <td className="px-2 text-right">{pct(s.useful)} <span className="text-wt-fg-dim">({of(s.useful)})</span></td>
              </tr>
            ))}
            {sc.bySeverity.length === 0 && <tr><td colSpan={3} className="px-2 py-1 text-wt-fg-muted">No alerts in the window.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="border-t border-wt-line">
        <h3 className="px-2 pt-1.5 text-2xs tracking-widest text-wt-fg-dim">BY RULE</h3>
        <p className="px-2 text-2xs text-wt-fg-dim">
          A rule is flagged NOISY with {NOISY_MIN}+ reviews and under {Math.round(NOISY_PRECISION * 100)}% useful. Versions are the rule versions that made these alerts.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-2xs tabular-nums">
            <thead className="text-wt-fg-dim">
              <tr>
                <th className="px-2 py-1 text-left font-normal">RULE</th>
                <th className="px-2 text-right font-normal">ALERTS</th>
                <th className="px-2 text-right font-normal">REVIEWED</th>
                <th className="px-2 text-right font-normal">USEFUL</th>
                <th className="px-2 text-right font-normal">IRREL.</th>
                <th className="px-2 text-right font-normal">FALSE +</th>
                <th className="px-2 text-right font-normal">WRONG CAT.</th>
              </tr>
            </thead>
            <tbody>
              {sc.rules.map((r) => (
                <tr key={r.ruleId} className="border-t border-wt-line">
                  <td className="px-2 py-1">
                    {r.ruleName} <span className="text-wt-fg-dim">v{r.versions.join(', v')}</span> {r.noisy && <Tag tone="warn">NOISY</Tag>}
                  </td>
                  <td className="px-2 text-right">{r.alerts}</td>
                  <td className="px-2 text-right">{r.reviewed}</td>
                  <td className="px-2 text-right">{r.verdicts.useful} <span className="text-wt-fg-dim">{pct(r.useful)}</span></td>
                  <td className="px-2 text-right">{r.verdicts.irrelevant}</td>
                  <td className="px-2 text-right">{r.verdicts['false-positive']}</td>
                  <td className="px-2 text-right">{r.verdicts.miscategorised}</td>
                </tr>
              ))}
              {sc.rules.length === 0 && <tr><td colSpan={7} className="px-2 py-1 text-wt-fg-muted">No alerts in the window.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="border-t border-wt-line">
        <div className="flex flex-wrap items-center gap-2 px-2 pt-1.5">
          <h3 className="text-2xs tracking-widest text-wt-fg-dim">MISSED OR LATE</h3>
          <span className="text-2xs text-wt-fg-muted">
            {sc.missed.missed} missed · {sc.missed.late} late
            {sc.missed.medianLateHours != null && ` · median ${sc.missed.medianLateHours.toFixed(1)} h late`}
          </span>
          {canWrite && !editing && (
            <button className="ml-auto text-2xs text-wt-fg hover:underline" onClick={() => setEditing(blank())}>[+ LOG A MISSED INCIDENT]</button>
          )}
        </div>
        <p className="px-2 text-2xs text-wt-fg-dim">
          Something happened that WATCHTOWER should have flagged and did not, or flagged hours after you heard? Log it here so gaps in sources and rules show up.
        </p>
        {(sc.missed.byRegion.length > 0 || sc.missed.byCategory.length > 0) && (
          <div className="flex flex-wrap gap-1.5 px-2 pt-1 text-2xs">
            {sc.missed.byRegion.map((r) => <Tag key={r.regionId}>{regionCode(r.regionId)} {r.count}</Tag>)}
            {sc.missed.byCategory.map((c) => <Tag key={c.category} tone="info">{c.category.toUpperCase()} {c.count}</Tag>)}
          </div>
        )}
        {editing && (
          <MissedForm
            key={editing.id || 'new'}
            initial={editing}
            onCancel={() => setEditing(null)}
            onSave={async (m) => {
              await onSaveMissed!(m);
              setEditing(null);
            }}
          />
        )}
        <ul className="divide-y divide-wt-line">
          {inWindow.map((m) => {
            const url = safeExternalUrl(m.url);
            return (
              <li key={m.id} className="px-2 py-1.5 text-2xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Tag tone={m.kind === 'missed' ? 'crit' : 'warn'}>{m.kind === 'missed' ? 'MISSED' : `LATE ${m.lateHours} H`}</Tag>
                  <span className="text-xs">{m.title}</span>
                  <span className="text-wt-fg-muted">{formatUtc(m.occurredAt)}</span>
                  {m.regionIds.map((r) => <Tag key={r}>{regionCode(r)}</Tag>)}
                  <Tag tone="info">{m.category.toUpperCase()}</Tag>
                  {canWrite && (
                    <span className="ml-auto flex gap-2">
                      <button className="text-wt-fg-muted hover:text-wt-fg" onClick={() => setEditing(m)}>[EDIT]</button>
                      {confirmDelete === m.id ? (
                        <>
                          <button className="text-wt-crit hover:underline" onClick={() => void onDeleteMissed?.(m.id).then(() => setConfirmDelete(null))}>[CONFIRM DELETE]</button>
                          <button className="text-wt-fg-muted" onClick={() => setConfirmDelete(null)}>[KEEP]</button>
                        </>
                      ) : (
                        <button className="text-wt-fg-muted hover:text-wt-crit" onClick={() => setConfirmDelete(m.id)}>[DELETE]</button>
                      )}
                    </span>
                  )}
                </div>
                {m.note && <p className="mt-0.5 text-wt-fg-muted">{m.note}</p>}
                {url && (
                  <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-wt-info hover:underline">
                    SOURCE <ExternalLink size={10} />
                  </a>
                )}
              </li>
            );
          })}
          {inWindow.length === 0 && !editing && <li className="px-2 py-1.5 text-2xs text-wt-fg-muted">Nothing logged in the window.</li>}
        </ul>
      </section>

      <section className="border-t border-wt-line">
        <h3 className="px-2 pt-1.5 text-2xs tracking-widest text-wt-fg-dim">COLLECTOR RELIABILITY</h3>
        {sc.runs ? (
          <div className="space-y-1 px-2 py-1.5 text-2xs">
            <p>
              {sc.runs.count} runs in the last {sc.runs.days} days ({sc.runs.expected} scheduled hourly) ·{' '}
              <span className="tabular-nums">{pct(sc.runs.clean)}</span> with every source answering ({of(sc.runs.clean)})
            </p>
            {sc.runs.failingSources.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-wt-fg-dim">MOST FAILED RUNS:</span>
                {sc.runs.failingSources.map((s) => <Tag key={s.sourceId} tone="warn">{s.sourceId} {s.runs}</Tag>)}
              </div>
            )}
          </div>
        ) : (
          <p className="px-2 py-1.5 text-2xs text-wt-fg-muted">Run history not loaded.</p>
        )}
      </section>
    </div>
  );
}
