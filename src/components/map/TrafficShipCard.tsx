import { ExternalLink, X } from 'lucide-react';
import { cargoHazard, flagOf, trackPoints, TRAFFIC_LABEL, type ShipTrafficDoc, type TrafficShip } from '@shared/domain/shipTraffic';
import { SHIP_AREAS } from '@shared/domain/sanctionedShips';
import { countryName } from '../../lib/regionSummary';
import { greatCircleKm } from '../../lib/measure';
import { formatAge, formatUtc } from '../../lib/time';
import { safeExternalUrl } from '../../lib/sanitize';
import { Tag } from '../ui/Tag';
import { TRAFFIC_COLOR } from './WorldMap';

/** One tanker or cargo ship: identity, motion, its 24-hour track, and whether it is on a sanctions list. */
export function TrafficShipCard({
  ship: s,
  doc,
  now,
  sanctioned,
  nearLines,
  onClose,
}: {
  ship: TrafficShip;
  doc: ShipTrafficDoc;
  now: number;
  /** Listed name and lists when this ship is also a sanctioned-ship sighting. */
  sanctioned: { listedName: string; lists: string } | null;
  nearLines?: { name: string; kind: string; km: number }[];
  onClose: () => void;
}) {
  const pts = trackPoints(s);
  let km = 0;
  for (let i = 1; i < pts.length; i++) km += greatCircleKm([pts[i - 1][0], pts[i - 1][1]], [pts[i][0], pts[i][1]]);
  const flag = flagOf(s.mmsi);
  const hazard = cargoHazard(s.type);
  const area = SHIP_AREAS.find((a) => a.id === s.area);
  const link = doc.simulated ? null : safeExternalUrl(s.imo ? `https://www.marinetraffic.com/en/ais/details/ships/imo:${s.imo}` : `https://www.marinetraffic.com/en/ais/details/ships/mmsi:${s.mmsi}`);
  return (
    <section
      aria-label={`${TRAFFIC_LABEL[s.kind]}: ${s.name ?? s.mmsi}`}
      className="absolute right-2 bottom-2 z-10 max-h-[calc(100%-1rem)] w-[min(330px,calc(100%-1rem))] overflow-y-auto border border-wt-line-strong bg-wt-panel/95 text-2xs shadow-lg"
    >
      <header className="flex items-start gap-2 border-b border-wt-line px-2 py-1.5">
        <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ background: TRAFFIC_COLOR[s.kind] }} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-wt-fg">
            {s.name ?? 'Name not broadcast'} {doc.simulated && <Tag tone="warn">SIMULATED</Tag>} {sanctioned && <Tag tone="crit">SANCTIONED</Tag>}
          </p>
          <p className="text-wt-fg-muted">
            {TRAFFIC_LABEL[s.kind]} (AIS type {s.type}{hazard ? `, ${hazard}` : ''}){flag ? ` · flag ${countryName(flag)}` : ''}
          </p>
        </div>
        <button onClick={onClose} aria-label="Close ship details" className="text-wt-fg-muted hover:text-wt-fg">
          <X size={12} />
        </button>
      </header>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 px-2 py-1.5 tabular-nums">
        <dt className="text-wt-fg-dim">IMO / MMSI</dt>
        <dd>
          {s.imo ?? 'no IMO broadcast'} / {s.mmsi}
        </dd>
        <dt className="text-wt-fg-dim">DESTINATION</dt>
        <dd>{s.destination ?? 'Not broadcast'} <span className="text-wt-fg-dim">(typed by the crew)</span></dd>
        <dt className="text-wt-fg-dim">SPEED / COURSE</dt>
        <dd>
          {s.sog !== null ? `${s.sog} kn` : '—'} / {s.cog !== null ? `${s.cog}°` : '—'}
        </dd>
        <dt className="text-wt-fg-dim">LAST POSITION</dt>
        <dd>
          {s.la.toFixed(3)}, {s.lo.toFixed(3)} · {area?.name ?? s.area} · {formatAge(s.seenAt, now)} ago
        </dd>
        <dt className="text-wt-fg-dim">24 H TRACK</dt>
        <dd>
          {pts.length > 1 ? `${pts.length} positions from ${formatUtc(pts[0][2])}, about ${Math.round(km)} km in straight lines` : 'One position so far'}
        </dd>
      </dl>
      {sanctioned && (
        <p className="border-t border-wt-line px-2 py-1 text-wt-crit">
          On the {sanctioned.lists} sanctions lists as {sanctioned.listedName}. Its sighting is also on the SANCTIONED layer.
        </p>
      )}
      {nearLines && nearLines.length > 0 && (
        <div className="border-t border-wt-line px-2 py-1.5">
          <p className="text-wt-fg-dim">UNDERSEA CABLES AND PIPELINES WITHIN 20 KM</p>
          <ul>
            {nearLines.slice(0, 4).map((l) => (
              <li key={l.name}>
                {l.name} <span className="text-wt-fg-muted">· {l.kind} · {l.km} km</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {link && (
        <p className="border-t border-wt-line px-2 py-1">
          <a href={link} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-0.5 text-wt-info underline">
            Live position on MarineTraffic <ExternalLink size={9} aria-hidden />
          </a>
        </p>
      )}
      <p className="border-t border-wt-line px-2 py-1 text-wt-fg-dim">
        Sampled once per collection run from volunteer AIS receivers (aisstream.io) and, in Finnish waters, <a href="https://www.digitraffic.fi/en/terms-of-service/" target="_blank" rel="noopener noreferrer nofollow" className="underline">Fintraffic / digitraffic.fi</a> (CC BY 4.0), so the track joins dots with straight lines; ships with AIS off are not seen. Name, type and destination are what the ship broadcasts.
      </p>
    </section>
  );
}
