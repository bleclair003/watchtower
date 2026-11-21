import { ExternalLink, X } from 'lucide-react';
import { AIRCRAFT_CLASS_LABEL, AIRCRAFT_PROVIDERS, aircraftLabel, aircraftTypeName, type AircraftPosition, type AircraftSnapshot } from '@shared/domain/aircraft';
import { formatAge } from '../../lib/time';
import { safeExternalUrl } from '../../lib/sanitize';
import { Tag } from '../ui/Tag';
import { AIRCRAFT_COLOR } from './WorldMap';

interface Props {
  aircraft: AircraftPosition;
  snapshot: AircraftSnapshot;
  now: number;
  onClose: () => void;
}

/** What the ADS-B network reported for one military aircraft, with its limits. */
export function AircraftCard({ aircraft: a, snapshot, now, onClose }: Props) {
  const provider = AIRCRAFT_PROVIDERS[snapshot.provider];
  const typeName = aircraftTypeName(a.t);
  const seenAt = Date.parse(snapshot.fetchedAt) - a.age * 1000;
  const link = snapshot.simulated ? null : safeExternalUrl(provider.aircraftUrl(a.hex));
  return (
    <section
      aria-label={`Aircraft: ${aircraftLabel(a)}`}
      className="absolute right-2 bottom-2 z-10 max-h-[calc(100%-1rem)] w-[min(320px,calc(100%-1rem))] overflow-y-auto border border-wt-line-strong bg-wt-panel/95 text-2xs shadow-lg"
    >
      <header className="flex items-start gap-2 border-b border-wt-line px-2 py-1.5">
        <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ background: AIRCRAFT_COLOR[a.cls] }} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-wt-fg">
            {aircraftLabel(a)} {snapshot.simulated && <Tag tone="warn">SIMULATED</Tag>}
          </p>
          <p className="text-wt-fg-muted">
            {AIRCRAFT_CLASS_LABEL[a.cls]} · {typeName ?? a.t ?? 'type not recorded'}
          </p>
        </div>
        <button onClick={onClose} aria-label="Close aircraft details" className="text-wt-fg-muted hover:text-wt-fg">
          <X size={12} />
        </button>
      </header>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 px-2 py-1.5">
        <dt className="text-wt-fg-dim">CALLSIGN</dt>
        <dd>{a.cs ?? 'Not broadcast'}</dd>
        <dt className="text-wt-fg-dim">REGISTRATION</dt>
        <dd>{a.reg ?? 'Not recorded'}</dd>
        <dt className="text-wt-fg-dim">TYPE CODE</dt>
        <dd>{a.t ?? 'Not recorded'}</dd>
        <dt className="text-wt-fg-dim">ICAO ADDRESS</dt>
        <dd className="tabular-nums">{a.hex.toUpperCase()}</dd>
        <dt className="text-wt-fg-dim">ALTITUDE</dt>
        <dd className="tabular-nums">{a.alt !== null ? `${a.alt.toLocaleString('en-US')} ft` : 'Not reported'}</dd>
        <dt className="text-wt-fg-dim">SPEED / TRACK</dt>
        <dd className="tabular-nums">
          {a.gs !== null ? `${a.gs} kt` : '—'} / {a.trk !== null ? `${a.trk}°` : '—'}
        </dd>
        <dt className="text-wt-fg-dim">POSITION</dt>
        <dd className="tabular-nums">
          {a.la.toFixed(3)}, {a.lo.toFixed(3)} <span className="text-wt-fg-dim">({formatAge(new Date(seenAt).toISOString(), now)} ago)</span>
        </dd>
        {a.em && (
          <>
            <dt className="text-wt-fg-dim">EMERGENCY</dt>
            <dd>
              <Tag tone="warn">{a.em.toUpperCase()}</Tag>
            </dd>
          </>
        )}
        <dt className="text-wt-fg-dim">SOURCE</dt>
        <dd className="text-wt-fg-muted">
          {snapshot.simulated ? 'Simulated demo aircraft' : `${provider.name} military feed · ${provider.licence}`}
        </dd>
        {link && (
          <>
            <dt className="text-wt-fg-dim">TRACK</dt>
            <dd>
              <a href={link} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-0.5 text-wt-info underline">
                Live track on {provider.name} <ExternalLink size={9} aria-hidden />
              </a>
            </dd>
          </>
        )}
      </dl>
      <p className="border-t border-wt-line px-2 py-1 text-wt-fg-dim">
        Snapshot from the last collection run, not live. Only aircraft that broadcast ADS-B are seen; many military flights do not. The military flag comes from a community database and includes government VIP aircraft.
      </p>
    </section>
  );
}
