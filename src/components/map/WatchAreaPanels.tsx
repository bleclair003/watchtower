import { useState } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { ALERT_SEVERITIES, type AlertSeverity } from '@shared/domain/alerts/types';
import { EVENT_CATEGORIES, type EventCategory } from '@shared/domain/types';
import { describeShape, kmBetween, newAreaId, validateWatchArea, WATCH_AREA_LIMITS, type WatchArea, type WatchShape } from '@shared/domain/watchAreas';
import type { LonLat } from '../../lib/measure';
import { recentInside, type AreaContents } from '../../lib/areaContents';
import { Tag } from '../ui/Tag';
import { WATCH_AREA_COLOR } from './WorldMap';

export type DrawMode = 'circle' | 'polygon';

/** The shape so far from the clicks: a circle needs centre + edge; a polygon 3+ points and Finish. */
export function draftShape(mode: DrawMode, pts: LonLat[], finished: boolean): WatchShape | null {
  if (mode === 'circle' && pts.length >= 2) {
    const [c, edge] = pts;
    return { kind: 'circle', lat: Math.round(c[1] * 1e4) / 1e4, lon: Math.round(c[0] * 1e4) / 1e4, radiusKm: Math.max(0.5, Math.round(kmBetween(c[1], c[0], edge[1], edge[0]) * 10) / 10) };
  }
  if (mode === 'polygon' && finished && pts.length >= 3) return { kind: 'polygon', points: pts.map(([lo, la]) => [Math.round(lo * 1e4) / 1e4, Math.round(la * 1e4) / 1e4]) };
  return null;
}

const input = 'h-6 border border-wt-line-strong bg-wt-bg px-1 text-2xs';

