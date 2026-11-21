import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { MetersSnapshot } from '@shared/domain/meters/types';
import { getRegion } from '@shared/domain/regions';
import { Panel } from '../ui/Panel';
import { Tag } from '../ui/Tag';
import { MeterCard, cellLabel, levelTone } from './MeterCard';

/** The meters for one region (and the global monitors tied to it), as a strip of readings with a detail view. */
export function RegionMeters({ regionId, meters, now }: { regionId: string; meters: MetersSnapshot | null; now: number }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!meters) return null;
  const list = meters.meters.filter((m) => m.regionId === regionId);
  if (!list.length) return null;
  const selected = list.find((m) => m.id === open) ?? null;
  const code = getRegion(regionId)?.shortCode ?? '';
  const label = (name: string) => {
    const n = code && name.startsWith(`${code} `) ? name.slice(code.length + 1) : name;
    return n.charAt(0).toUpperCase() + n.slice(1);
  };
  return (
    <Panel
      title="Meters"
      designator="RM"
      actions={
        <Link to="/meters" className="text-2xs text-wt-fg-muted hover:text-wt-fg">
          [ALL METERS]
        </Link>
      }
    >
      <ul className="flex flex-wrap gap-1 px-2 py-1.5" aria-label="Region meters">
        {list.map((m) => (
          <li key={m.id}>
            <button onClick={() => setOpen(open === m.id ? null : m.id)} aria-pressed={open === m.id} title={m.reading} className={`flex items-center gap-1 border px-1 py-0.5 text-2xs ${open === m.id ? 'border-wt-info' : 'border-wt-line hover:border-wt-line-strong'}`}>
              <span className="text-wt-fg-muted">{label(m.name)}</span>
              <Tag tone={levelTone(m.level)}>{cellLabel(m)}</Tag>
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <div className="border-t border-wt-line px-3 py-2">
          <MeterCard meter={selected} history={meters.history} now={now} simulated={meters.simulated} />
        </div>
      )}
    </Panel>
  );
}
