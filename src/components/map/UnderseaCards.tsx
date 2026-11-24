import { ExternalLink, X } from 'lucide-react';
import { nearbyLines, underseaName, UNDERSEA_LABEL, type UnderseaDataset, type UnderseaLine } from '@shared/domain/undersea';
import type { DisputedProps } from '@shared/domain/disputed';
import type { NavWarning } from '@shared/domain/navWarnings';
import type { SanctionedShipSighting } from '@shared/domain/sanctionedShips';
import { formatUtc } from '../../lib/time';
import { safeExternalUrl } from '../../lib/sanitize';
import { DISPUTED_COLOR, UNDERSEA_COLOR } from './WorldMap';

/** Sanctioned ships and cable warnings within these distances of a line are listed on its card. */
export const SHIP_NEAR_KM = 20;
export const WARNING_NEAR_KM = 50;

const shell = 'absolute right-2 bottom-2 z-10 max-h-[calc(100%-1rem)] w-[min(330px,calc(100%-1rem))] overflow-y-auto border border-wt-line-strong bg-wt-panel/95 text-2xs shadow-lg';

/** One undersea cable or pipeline, with sanctioned ships and NGA cable warnings near it. */
export function UnderseaCard({
  line,
  dataset,
  ships,
  warnings,
  onClose,
}: {
  line: UnderseaLine;
  dataset: UnderseaDataset;
  ships: SanctionedShipSighting[];
  warnings: NavWarning[];
  onClose: () => void;
}) {
  const nearShips = ships
    .map((s) => ({ s, km: nearbyLines([line], s.la, s.lo, SHIP_NEAR_KM)[0]?.km }))
    .filter((x): x is { s: SanctionedShipSighting; km: number } => x.km != null)
    .sort((a, b) => a.km - b.km);
  const nearWarnings = warnings
    .filter((w) => w.lat != null && w.lon != null)
    .map((w) => ({ w, km: nearbyLines([line], w.lat!, w.lon!, WARNING_NEAR_KM)[0]?.km }))
    .filter((x): x is { w: NavWarning; km: number } => x.km != null)
    .sort((a, b) => a.km - b.km);
  const osm = safeExternalUrl(`https://www.openstreetmap.org/${line.id.replace('osm:', '')}`);
  return (
    <section aria-label={`Undersea line: ${underseaName(line)}`} className={shell}>
      <header className="flex items-start gap-2 border-b border-wt-line px-2 py-1.5">
        <span className="mt-1.5 h-0.5 w-3 shrink-0" style={{ background: UNDERSEA_COLOR[line.k] }} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-wt-fg">{underseaName(line)}</p>
          <p className="text-wt-fg-muted">
            {UNDERSEA_LABEL[line.k]}
            {line.kv ? ` · ${line.kv} kV` : ''}
            {line.sub ? ` · ${line.sub.replace(/_/g, ' ')}` : ''}
          </p>
        </div>
        <button onClick={onClose} aria-label="Close undersea line details" className="text-wt-fg-muted hover:text-wt-fg">
          <X size={12} />
        </button>
      </header>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 px-2 py-1.5">
        <dt className="text-wt-fg-dim">OPERATOR</dt>
        <dd>{line.op ?? 'Not recorded'}</dd>
        <dt className="text-wt-fg-dim">MAPPED PARTS</dt>
        <dd className="tabular-nums">{line.g.length}</dd>
      </dl>
      <div className="border-t border-wt-line px-2 py-1.5">
        <p className="text-wt-fg-dim">SANCTIONED SHIPS SEEN WITHIN {SHIP_NEAR_KM} KM (LAST 48 H)</p>
        {nearShips.length ? (
          <ul className="mt-0.5 space-y-0.5">
            {nearShips.slice(0, 5).map(({ s, km }) => (
              <li key={s.mmsi}>
                <span className="text-wt-warn">{s.listedName}</span> <span className="text-wt-fg-muted">· {km} km{s.sog != null ? ` · ${s.sog} kn` : ''}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-wt-fg-muted">None seen in the last 48 hours (sanctioned ships are only tracked in the Baltic and North Sea).</p>
        )}
      </div>
      <div className="border-t border-wt-line px-2 py-1.5">
        <p className="text-wt-fg-dim">NGA WARNINGS WITHIN {WARNING_NEAR_KM} KM</p>
        {nearWarnings.length ? (
          <ul className="mt-0.5 space-y-1">
            {nearWarnings.slice(0, 4).map(({ w, km }) => (
              <li key={w.key}>
                <span className="text-wt-fg">{w.key}</span> <span className="text-wt-fg-muted">· {w.kind} · {km} km{w.issuedAt ? ` · ${formatUtc(w.issuedAt)}` : ''}</span>
                <p className="line-clamp-2 text-wt-fg-muted">{w.text}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-wt-fg-muted">None in NGA's current list.</p>
        )}
      </div>
      {osm && (
        <p className="border-t border-wt-line px-2 py-1">
          <a href={osm} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-0.5 text-wt-info underline">
            On OpenStreetMap <ExternalLink size={9} aria-hidden />
          </a>
        </p>
      )}
      <p className="border-t border-wt-line px-2 py-1 text-wt-fg-dim">
        Route as volunteers traced it on OpenStreetMap: approximate, and other cables may be missing. {dataset.source.licence}.
      </p>
    </section>
  );
}

const KIND_LABEL: Record<string, string> = {
  Disputed: 'Disputed area',
  Breakaway: 'Breakaway region',
  Indeterminate: 'Undetermined or contested',
  Overlay: 'Buffer or patrolled zone',
  Lease: 'Leased territory',
  'Geo subunit': 'Disputed territory',
  'Geo unit': 'Disputed territory',
};

/** One disputed or breakaway area: who administers it and who claims it, as Natural Earth records. */
export function DisputedCard({ area, onClose }: { area: DisputedProps; onClose: () => void }) {
  return (
    <section aria-label={`Disputed area: ${area.name}`} className={shell}>
      <header className="flex items-start gap-2 border-b border-wt-line px-2 py-1.5">
        <span className="mt-1 size-2.5 shrink-0 border border-dashed" style={{ borderColor: DISPUTED_COLOR }} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-wt-fg">{area.name}</p>
          <p className="text-wt-fg-muted">{KIND_LABEL[area.kind] ?? area.kind}</p>
        </div>
        <button onClick={onClose} aria-label="Close disputed area details" className="text-wt-fg-muted hover:text-wt-fg">
          <X size={12} />
        </button>
      </header>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 px-2 py-1.5">
        <dt className="text-wt-fg-dim">STATUS</dt>
        <dd>{area.note ?? 'No note recorded'}</dd>
        {area.sovereign && (
          <>
            <dt className="text-wt-fg-dim">LISTED UNDER</dt>
            <dd>{area.sovereign}</dd>
          </>
        )}
      </dl>
      <p className="border-t border-wt-line px-2 py-1 text-wt-fg-dim">
        Natural Earth (public domain) draws lines as they are on the ground and notes the claims. It can lag events: the Donetsk and Luhansk lines predate 2022, and Artsakh was dissolved in 2024. Not front lines, and not WATCHTOWER's view.
      </p>
    </section>
  );
}

