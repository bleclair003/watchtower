import { ExternalLink, X } from 'lucide-react';
import { cellBounds, cellCentre, GNSS_DEGRADED_NACP, GNSS_LEVEL_LABEL, GNSS_MIN_SIGHTINGS, type GnssCell, type GnssSnapshot } from '@shared/domain/gnss';
import type { NavWarning } from '@shared/domain/navWarnings';
import { getRegion } from '@shared/domain/regions';
import { greatCircleKm } from '../../lib/measure';
import { formatAge, formatUtc } from '../../lib/time';
import { safeExternalUrl } from '../../lib/sanitize';
import { Tag } from '../ui/Tag';
import { GNSS_COLOR } from './WorldMap';

/** Navigational warnings of the GPS-interference kind within this distance of a square's centre are listed. */
export const NEARBY_WARNING_KM = 500;

const fmt = (lat: number, lon: number) => `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;

/** One GPS-interference square: counts, where aircraft lost GPS, nearby warnings, and the limits. */
export function GnssCard({ cell, snapshot, warnings, now, onClose }: { cell: GnssCell; snapshot: GnssSnapshot; warnings: NavWarning[]; now: number; onClose: () => void }) {
  const [la, lo] = cellCentre(cell.k);
  const [w, s, e, n] = cellBounds(cell.k);
  const share = cell.n ? cell.bad / cell.n : 0;
  const lostHere = snapshot.lost.filter((p) => p.la >= s && p.la < n && p.lo >= w && p.lo < e);
  const nearby = warnings
    .filter((x) => x.kind === 'gnss' && x.lat != null && x.lon != null)
    .map((x) => ({ x, km: greatCircleKm([lo, la], [x.lon!, x.lat!]) }))
    .filter((r) => r.km <= NEARBY_WARNING_KM)
    .sort((a, b) => a.km - b.km);
  const day = snapshot.fetchedAt.slice(0, 10);
  const live = !snapshot.simulated;
  const adsb = live ? safeExternalUrl(`https://adsb.lol/?lat=${la.toFixed(2)}&lon=${lo.toFixed(2)}&zoom=7`) : null;
  const gpsjam = live ? safeExternalUrl(`https://gpsjam.org/?lat=${la.toFixed(2)}&lon=${lo.toFixed(2)}&z=6&date=${day}`) : null;
  return (
    <section
      aria-label={`GPS interference square ${fmt(la, lo)}`}
      className="absolute right-2 bottom-2 z-10 max-h-[calc(100%-1rem)] w-[min(330px,calc(100%-1rem))] overflow-y-auto border border-wt-line-strong bg-wt-panel/95 text-2xs shadow-lg"
    >
      <header className="flex items-start gap-2 border-b border-wt-line px-2 py-1.5">
        <span className="mt-1 size-2.5 shrink-0" style={{ background: GNSS_COLOR[cell.level] }} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-wt-fg">
            GPS accuracy · {fmt(s, w)} to {fmt(n, e)} {snapshot.simulated && <Tag tone="warn">SIMULATED</Tag>}
          </p>
          <p className="text-wt-fg-muted">
            Degraded share {GNSS_LEVEL_LABEL[cell.level]}
            {cell.regionIds.length > 0 && ` · ${cell.regionIds.map((r) => getRegion(r)?.shortCode ?? r).join(', ')}`}
          </p>
        </div>
        <button onClick={onClose} aria-label="Close GPS interference details" className="text-wt-fg-muted hover:text-wt-fg">
          <X size={12} />
        </button>
      </header>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 px-2 py-1.5 tabular-nums">
        <dt className="text-wt-fg-dim">LAST {snapshot.windowHours} H</dt>
        <dd>
          <span className={cell.level === 'high' ? 'text-wt-crit' : cell.level === 'medium' ? 'text-wt-warn' : ''}>{Math.round(share * 100)}%</span> degraded: {cell.bad} of {cell.n} aircraft sightings
        </dd>
        <dt className="text-wt-fg-dim">LOST GPS</dt>
        <dd>{cell.lost ? `${cell.lost} sighting(s) flagged as having lost GPS that worked before` : 'None flagged'}</dd>
        <dt className="text-wt-fg-dim">SAMPLED</dt>
        <dd>
          {formatAge(snapshot.fetchedAt, now)} ago, hourly · {snapshot.provider}
        </dd>
      </dl>
      {lostHere.length > 0 && (
        <div className="border-t border-wt-line px-2 py-1.5">
          <p className="text-wt-fg-dim">LAST GOOD POSITION BEFORE GPS WAS LOST (RINGS ON THE MAP)</p>
          <ul className="mt-0.5 space-y-0.5">
            {lostHere.slice(0, 6).map((p, i) => (
              <li key={i} className="tabular-nums">
                {fmt(p.la, p.lo)} at {formatUtc(p.at)} {p.cs && <span className="text-wt-fg-muted">· {p.cs}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="border-t border-wt-line px-2 py-1.5">
        <p className="text-wt-fg-dim">NGA GPS-INTERFERENCE WARNINGS WITHIN {NEARBY_WARNING_KM} KM</p>
        {nearby.length ? (
          <ul className="mt-0.5 space-y-1">
            {nearby.slice(0, 4).map(({ x, km }) => (
              <li key={x.key}>
                <span className="text-wt-fg">{x.key}</span> <span className="text-wt-fg-muted">· {Math.round(km)} km{x.issuedAt ? ` · issued ${formatUtc(x.issuedAt)}` : ''}</span>
                <p className="line-clamp-2 text-wt-fg-muted">{x.text}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-wt-fg-muted">None in NGA's current list (its warnings are mostly at sea).</p>
        )}
      </div>
      {(adsb || gpsjam) && (
        <div className="flex flex-wrap gap-x-3 border-t border-wt-line px-2 py-1.5">
          {adsb && (
            <a href={adsb} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-0.5 text-wt-info underline">
              Aircraft here now (adsb.lol) <ExternalLink size={9} aria-hidden />
            </a>
          )}
          {gpsjam && (
            <a href={gpsjam} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-0.5 text-wt-info underline">
              Compare: GPSJam, same day <ExternalLink size={9} aria-hidden />
            </a>
          )}
        </div>
      )}
      <p className="border-t border-wt-line px-2 py-1 text-wt-fg-dim">
        Degraded = an ADS-B version 2 aircraft at 1,000 ft or more reporting position accuracy (NACp) below {GNSS_DEGRADED_NACP}, or flagged by the network as having lost GPS. Squares need {GNSS_MIN_SIGHTINGS}+ sightings. Many aircraft at once point to jamming or spoofing; one badly installed transponder can colour a quiet square. It does not show who is responsible. Data: adsb.lol (ODbL).
      </p>
    </section>
  );
}
