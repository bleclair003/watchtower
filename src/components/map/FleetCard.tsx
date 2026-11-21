import { ExternalLink, X } from 'lucide-react';
import { FLEET_STALE_DAYS, HULL_LABEL, isBigDeck, type FleetArea, type FleetSnapshot } from '@shared/domain/fleet';
import { getRegion } from '@shared/domain/regions';
import { safeExternalUrl } from '../../lib/sanitize';
import { Tag } from '../ui/Tag';
import { FLEET_COLOR } from './WorldMap';

interface Props {
  area: FleetArea;
  snapshot: FleetSnapshot;
  now: number;
  onClose: () => void;
}

/** Ships USNI News lists in one named area, with the tracker date and its limits. */
export function FleetCard({ area, snapshot, now, onClose }: Props) {
  const ageDays = Math.floor((now - Date.parse(`${snapshot.asOf}T12:00:00Z`)) / 86_400_000);
  const stale = ageDays > FLEET_STALE_DAYS;
  const link = snapshot.simulated ? null : safeExternalUrl(snapshot.url);
  const bigDecks = area.ships.filter((s) => isBigDeck(s.hullType));
  const others = area.ships.filter((s) => !isBigDeck(s.hullType));
  return (
    <section
      aria-label={`Fleet area: ${area.name}`}
      className="absolute right-2 bottom-2 z-10 max-h-[calc(100%-1rem)] w-[min(340px,calc(100%-1rem))] overflow-y-auto border border-wt-line-strong bg-wt-panel/95 text-2xs shadow-lg"
    >
      <header className="flex items-start gap-2 border-b border-wt-line px-2 py-1.5">
        <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ background: bigDecks.length ? FLEET_COLOR.bigDeck : FLEET_COLOR.other }} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-wt-fg">
            US Navy · {area.name} {snapshot.simulated && <Tag tone="warn">SIMULATED</Tag>}
          </p>
          <p className={stale ? 'text-wt-warn' : 'text-wt-fg-muted'}>
            As of {snapshot.asOf} ({ageDays} d ago){stale ? ' · out of date' : ''}
            {area.regionIds.length > 0 && ` · ${area.regionIds.map((r) => getRegion(r)?.shortCode ?? r).join('/')}`}
          </p>
        </div>
        <button onClick={onClose} aria-label="Close fleet details" className="text-wt-fg-muted hover:text-wt-fg">
          <X size={12} />
        </button>
      </header>
      <div className="px-2 py-1.5">
        {bigDecks.length > 0 && (
          <>
            <p className="tracking-wider text-wt-fg-dim">CARRIERS AND BIG-DECK AMPHIBS</p>
            <ul className="mb-1">
              {bigDecks.map((s) => (
                <li key={s.hull}>
                  <span className="text-wt-fg">{s.name}</span> <span className="text-wt-fg-muted">({s.hull}) · {HULL_LABEL[s.hullType] ?? s.hullType}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {others.length > 0 && (
          <>
            <p className="tracking-wider text-wt-fg-dim">OTHER SHIPS LISTED ({others.length})</p>
            <ul className="text-wt-fg-muted">
              {others.map((s) => (
                <li key={s.hull}>
                  {s.name} ({s.hull})
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 border-t border-wt-line px-2 py-1.5">
        <dt className="text-wt-fg-dim">MARKER</dt>
        <dd className="text-wt-fg-muted">{area.point ? 'Reference point of the named area, not a ship position' : 'Area too vague to place on the map'}</dd>
        <dt className="text-wt-fg-dim">SOURCE</dt>
        <dd className="text-wt-fg-muted">{snapshot.simulated ? 'Simulated demo tracker' : 'USNI News Fleet and Marine Tracker (weekly)'}</dd>
        {link && (
          <>
            <dt className="text-wt-fg-dim">ARTICLE</dt>
            <dd>
              <a href={link} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-0.5 text-wt-info underline">
                {snapshot.title} <ExternalLink size={9} aria-hidden />
              </a>
            </dd>
          </>
        )}
      </dl>
      <p className="border-t border-wt-line px-2 py-1 text-wt-fg-dim">
        Approximate, weekly positions from Navy and public information. The Navy does not publish exact locations. Submarines and most auxiliaries are not listed.
      </p>
    </section>
  );
}