/** Name, alert and note for an area (new or existing). */
export function AreaForm({ initial, onSave, onCancel, saveLabel }: { initial: WatchArea; onSave: (a: WatchArea) => Promise<void>; onCancel: () => void; saveLabel: string }) {
  const [a, setA] = useState<WatchArea>(initial);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const setAlert = (patch: Partial<WatchArea['alert']>) => setA((x) => ({ ...x, alert: { ...x.alert, ...patch } }));
  return (
    <form
      className="space-y-1.5"
      onSubmit={async (ev) => {
        ev.preventDefault();
        const next = { ...a, name: a.name.trim(), note: a.note.trim(), updatedAt: new Date().toISOString() };
        const p = validateWatchArea(next);
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
      }}
    >
      <p className="text-wt-fg-muted">{describeShape(a.shape)}</p>
      <label className="flex flex-col gap-0.5">
        <span className="text-wt-fg-dim">NAME</span>
        <input className={input} value={a.name} maxLength={WATCH_AREA_LIMITS.name} onChange={(e) => setA({ ...a, name: e.target.value })} autoFocus />
      </label>
      <label className="flex items-center gap-1.5">
        <input type="checkbox" checked={a.alert.enabled} onChange={(e) => setAlert({ enabled: e.target.checked })} />
        Alert on exactly located records inside
      </label>
      {a.alert.enabled && (
        <div className="space-y-1 border-l border-wt-line pl-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1">
              <span className="text-wt-fg-dim">LEVEL</span>
              <select className={input} value={a.alert.severity} onChange={(e) => setAlert({ severity: e.target.value as AlertSeverity })}>
                {ALERT_SEVERITIES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={a.alert.discord} onChange={(e) => setAlert({ discord: e.target.checked })} />
              Discord
            </label>
          </div>
          <fieldset className="flex flex-wrap gap-x-2 gap-y-0.5">
            <legend className="text-wt-fg-dim">CATEGORIES (NONE TICKED = ALL)</legend>
            {EVENT_CATEGORIES.map((c) => (
              <label key={c} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={a.alert.categories.includes(c)}
                  onChange={(e) => setAlert({ categories: e.target.checked ? [...a.alert.categories, c] : a.alert.categories.filter((x: EventCategory) => x !== c) })}
                />
                {c.toUpperCase()}
              </label>
            ))}
          </fieldset>
        </div>
      )}
      <label className="flex flex-col gap-0.5">
        <span className="text-wt-fg-dim">NOTE (OPTIONAL)</span>
        <textarea className="border border-wt-line-strong bg-wt-bg px-1 text-2xs" rows={2} maxLength={WATCH_AREA_LIMITS.note} value={a.note} onChange={(e) => setA({ ...a, note: e.target.value })} />
      </label>
      {problems.length > 0 && <p role="alert" className="text-wt-crit">{problems.join(' ')}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="border border-wt-fg px-2 text-wt-fg hover:bg-wt-fg hover:text-wt-bg disabled:opacity-50">
          {saveLabel}
        </button>
        <button type="button" onClick={onCancel} className="text-wt-fg-muted hover:text-wt-fg">[CANCEL]</button>
      </div>
    </form>
  );
}

/** Drawing a new area: mode, instructions, then the form. Sits under the map tools. */
export function AreaDrawPanel({
  mode,
  onMode,
  points,
  finished,
  onFinish,
  onUndo,
  onCancel,
  onSave,
  storage,
}: {
  mode: DrawMode;
  onMode: (m: DrawMode) => void;
  points: LonLat[];
  finished: boolean;
  onFinish: () => void;
  onUndo: () => void;
  onCancel: () => void;
  onSave: (a: WatchArea) => Promise<void>;
  storage: 'local' | 'cloud' | 'unavailable';
}) {
  const shape = draftShape(mode, points, finished);
  const now = Date.now();
  const btn = (on: boolean) => `border px-1.5 ${on ? 'border-wt-fg bg-wt-fg text-wt-bg' : 'border-wt-line-strong text-wt-fg-muted hover:text-wt-fg'}`;
  return (
    <div className="pointer-events-auto space-y-1 border border-wt-line-strong bg-wt-panel/95 px-2 py-1.5" role="dialog" aria-label="Draw a watch area">
      <div className="flex items-center gap-1.5">
        <span className="text-wt-fg-dim">NEW WATCH AREA</span>
        {!shape && (
          <>
            <button type="button" className={btn(mode === 'circle')} aria-pressed={mode === 'circle'} onClick={() => onMode('circle')}>CIRCLE</button>
            <button type="button" className={btn(mode === 'polygon')} aria-pressed={mode === 'polygon'} onClick={() => onMode('polygon')}>POLYGON</button>
          </>
        )}
        <button type="button" aria-label="Cancel drawing" className="ml-auto text-wt-fg-muted hover:text-wt-fg" onClick={onCancel}>
          <X size={11} />
        </button>
      </div>
      {!shape ? (
        <>
          <p className="text-wt-fg-muted">
            {mode === 'circle'
              ? points.length === 0
                ? 'Click the centre of the circle.'
                : 'Click the edge of the circle.'
              : points.length < 3
                ? `Click the corners (${points.length} so far, 3–${WATCH_AREA_LIMITS.points}).`
                : `${points.length} corners. Click more, or finish.`}
          </p>
          <div className="flex gap-2">
            {mode === 'polygon' && points.length >= 3 && (
              <button type="button" className="border border-wt-fg px-2 text-wt-fg hover:bg-wt-fg hover:text-wt-bg" onClick={onFinish}>FINISH</button>
            )}
            {points.length > 0 && (
              <button type="button" className="text-wt-fg-muted hover:text-wt-fg" onClick={onUndo}>[UNDO POINT]</button>
            )}
          </div>
        </>
      ) : (
        <AreaForm
          key={JSON.stringify(shape)}
          saveLabel={storage === 'local' ? 'SAVE (THIS BROWSER)' : 'SAVE'}
          initial={{
            id: newAreaId(now),
            name: '',
            shape,
            alert: { enabled: true, severity: 'WARNING', categories: [], discord: true },
            note: '',
            createdAt: new Date(now).toISOString(),
            updatedAt: new Date(now).toISOString(),
            version: 1,
          }}
          onSave={onSave}
          onCancel={onCancel}
        />
      )}
      {storage === 'local' && <p className="text-wt-fg-dim">Demo mode: areas are kept in this browser only.</p>}
    </div>
  );
}

/** One area on the map: what is inside it now, its alert, and edit or delete. */
export function WatchAreaCard({
  area,
  contents,
  now,
  canEdit,
  onSave,
  onDelete,
  onClose,
}: {
  area: WatchArea;
  contents: AreaContents;
  now: number;
  canEdit: boolean;
  onSave: (a: WatchArea) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const day = recentInside(contents, now, 24).length;
  const week = recentInside(contents, now, 168).length;
  const counts: [string, number][] = (
    [
      ['military aircraft', contents.aircraft.length],
      ['aircraft emergencies', contents.emergencies.length],
      ['sanctioned ships', contents.ships.length],
      ['NGA warnings', contents.navWarnings.length],
      ['GPS interference squares', contents.gnssCells.filter((c) => c.level !== 'low').length],
      ['GPS-loss points', contents.lostGps.length],
      ['conflict events (UCDP)', contents.conflicts.length],
      ['bases', contents.bases.length],
      ['sites', contents.sites.length],
      ['cables and pipelines', contents.lines.length],
    ] as [string, number][]
  ).filter(([, n]) => n > 0);
  return (
    <section aria-label={`Watch area: ${area.name}`} className="absolute right-2 bottom-2 z-10 max-h-[calc(100%-1rem)] w-[min(340px,calc(100%-1rem))] overflow-y-auto border border-wt-line-strong bg-wt-panel/95 text-2xs shadow-lg">
      <header className="flex items-start gap-2 border-b border-wt-line px-2 py-1.5">
        <span className="mt-1 size-2.5 shrink-0 border border-dashed" style={{ borderColor: WATCH_AREA_COLOR }} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-wt-fg">{area.name}</p>
          <p className="text-wt-fg-muted">
            Watch area · {describeShape(area.shape)}
          </p>
        </div>
        <button onClick={onClose} aria-label="Close watch area details" className="text-wt-fg-muted hover:text-wt-fg">
          <X size={12} />
        </button>
      </header>
      {editing ? (
        <div className="px-2 py-1.5">
          <AreaForm
            initial={area}
            saveLabel="SAVE CHANGES"
            onCancel={() => setEditing(false)}
            onSave={async (a) => {
              await onSave({ ...a, version: area.version + 1 });
              setEditing(false);
            }}
          />
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 px-2 py-1.5 tabular-nums">
            <dt className="text-wt-fg-dim">RECORDS INSIDE</dt>
            <dd>
              {day} in 24 h · {week} in 7 days <span className="text-wt-fg-dim">(exactly located only)</span>
            </dd>
            <dt className="text-wt-fg-dim">ALERT</dt>
            <dd>
              {area.alert.enabled ? (
                <>
                  <Tag tone="warn">{area.alert.severity}</Tag> {area.alert.categories.length ? area.alert.categories.join(', ') : 'all categories'}
                  {area.alert.discord ? ' · Discord' : ''}
                </>
              ) : (
                'Off'
              )}
            </dd>
          </dl>
          <div className="border-t border-wt-line px-2 py-1.5">
            <p className="text-wt-fg-dim">INSIDE NOW (LAYERS LOADED)</p>
            {counts.length ? (
              <ul className="mt-0.5 grid grid-cols-2 gap-x-2">
                {counts.map(([label, n]) => (
                  <li key={label} className="tabular-nums">
                    {n} {label}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-wt-fg-muted">Nothing on the loaded layers.</p>
            )}
          </div>
          {area.note && <p className="border-t border-wt-line px-2 py-1 text-wt-fg-muted">{area.note}</p>}
          <div className="flex flex-wrap gap-2 border-t border-wt-line px-2 py-1.5">
            <Link to={`/areas/${area.id}`} className="text-wt-info underline">
              Open area page
            </Link>
            {canEdit && (
              <span className="ml-auto flex gap-2">
                <button className="text-wt-fg-muted hover:text-wt-fg" onClick={() => setEditing(true)}>[EDIT]</button>
                {confirm ? (
                  <>
                    <button className="text-wt-crit hover:underline" onClick={() => void onDelete()}>[CONFIRM DELETE]</button>
                    <button className="text-wt-fg-muted" onClick={() => setConfirm(false)}>[KEEP]</button>
                  </>
                ) : (
                  <button className="text-wt-fg-muted hover:text-wt-crit" onClick={() => setConfirm(true)}>[DELETE]</button>
                )}
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
