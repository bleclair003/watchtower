import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { CONDITION_FIELDS, describeCondition, type Condition, type ConditionField, type Leaf, type Operator } from '@shared/domain/indicators/conditions';
import { INDICATOR_CATALOG } from '@shared/domain/indicators/catalog';
import type { IndicatorState } from '@shared/domain/indicators/types';
import { WATCH_REGIONS } from '@shared/domain/regions';
import { SOURCE_REGISTRY } from '@shared/domain/sources';
import { CREDIBILITY_LEVELS, EVENT_CATEGORIES } from '@shared/domain/types';
import { ALERT_SEVERITIES, type AlertRule, type AlertSeverity } from '@shared/domain/alerts/types';
import { previewRule, validateAlertRule } from '@shared/domain/alerts/evaluate';
import { useData } from '../../state/DataContext';
import { Tag } from '../ui/Tag';

type Kind = AlertRule['trigger']['kind'];
interface Row { field: ConditionField; op: Operator; value: string; negate: boolean }

const OPS: Operator[] = ['eq', 'neq', 'in', 'contains', 'gte', 'lte', 'exists'];
const NUMERIC = new Set<ConditionField>(['metadata.advisoryLevel', 'metadata.previousLevel', 'metadata.magnitude']);
const BOOLEAN = new Set<ConditionField>(['metadata.routine', 'metadata.knownRansomwareUse']);
const SUGGESTIONS: Partial<Record<ConditionField, string[]>> = {
  regionIds: WATCH_REGIONS.map((r) => r.id),
  category: [...EVENT_CATEGORIES],
  credibility: [...CREDIBILITY_LEVELS],
  sourceId: SOURCE_REGISTRY.map((s) => s.id),
  sourceClass: ['official', 'media', 'aggregator', 'scientific'],
  'metadata.change': ['raised', 'lowered', 'new', 'reissued', 'initial'],
  'metadata.subtype': ['alert', 'joint-advisory', 'analysis-report', 'ics-advisory', 'kev-announcement', 'guidance', 'internet-outage', 'thermal-anomaly-cluster'],
  'metadata.seismicType': ['earthquake', 'explosion', 'nuclear explosion', 'quarry blast'],
  'metadata.alertLevel': ['Green', 'Orange', 'Red'],
  'metadata.outageCause': ['GOVERNMENT_DIRECTED', 'MILITARY_ACTION', 'CABLE_CUT', 'POWER_OUTAGE', 'CYBERATTACK', 'NATURAL_DISASTER', 'TECHNICAL_PROBLEM', 'UNKNOWN'],
  'metadata.routine': ['true', 'false'],
  'metadata.knownRansomwareUse': ['true', 'false'],
  locationPrecision: ['exact', 'city', 'country', 'region', 'none'],
};
const WATCHABLE_STATES: IndicatorState[] = ['TRIGGERED', 'ELEVATED', 'UNKNOWN', 'DATA_UNAVAILABLE'];

function parseValue(field: ConditionField, op: Operator, raw: string): Leaf['value'] {
  const v = raw.trim();
  if (op === 'exists') return undefined;
  if (op === 'gte' || op === 'lte') return Number(v);
  if (op === 'in') return v.split(',').map((x) => x.trim()).filter(Boolean).map((x) => (NUMERIC.has(field) ? Number(x) : x));
  if (BOOLEAN.has(field)) return v === 'true';
  if (NUMERIC.has(field)) return Number(v);
  return v;
}

function rowsToCondition(rows: Row[], combinator: 'all' | 'any'): Condition {
  const leaves: Condition[] = rows.map((r) => {
    const leaf: Leaf = { field: r.field, op: r.op, ...(r.op === 'exists' ? {} : { value: parseValue(r.field, r.op, r.value) }) };
    return r.negate ? { not: leaf } : leaf;
  });
  return leaves.length === 1 ? leaves[0] : ({ [combinator]: leaves } as Condition);
}

/** Inverse of rowsToCondition for flat conditions; null when the condition is nested (use JSON mode). */
function conditionToRows(c: Condition): { rows: Row[]; combinator: 'all' | 'any' } | null {
  const toRow = (x: Condition): Row | null => {
    const negate = 'not' in x;
    const leaf = negate ? (x as { not: Condition }).not : x;
    if ('all' in leaf || 'any' in leaf || 'not' in leaf) return null;
    const value = Array.isArray(leaf.value) ? leaf.value.join(', ') : leaf.value === undefined ? '' : String(leaf.value);
    return { field: leaf.field, op: leaf.op, value, negate };
  };
  const group = 'all' in c ? { k: 'all' as const, xs: c.all } : 'any' in c ? { k: 'any' as const, xs: c.any } : null;
  const rows = (group ? group.xs : [c]).map(toRow);
  return rows.every(Boolean) ? { rows: rows as Row[], combinator: group?.k ?? 'all' } : null;
}

