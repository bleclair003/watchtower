import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { IntelligenceEvent } from '@shared/domain/types';
import type { Incident } from '@shared/domain/incidents/types';
import { addEvidence, createIncident } from '@shared/domain/incidents/logic';
import { useAuth } from '../../state/AuthContext';

/** "+ DOSSIER" control for a feed item: attach the event to an existing dossier or start a new one. */
export function AddToDossier({ event }: { event: IntelligenceEvent }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Incident[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = useAuth().can('editIncidents');

  async function openPicker() {
    setOpen(true);
    setStatus(null);
    try {
      const svc = await import('../../data/incidentsService');
      setItems((await svc.listIncidents()).filter((i) => i.status !== 'closed'));
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  }

  async function attach(target: Incident | 'new') {
    setBusy(true);
    try {
      const svc = await import('../../data/incidentsService');
      const now = new Date().toISOString();
      if (target === 'new') {
        const saved = await svc.saveIncident(createIncident(now, event), 0);
        navigate(`/dossiers/${saved.id}`);
        return;
      }
      const fresh = await svc.getIncident(target.id);
      if (!fresh) throw new Error('Dossier no longer exists.');
      const next = addEvidence(fresh, event, now);
      if (next === fresh) setStatus(`Already in “${fresh.title}”.`);
      else {
        await svc.saveIncident(next, fresh.version);
        setStatus(`Added to “${fresh.title}”.`);
      }
      setOpen(false);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit) return null;
  return (
    <div className="text-2xs">
      {!open ? (
        <button onClick={() => void openPicker()} className="text-wt-fg hover:underline">[+ DOSSIER]</button>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            aria-label="Choose dossier"
            disabled={busy || items === null}
            className="h-6 max-w-64 border border-wt-line-strong bg-wt-bg px-1 text-2xs"
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (v === '__new') void attach('new');
              else if (v) void attach(items!.find((i) => i.id === v)!);
            }}
          >
            <option value="">{items === null ? 'loading…' : 'add to dossier…'}</option>
            <option value="__new">+ NEW DOSSIER FROM THIS EVENT</option>
            {(items ?? []).map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}
          </select>
          <button className="text-wt-fg-muted hover:text-wt-fg" onClick={() => setOpen(false)}>[CANCEL]</button>
        </div>
      )}
      {status && <p role="status" className="mt-0.5 text-wt-fg-muted">{status}</p>}
    </div>
  );
}
