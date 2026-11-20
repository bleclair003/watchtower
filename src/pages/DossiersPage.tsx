import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Incident, IncidentStatus } from '@shared/domain/incidents/types';
import { createIncident } from '@shared/domain/incidents/logic';
import { getRegion } from '@shared/domain/regions';
import { useData } from '../state/DataContext';
import { useNow } from '../hooks/useNow';
import { formatAge } from '../lib/time';
import { STATUS_TONE } from '../config/incidents';
import { Panel } from '../components/ui/Panel';
import { Tag } from '../components/ui/Tag';

/** Incident dossier index. */
export default function DossiersPage() {
  const { mode } = useData();
  const live = mode !== 'demo';
  const now = useNow(60_000).getTime();
  const navigate = useNavigate();
  const [items, setItems] = useState<Incident[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<IncidentStatus | 'open' | 'all'>('open');

  useEffect(() => {
    document.title = 'WATCHTOWER // DOSSIERS';
    if (!live) return;
    import('../data/incidentsService')
      .then((s) => s.listIncidents())
      .then(setItems, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [live]);

  async function create() {
    setCreating(true);
    try {
      const svc = await import('../data/incidentsService');
      const saved = await svc.saveIncident(createIncident(new Date().toISOString()), 0);
      navigate(`/dossiers/${saved.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCreating(false);
    }
  }

  const shown = (items ?? []).filter((i) => filter === 'all' || (filter === 'open' ? i.status !== 'closed' : i.status === filter));

  return (
    <div className="h-full overflow-y-auto p-1.5">
      <Panel
        title="Incident Dossiers"
        designator="D5"
        actions={
          live && (
            <button onClick={() => void create()} disabled={creating} className="text-2xs text-wt-fg hover:underline disabled:opacity-50">
              [{creating ? 'CREATING…' : '+ NEW DOSSIER'}]
            </button>
          )
        }
      >
        <p className="border-b border-wt-line px-2 py-1.5 text-2xs text-wt-fg-muted">
          A dossier tracks one developing situation: the records you link as evidence, your assessment of each one, the timeline, and your notes.
          You can also start one from any feed item with <span className="text-wt-fg">+ DOSSIER</span>.
        </p>
        {!live && <p className="p-3 text-xs text-wt-warn">Dossiers are stored in Firestore and need the live backend. They aren't available in demo mode.</p>}
        {error && <p role="alert" className="p-2 text-xs text-wt-crit">ERROR: {error}</p>}
        {live && (
          <div className="flex gap-1 border-b border-wt-line px-2 py-1 text-2xs">
            {(['open', 'developing', 'stable', 'closed', 'all'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className={`h-5 border px-1.5 uppercase ${filter === f ? 'border-wt-info text-wt-info' : 'border-wt-line text-wt-fg-muted hover:text-wt-fg'}`}
              >
                {f}
              </button>
            ))}
          </div>
        )}
        {live && items === null && !error && <p className="p-3 text-xs text-wt-fg-muted">LOADING…</p>}
        {live && items && shown.length === 0 && <p className="p-3 text-xs text-wt-fg-muted">NO DOSSIERS{filter !== 'all' ? ' IN THIS VIEW' : ''}.</p>}
        <ul className="divide-y divide-wt-line">
          {shown.map((i) => (
            <li key={i.id}>
              <Link to={`/dossiers/${i.id}`} className="block px-2 py-1.5 hover:bg-wt-bg2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Tag tone={STATUS_TONE[i.status]}>{i.status}</Tag>
                  <span className="text-xs">{i.title}</span>
                  <span className="ml-auto text-2xs text-wt-fg-muted tabular-nums">updated {formatAge(i.updatedAt, now)} ago</span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-2xs text-wt-fg-dim">
                  {i.regionIds.map((r) => <Tag key={r}>{getRegion(r)?.shortCode ?? r}</Tag>)}
                  <span>{i.evidence.length} evidence</span>
                  <span>· {i.notes.length} notes</span>
                  <span>· {i.evidence.filter((e) => e.assessment === 'confirmed').length} confirmed</span>
                  {i.evidence.some((e) => e.assessment === 'disputed') && <Tag tone="warn">DISPUTED EVIDENCE</Tag>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
