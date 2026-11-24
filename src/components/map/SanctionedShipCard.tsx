import { ExternalLink, X } from 'lucide-react';
import { SANCTIONS_LISTS } from '@shared/domain/sanctions';
import { SHIP_AREAS, type SanctionedShipSighting, type SanctionedShipsSnapshot } from '@shared/domain/sanctionedShips';
import { formatAge } from '../../lib/time';
import { safeExternalUrl } from '../../lib/sanitize';
import { Tag } from '../ui/Tag';
import { SANCTIONED_SHIP_COLOR } from './WorldMap';

interface Props {
  ship: SanctionedShipSighting;
  snapshot: SanctionedShipsSnapshot;
  now: number;
  onClose: () => void;
  /** Undersea cables and pipelines within 20 km (v0.71.0); undefined while the undersea data loads. */
  nearLines?: { name: string; kind: string; km: number }[];
}

/** One sanctioned vessel's latest AIS position, with how it was matched and the limits. */
export function SanctionedShipCard({ ship: s, snapshot, now, onClose, nearLines }: Props) {
  const area = SHIP_AREAS.find((a) => a.id === s.area);
  const link = snapshot.simulated ? null : safeExternalUrl(s.imo ? `https://www.marinetraffic.com/en/ais/details/ships/imo:${s.imo}` : `https://www.marinetraffic.com/en/ais/details/ships/mmsi:${s.mmsi}`);
  return (
    <section
      aria-label={`Sanctioned vessel: ${s.listedName}`}
      className="absolute right-2 bottom-2 z-10 max-h-[calc(100%-1rem)] w-[min(340px,calc(100%-1rem))] overflow-y-auto border border-wt-line-strong bg-wt-panel/95 text-2xs shadow-lg"
    >
      <header className="flex items-start gap-2 border-b border-wt-line px-2 py-1.5">
        <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ background: SANCTIONED_SHIP_COLOR }} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-wt-fg">
            {s.listedName} {snapshot.simulated && <Tag tone="warn">SIMULATED</Tag>}
          </p>
          <p className="text-wt-fg-muted">
            Sanctioned by {s.lists.map((l) => SANCTIONS_LISTS[l].short).join(', ')} · {area?.name ?? s.area}
          </p>
        </div>
        <button onClick={onClose} aria-label="Close vessel details" className="text-wt-fg-muted hover:text-wt-fg">
          <X size={12} />
        </button>
      </header>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 px-2 py-1.5">
        <dt className="text-wt-fg-dim">IMO / MMSI</dt>
        <dd className="tabular-nums">
          {s.imo ?? '—'} / {s.mmsi}
        </dd>
        <dt className="text-wt-fg-dim">MATCHED BY</dt>
        <dd>
          <Tag tone={s.matchedBy === 'imo' ? 'info' : 'muted'}>{s.matchedBy === 'imo' ? 'IMO (ship’s own message)' : 'MMSI only'}</Tag>
        </dd>
        {s.aisName && (
          <>
            <dt className="text-wt-fg-dim">BROADCAST NAME</dt>
            <dd>{s.aisName}</dd>
          </>
        )}
        <dt className="text-wt-fg-dim">PROGRAMMES</dt>
        <dd className="text-wt-fg-muted">{s.programs.join('; ') || '—'}</dd>
        <dt className="text-wt-fg-dim">SPEED / COURSE</dt>
        <dd className="tabular-nums">
          {s.sog === null ? '—' : `${s.sog} kn`} / {s.cog === null ? '—' : `${s.cog}°`}
        </dd>
        {s.destination && (
          <>
            <dt className="text-wt-fg-dim">DESTINATION</dt>
            <dd>{s.destination}</dd>
          </>
        )}
        <dt className="text-wt-fg-dim">POSITION</dt>
        <dd className="tabular-nums">
          {s.la.toFixed(3)}, {s.lo.toFixed(3)} <span className="text-wt-fg-dim">({formatAge(s.seenAt, now)} ago)</span>
        </dd>
        <dt className="text-wt-fg-dim">SOURCE</dt>
        <dd className="text-wt-fg-muted">{snapshot.simulated ? 'Simulated demo vessel' : 'aisstream.io (volunteer AIS receivers); OFAC, EU and UK sanctions lists'}</dd>
        {link && (
          <>
            <dt className="text-wt-fg-dim">LOOK UP</dt>
            <dd>
              <a href={link} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-0.5 text-wt-info underline">
                MarineTraffic <ExternalLink size={9} aria-hidden />
              </a>
            </dd>
          </>
        )}
      </dl>
      {nearLines && (
        <div className="border-t border-wt-line px-2 py-1.5">
          <p className="text-wt-fg-dim">UNDERSEA CABLES AND PIPELINES WITHIN 20 KM</p>
          {nearLines.length ? (
            <ul className="mt-0.5 space-y-0.5">
              {nearLines.slice(0, 5).map((l) => (
                <li key={l.name}>
                  <span className={l.km <= 5 ? 'text-wt-warn' : 'text-wt-fg'}>{l.name}</span> <span className="text-wt-fg-muted">· {l.kind} · {l.km} km</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-wt-fg-muted">None mapped on OpenStreetMap.</p>
          )}
        </div>
      )}
      <p className="border-t border-wt-line px-2 py-1 text-wt-fg-dim">
        Seen during a 25-second listening window in a collection run. Only ships with AIS on are seen. A sanctioned ship at sea is not by itself a violation. An MMSI-only match can be a different ship if the number was reassigned.
      </p>
    </section>
  );
}
