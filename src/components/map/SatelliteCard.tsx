import { useMemo } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { epochAgeHours, orbitShape, SAT_CREDIT, SAT_GROUPS, type SatellitesSnapshot, type StoredSat } from '@shared/domain/satellites';
import { WATCH_REGIONS } from '@shared/domain/regions';
import { formatUtc } from '../../lib/time';
import { passesOver, subPoint, toSatrec } from '../../lib/orbits';
import { Tag } from '../ui/Tag';

const fmt = (lat: number, lon: number) => `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;

/** One satellite: where it is now, its orbit, and its next passes over the watch regions (12 h). */
export function SatelliteCard({ sat, snapshot, now, onClose }: { sat: StoredSat; snapshot: SatellitesSnapshot; now: number; onClose: () => void }) {
  const el = sat.el;
  const rec = useMemo(() => toSatrec(el), [el]);
  const here = rec ? subPoint(rec, new Date(now)) : null;
  const shape = orbitShape(el);
  const age = epochAgeHours(el, now);
  // Passes are computed once per opening (not every tick).
  const passes = useMemo(() => {
    if (!rec) return [];
    const from = Date.now();
    return WATCH_REGIONS.filter((r) => r.bbox)
      .map((r) => ({ region: r, next: passesOver(rec, r.bbox!, from, 12, 60)[0] ?? null }))
      .filter((x) => x.next)
      .sort((a, b) => a.next!.start - b.next!.start);
  }, [rec]);
  const group = SAT_GROUPS.find((g) => g.id === sat.g)?.label ?? sat.g;
  return (
    <section
      aria-label={`Satellite ${el.OBJECT_NAME}`}
      className="absolute right-2 bottom-2 z-10 max-h-[calc(100%-1rem)] w-[min(330px,calc(100%-1rem))] overflow-y-auto border border-wt-line-strong bg-wt-panel/95 text-2xs shadow-lg"
    >
      <header className="flex items-start gap-2 border-b border-wt-line px-2 py-1.5">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-wt-fg">
            {el.OBJECT_NAME} {snapshot.simulated && <Tag tone="warn">SIMULATED</Tag>}
          </p>
          <p className="text-wt-fg-muted">
            {group} · NORAD {el.NORAD_CAT_ID} · {el.OBJECT_ID}
          </p>
        </div>
        <button onClick={onClose} aria-label="Close satellite details" className="text-wt-fg-muted hover:text-wt-fg">
          <X size={12} />
        </button>
      </header>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 px-2 py-1.5 tabular-nums">
        <dt className="text-wt-fg-dim">NOW</dt>
        <dd>{here ? `over ${fmt(here.lat, here.lon)}, ${Math.round(here.altKm)} km up` : 'position not computable'}</dd>
        <dt className="text-wt-fg-dim">ORBIT</dt>
        <dd>
          {Math.round(shape.perigeeKm)}–{Math.round(shape.apogeeKm)} km · inclination {el.INCLINATION.toFixed(1)}° · period {shape.periodMin.toFixed(0)} min
        </dd>
        <dt className="text-wt-fg-dim">ELEMENTS</dt>
        <dd className={age > 72 ? 'text-wt-warn' : ''}>
          epoch {formatUtc(`${el.EPOCH}Z`)} ({age < 48 ? `${Math.round(age)} h` : `${Math.round(age / 24)} d`} old{age > 72 ? ': position less reliable' : ''})
        </dd>
      </dl>
      <h3 className="border-t border-wt-line px-2 pt-1.5 text-wt-fg-dim">NEXT PASS OVER EACH WATCH REGION (12 H)</h3>
      {passes.length === 0 ? (
        <p className="px-2 py-1 text-wt-fg-muted">None in the next 12 hours.</p>
      ) : (
        <ul className="px-2 py-1" aria-label="Next passes">
          {passes.map(({ region, next }) => (
            <li key={region.id} className="flex justify-between gap-2">
              <span>{region.name}</span>
              <span className="tabular-nums text-wt-fg-muted">
                {formatUtc(new Date(next!.start).toISOString())} ({Math.max(1, Math.round((next!.end - next!.start) / 60_000))} min)
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="border-t border-wt-line px-2 py-1 text-wt-fg-dim">
        A pass means the ground track crosses the region, not that anything was imaged. Positions come from public elements computed with SGP4 (a few km near the epoch).
        Many classified satellites are not in the public catalogue. {SAT_CREDIT}.{' '}
        <a href={`https://celestrak.org/satcat/table-satcat.php?CATNR=${el.NORAD_CAT_ID}`} target="_blank" rel="noopener noreferrer" className="text-wt-info">
          Catalogue entry <ExternalLink size={9} className="inline" aria-hidden />
        </a>
      </p>
    </section>
  );
}