const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 20);

const input = 'h-6 min-w-0 border border-wt-line-strong bg-wt-bg px-1.5 text-2xs text-wt-fg focus:border-wt-info focus:outline-none';

export interface RuleBuilderProps {
  initial: AlertRule | null;
  canSave: boolean;
  onSave: (rule: AlertRule) => Promise<void>;
  onCancel: () => void;
}

/** Graphical rule editor producing declarative JSON — never executable code. */
export function RuleBuilder({ initial, canSave, onSave, onCancel }: RuleBuilderProps) {
  const data = useData();
  const parsed = initial?.trigger.kind === 'event' ? conditionToRows(initial.trigger.match) : null;
  const [name, setName] = useState(initial?.name ?? '');
  const [severity, setSeverity] = useState<AlertSeverity>(initial?.severity ?? 'ADVISORY');
  const [kind, setKind] = useState<Kind>(initial?.trigger.kind ?? 'event');
  const [combinator, setCombinator] = useState<'all' | 'any'>(parsed?.combinator ?? 'all');
  const [rows, setRows] = useState<Row[]>(parsed?.rows ?? [{ field: 'regionIds', op: 'contains', value: 'red-sea', negate: false }]);
  const [jsonMode, setJsonMode] = useState(initial?.trigger.kind === 'event' && !parsed);
  const [json, setJson] = useState(initial?.trigger.kind === 'event' ? JSON.stringify(initial.trigger.match, null, 2) : '');
  const [indicatorIds, setIndicatorIds] = useState<string[]>(initial?.trigger.kind === 'indicator' ? initial.trigger.indicatorIds : []);
  const [states, setStates] = useState<IndicatorState[]>(initial?.trigger.kind === 'indicator' ? initial.trigger.states : ['TRIGGERED']);
  const [regionId, setRegionId] = useState(initial?.trigger.kind === 'rai' ? initial.trigger.regionId : 'middle-east');
  const [atLeast, setAtLeast] = useState(initial?.trigger.kind === 'rai' ? initial.trigger.atLeast : 40);
  const [discord, setDiscord] = useState(initial?.notify.discord ?? true);
  const [cooldown, setCooldown] = useState(initial?.cooldownMinutes ?? 60);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [ruleId] = useState(() => initial?.id ?? newId());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ matches: string[]; note: string } | null>(null);

  const { rule, jsonError } = useMemo(() => {
    let trigger: AlertRule['trigger'];
    let jsonError: string | null = null;
    if (kind === 'event') {
      let match: Condition = rowsToCondition(rows, combinator);
      if (jsonMode) {
        try {
          match = JSON.parse(json) as Condition;
        } catch (e) {
          jsonError = (e as Error).message;
        }
      }
      trigger = { kind: 'event', match };
    } else if (kind === 'indicator') {
      trigger = { kind: 'indicator', indicatorIds, states };
    } else {
      trigger = { kind: 'rai', regionId, atLeast: Math.round(atLeast) };
    }
    // Timestamps are stamped at save time (see save()); keep render pure.
    const rule: AlertRule = {
      id: ruleId,
      name: name.trim(),
      enabled,
      severity,
      trigger,
      notify: { discord },
      cooldownMinutes: Math.round(cooldown),
      version: (initial?.version ?? 0) + 1,
      createdAt: initial?.createdAt ?? '',
      updatedAt: initial?.updatedAt ?? '',
    };
    return { rule, jsonError };
  }, [kind, rows, combinator, jsonMode, json, indicatorIds, states, regionId, atLeast, name, enabled, severity, discord, cooldown, initial, ruleId]);

  const problems = jsonError ? [`JSON: ${jsonError}`] : validateAlertRule(rule);

  function updateRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setPreview(null);
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const now = new Date().toISOString();
      await onSave({ ...rule, createdAt: initial?.createdAt ?? now, updatedAt: now });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 p-2 text-xs">
      <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
        <label className="flex flex-col gap-0.5">
          <span className="text-2xs text-wt-fg-dim">RULE NAME</span>
          <input className={input} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Red Sea maritime official reports" />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-2xs text-wt-fg-dim">ALERT LEVEL</span>
          <select className={input} value={severity} onChange={(e) => setSeverity(e.target.value as AlertSeverity)}>
            {ALERT_SEVERITIES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label className="flex items-end gap-1.5 pb-1">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-[#6aff9b]" />
          <span className="text-2xs">ENABLED</span>
        </label>
      </div>

      <div role="radiogroup" aria-label="Trigger type" className="flex flex-wrap gap-1">
        {([
          ['event', 'NEW EVENT MATCHES'],
          ['indicator', 'INDICATOR CHANGES STATE'],
          ['rai', 'RAI CROSSES THRESHOLD'],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            role="radio"
            aria-checked={kind === k}
            onClick={() => { setKind(k); setPreview(null); }}
            className={`h-6 border px-2 text-2xs ${kind === k ? 'border-wt-info bg-wt-info/10 text-wt-info' : 'border-wt-line-strong text-wt-fg-muted hover:text-wt-fg'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {kind === 'event' && (
        <div className="space-y-1 border border-wt-line p-2">
          <div className="flex items-center gap-2 text-2xs">
            {!jsonMode && (
              <>
                <span className="text-wt-fg-dim">MATCH</span>
                <select className={input} value={combinator} onChange={(e) => setCombinator(e.target.value as 'all' | 'any')}>
                  <option value="all">ALL conditions</option>
                  <option value="any">ANY condition</option>
                </select>
              </>
            )}
            <button
              className="ml-auto text-wt-fg-muted hover:text-wt-fg"
              onClick={() => {
                if (!jsonMode) setJson(JSON.stringify(rowsToCondition(rows, combinator), null, 2));
                else {
                  try {
                    const back = conditionToRows(JSON.parse(json) as Condition);
                    if (!back) return setSaveError('Nested conditions can only be edited in JSON mode.');
                    setRows(back.rows);
                    setCombinator(back.combinator);
                  } catch {
                    return setSaveError('Fix the JSON before switching back.');
                  }
                }
                setSaveError(null);
                setJsonMode(!jsonMode);
              }}
            >
              [{jsonMode ? 'ROWS' : 'JSON'}]
            </button>
          </div>
          {jsonMode ? (
            <textarea
              aria-label="Condition JSON"
              value={json}
              onChange={(e) => { setJson(e.target.value); setPreview(null); }}
              spellCheck={false}
              rows={8}
              className="w-full border border-wt-line-strong bg-wt-bg p-1.5 font-mono text-2xs text-wt-fg focus:border-wt-info focus:outline-none"
            />
          ) : (
            rows.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-1">
                <label className="flex items-center gap-1 text-2xs text-wt-fg-muted">
                  <input type="checkbox" checked={r.negate} onChange={(e) => updateRow(i, { negate: e.target.checked })} className="accent-[#6aff9b]" />
                  NOT
                </label>
                <select aria-label="Field" className={input} value={r.field} onChange={(e) => updateRow(i, { field: e.target.value as ConditionField })}>
                  {(Object.keys(CONDITION_FIELDS) as ConditionField[]).map((f) => <option key={f}>{f}</option>)}
                </select>
                <select aria-label="Operator" className={input} value={r.op} onChange={(e) => updateRow(i, { op: e.target.value as Operator })}>
                  {OPS.map((o) => <option key={o}>{o}</option>)}
                </select>
                {r.op !== 'exists' && (
                  <>
                    <input
                      aria-label="Value"
                      className={`${input} w-56`}
                      value={r.value}
                      list={`values-${r.field}`}
                      onChange={(e) => updateRow(i, { value: e.target.value })}
                      placeholder={r.op === 'in' ? 'comma, separated' : 'value'}
                    />
                    <datalist id={`values-${r.field}`}>
                      {(SUGGESTIONS[r.field] ?? []).map((v) => <option key={v} value={v} />)}
                    </datalist>
                  </>
                )}
                <button aria-label="Remove condition" className="text-wt-fg-dim hover:text-wt-crit" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                  <Trash2 size={11} />
                </button>
              </div>
            ))
          )}
          {!jsonMode && (
            <button
              className="flex items-center gap-1 text-2xs text-wt-fg-muted hover:text-wt-fg"
              onClick={() => setRows((rs) => [...rs, { field: 'category', op: 'eq', value: '', negate: false }])}
            >
              <Plus size={10} /> ADD CONDITION
            </button>
          )}
          {!jsonError && rule.trigger.kind === 'event' && (
            <p className="text-2xs text-wt-fg-dim">
              Reads as: <span className="font-mono text-wt-info">{describeCondition(rule.trigger.match)}</span>
            </p>
          )}
        </div>
      )}

      {kind === 'indicator' && (
        <div className="space-y-1.5 border border-wt-line p-2 text-2xs">
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <span className="text-wt-fg-dim">FIRE WHEN ENTERING:</span>
            {WATCHABLE_STATES.map((s) => (
              <label key={s} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  className="accent-[#6aff9b]"
                  checked={states.includes(s)}
                  onChange={(e) => setStates((xs) => (e.target.checked ? [...xs, s] : xs.filter((x) => x !== s)))}
                />
                {s}
              </label>
            ))}
          </div>
          <div className="grid max-h-56 gap-x-4 overflow-y-auto md:grid-cols-2">
            {INDICATOR_CATALOG.filter((d) => !d.experimental).map((d) => (
              <label key={d.id} className="flex items-center gap-1.5 py-0.5">
                <input
                  type="checkbox"
                  className="accent-[#6aff9b]"
                  checked={indicatorIds.includes(d.id)}
                  onChange={(e) => setIndicatorIds((xs) => (e.target.checked ? [...xs, d.id] : xs.filter((x) => x !== d.id)))}
                />
                <span>{d.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {kind === 'rai' && (
        <div className="flex flex-wrap items-center gap-2 border border-wt-line p-2 text-2xs">
          <span className="text-wt-fg-dim">WHEN RAI FOR</span>
          <select className={input} value={regionId} onChange={(e) => setRegionId(e.target.value)}>
            {WATCH_REGIONS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <span className="text-wt-fg-dim">RISES TO AT LEAST</span>
          <input type="number" min={1} max={100} className={`${input} w-16`} value={atLeast} onChange={(e) => setAtLeast(Number(e.target.value))} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-2xs">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={discord} onChange={(e) => setDiscord(e.target.checked)} className="accent-[#6aff9b]" />
          NOTIFY DISCORD
        </label>
        <label className="flex items-center gap-1.5">
          COOLDOWN
          <input type="number" min={0} max={10080} className={`${input} w-20`} value={cooldown} onChange={(e) => setCooldown(Number(e.target.value))} />
          MIN
        </label>
        <span className="text-wt-fg-dim">Alerts are always recorded; the cooldown only limits Discord messages.</span>
      </div>

      {problems.length > 0 && (
        <ul className="border border-wt-warn/40 bg-wt-warn/5 p-1.5 text-2xs text-wt-warn">
          {problems.map((p) => <li key={p}>• {p}</li>)}
        </ul>
      )}
      {saveError && <p role="alert" className="text-2xs text-wt-crit">{saveError}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button
          disabled={problems.length > 0}
          onClick={() =>
            setPreview(
              previewRule(rule, { events: data.events, evaluations: data.indicatorEvaluations, scores: data.regionScores, now: Date.now(), lookbackHours: 168 }),
            )
          }
          className="h-6 border border-wt-info/60 px-2 text-2xs text-wt-info hover:bg-wt-info hover:text-wt-bg disabled:opacity-40"
        >
          TEST RULE
        </button>
        <button
          disabled={!canSave || saving || problems.length > 0}
          onClick={() => void save()}
          className="h-6 border border-wt-fg/60 px-2 text-2xs hover:bg-wt-fg hover:text-wt-bg disabled:opacity-40"
          title={canSave ? undefined : 'Saving rules requires a live backend'}
        >
          {saving ? 'SAVING…' : 'SAVE RULE'}
        </button>
        <button onClick={onCancel} className="text-2xs text-wt-fg-muted hover:text-wt-fg">[CANCEL]</button>
        {!canSave && <Tag tone="warn">SAVE DISABLED IN DEMO MODE</Tag>}
      </div>

      {preview && (
        <div className="border border-wt-info/40 bg-wt-info/5 p-2 text-2xs">
          <p className="mb-1 text-wt-info">
            TEST MODE: {preview.matches.length} match(es). No alert created, nothing sent.
          </p>
          <p className="mb-1 text-wt-fg-muted">{preview.note}</p>
          <ul className="max-h-40 space-y-0.5 overflow-y-auto">
            {preview.matches.slice(0, 50).map((m, i) => <li key={i}>• {m}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
