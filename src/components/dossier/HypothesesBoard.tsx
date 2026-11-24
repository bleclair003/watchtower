import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { Incident } from '@shared/domain/incidents/types';
import {
  buildBoard,
  HYPOTHESIS_LIMITS,
  MARK_LABEL,
  MARKS,
  newHypothesisId,
  removeHypothesis,
  setMark,
  type Mark,
} from '@shared/domain/incidents/hypotheses';
import { Panel } from '../ui/Panel';
import { Tag } from '../ui/Tag';

const field = 'border border-wt-line-strong bg-wt-bg px-1.5 text-xs text-wt-fg focus:border-wt-info focus:outline-none';
const MARK_TONE: Record<Mark, string> = {
  CC: 'text-wt-fg',
  C: 'text-wt-fg',
  N: 'text-wt-fg-muted',
  I: 'text-wt-warn',
  II: 'text-wt-crit',
};

const originLabel = (o: string) => o.slice(o.indexOf(':') + 1);

/**
 * Competing hypotheses (v0.81.0): explanations in columns, evidence in rows, each record marked against
 * each explanation; ranked by the evidence against each, one origin counted once.
 */
export function HypothesesBoard({ incident, onChange }: { incident: Incident; onChange: (f: (d: Incident) => Incident) => void }) {
  const [newLabel, setNewLabel] = useState('');
  const hs = incident.hypotheses ?? [];
  const board = buildBoard(incident);
  const notDiagnostic = new Set(board.notDiagnostic);
  const maxAgainst = Math.max(1, ...board.ranking.map((s) => s.against));
  const add = () => {
    const label = newLabel.trim().slice(0, HYPOTHESIS_LIMITS.label);
    if (!label || hs.length >= HYPOTHESIS_LIMITS.hypotheses) return;
    onChange((d) => ({ ...d, hypotheses: [...(d.hypotheses ?? []), { id: newHypothesisId(), label, note: '' }] }));
    setNewLabel('');
  };
  const editHyp = (id: string, patch: { label?: string; note?: string }) =>
    onChange((d) => ({ ...d, hypotheses: (d.hypotheses ?? []).map((h) => (h.id === id ? { ...h, ...patch } : h)) }));

  return (
    <Panel title={`Competing hypotheses (${hs.length})`} designator="H1">
      <p className="border-b border-wt-line px-2 py-1 text-2xs text-wt-fg-dim">
        List the possible explanations, then mark each record against each one. The ranking counts the evidence <em>against</em> each explanation (inconsistent 1, very
        inconsistent 2), because evidence that fits one explanation often fits the others too. Records with the same origin (the same agency credited, or the same source)
        count once. Marks are your judgements; the board only adds them up.
      </p>

      {/* Explanations */}
      <ul className="divide-y divide-wt-line" aria-label="Explanations">
        {hs.map((h, k) => (
          <li key={h.id} className="flex flex-wrap items-center gap-1.5 px-2 py-1 text-2xs">
            <span className="w-5 text-wt-fg-dim">H{k + 1}</span>
            <input
              aria-label={`Explanation H${k + 1}`}
              className={`${field} h-6 min-w-40 flex-1`}
              maxLength={HYPOTHESIS_LIMITS.label}
              value={h.label}
              onChange={(e) => editHyp(h.id, { label: e.target.value })}
            />
            <input
              aria-label={`Note for H${k + 1}`}
              className={`${field} h-6 min-w-40 flex-[2]`}
              maxLength={HYPOTHESIS_LIMITS.note}
              placeholder="What would have to be true?"
              value={h.note}
              onChange={(e) => editHyp(h.id, { note: e.target.value })}
            />
            <button aria-label={`Remove H${k + 1}`} className="text-wt-fg-dim hover:text-wt-crit" onClick={() => onChange((d) => removeHypothesis(d, h.id))}>
              <Trash2 size={11} />
            </button>
          </li>
        ))}
      </ul>
      {hs.length < HYPOTHESIS_LIMITS.hypotheses && (
        <form
          className="flex gap-1.5 border-t border-wt-line px-2 py-1"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input
            aria-label="New explanation"
            className={`${field} h-6 flex-1 text-2xs`}
            maxLength={HYPOTHESIS_LIMITS.label}
            placeholder="e.g. Accident (anchor drag), Sabotage, Scheduled maintenance"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
          />
          <button type="submit" disabled={!newLabel.trim()} className="text-2xs text-wt-fg hover:underline disabled:opacity-40">
            [+ ADD EXPLANATION]
          </button>
        </form>
      )}

      {hs.length > 0 && incident.evidence.length > 0 && (
        <>
          {/* Matrix */}
          <div className="overflow-x-auto border-t border-wt-line" tabIndex={0} role="region" aria-label="Evidence against explanations">
            <table className="w-full text-2xs">
              <thead className="text-wt-fg-dim">
                <tr className="border-b border-wt-line">
                  <th className="px-2 py-1 text-left font-normal">Evidence</th>
                  {hs.map((h, k) => (
                    <th key={h.id} className="min-w-28 px-1 py-1 text-left font-normal" title={h.label}>
                      H{k + 1} <span className="text-wt-fg-muted">{h.label.slice(0, 24)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {incident.evidence.map((l) => (
                  <tr key={l.event.eventId} className="border-b border-wt-line align-top last:border-0">
                    <td className="max-w-72 px-2 py-1">
                      <p className="line-clamp-2">{l.event.title}</p>
                      <p className="text-wt-fg-dim">
                        {l.event.sourceName} · {l.assessment}
                        {notDiagnostic.has(l.event.eventId) && <span className="text-wt-warn"> · not diagnostic</span>}
                      </p>
                    </td>
                    {hs.map((h, k) => {
                      const m = l.marks?.[h.id];
                      return (
                        <td key={h.id} className="px-1 py-1">
                          <select
                            aria-label={`Mark against H${k + 1}`}
                            title={m ? MARK_LABEL[m.m] : 'Not marked'}
                            className={`${field} h-5 w-full text-2xs ${m ? MARK_TONE[m.m] : ''}`}
                            value={m?.m ?? ''}
                            onChange={(e) => {
                              const v = e.target.value as Mark | '';
                              onChange((d) => setMark(d, l.event.eventId, h.id, v ? { m: v, why: m?.why ?? '' } : null));
                            }}
                          >
                            <option value="">—</option>
                            {MARKS.map((x) => (
                              <option key={x} value={x}>
                                {x}
                              </option>
                            ))}
                          </select>
                          {m && (
                            <input
                              aria-label={`Why, against H${k + 1}`}
                              className={`${field} mt-0.5 h-5 w-full text-2xs`}
                              maxLength={HYPOTHESIS_LIMITS.why}
                              placeholder="why"
                              value={m.why}
                              onChange={(e) => onChange((d) => setMark(d, l.event.eventId, h.id, { m: m.m, why: e.target.value }))}
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-wt-line px-2 py-1 text-2xs text-wt-fg-dim">
            {MARKS.map((x) => `${x} ${MARK_LABEL[x].toLowerCase()}`).join(' · ')}
          </p>

          {/* Ranking */}
          <div className="border-t border-wt-line px-2 py-1.5 text-2xs">
            <h3 className="text-wt-fg-dim">RANKING · least evidence against first</h3>
            <ol aria-label="Hypothesis ranking" className="mt-1 space-y-1">
              {board.ranking.map((s, k) => (
                <li key={s.id} className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-2">
                  <span className="tabular-nums text-wt-fg-dim">{k + 1}.</span>
                  <div className="min-w-0">
                    <p className="truncate">
                      {s.label} {k === 0 && !board.tied && s.marked > 0 && <Tag tone="ok">LEAST AGAINST</Tag>}
                    </p>
                    <div className="mt-0.5 h-1.5 bg-wt-line" aria-hidden>
                      <div className="h-full bg-wt-warn" style={{ width: `${(s.against / maxAgainst) * 100}%` }} />
                    </div>
                  </div>
                  <span className="tabular-nums text-wt-fg-muted">
                    against {s.against}
                    {s.againstWeak > 0 && <span className="text-wt-warn"> ({s.againstWeak} weak)</span>} · for {s.support} · {s.marked} marked
                  </span>
                </li>
              ))}
            </ol>
            <ul className="mt-1.5 space-y-0.5 text-wt-fg-muted">
              {board.tied && <li className="text-wt-warn">The top two are tied on evidence against: nothing separates them yet.</li>}
              {board.leaderChangesOnConfirmed && (
                <li className="text-wt-warn">On evidence you assessed as confirmed only, the leader is “{board.confirmedRanking[0].label}”: the ranking rests on unconfirmed or disputed records.</li>
              )}
              {board.notDiagnostic.length > 0 && <li>{board.notDiagnostic.length} record(s) are marked the same for every explanation, so they do not help choose.</li>}
              {board.unmarked.length > 0 && <li>{board.unmarked.length} record(s) are not marked yet.</li>}
              {board.sharedOrigins.length > 0 && (
                <li>Counted once: {board.sharedOrigins.map(([o, n]) => `${originLabel(o)} (${n} records)`).join(', ')}.</li>
              )}
              <li className="text-wt-fg-dim">“Weak” is evidence against that rests on records you marked unconfirmed or disputed, or that are single-source, unverified or experimental.</li>
            </ul>
          </div>
        </>
      )}
      {hs.length > 0 && incident.evidence.length === 0 && <p className="border-t border-wt-line px-2 py-1.5 text-2xs text-wt-fg-muted">Add evidence to the dossier to mark it against these explanations.</p>}
    </Panel>
  );
}
