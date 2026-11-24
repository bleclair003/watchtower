import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { SAT_CREDIT, SAT_GROUPS, type SatellitesSnapshot } from '@shared/domain/satellites';
import { getRegion } from '@shared/domain/regions';
import { formatAge, formatUtc } from '../../lib/time';
import { passesOver, toSatrec } from '../../lib/orbits';
import { Panel } from '../ui/Panel';
import { Tag } from '../ui/Tag';
import { useSatellites } from '../../data/useSatellites';

const HOURS = 6;

/**
 * Satellite passes over a region in the next hours (v0.84.0): military satellites with public elements and
 * Earth imaging satellites whose ground track crosses the region, computed in the browser on request.
 */
export function SatellitePassesPanel({ regionId, now }: { regionId: string; now: number }) {
  const region = getRegion(regionId);
  const [shown, setShown] = useState(false);
  // The elements are their own document: read only once passes are asked for.
  const { data: loaded, error } = useSatellites(shown);
  const data: SatellitesSnapshot | null = loaded;
  const passes = useMemo(() => {
    if (!shown || !data || !region?.bbox) return [];
    const from = Date.now();
    return data.sats
      .flatMap((s) => {
        const rec = toSatrec(s.el);
        return rec ? passesOver(rec, region.bbox!, from, HOURS, 60).map((p) => ({ s, p })) : [];
      })
      .sort((a, b) => a.p.start - b.p.start);
  }, [shown, data, region]);
  if (!region?.bbox) return null;
  return (
    <Panel title={`Satellite passes (next ${HOURS} h)`} designator="SP" actions={data?.simulated ? <Tag tone="warn">SIMULATED</Tag> : undefined}>
      <p className="border-b border-wt-line px-2 py-1 text-2xs text-wt-fg-dim">
        When military satellites with public orbits and Earth imaging satellites cross {region.name}: a pass means the ground track crosses the region, not that anything was
        imaged, and many classified satellites are not in the public catalogue.{data ? ` Elements read ${formatAge(data.fetchedAt, now)} ago.` : ''} {SAT_CREDIT}.
      </p>
      {!shown ? (
        <button className="px-2 py-1.5 text-2xs text-wt-fg hover:underline" onClick={() => setShown(true)}>
          [COMPUTE SATELLITE PASSES]
        </button>
      ) : !data ? (
        <p className="px-2 py-1.5 text-2xs text-wt-fg-muted">{error ?? 'Loading satellite elements…'}</p>
      ) : passes.length === 0 ? (
        <p className="px-2 py-1.5 text-2xs text-wt-fg-muted">No passes in the next {HOURS} hours.</p>
      ) : (
        <div className="max-h-72 overflow-y-auto" tabIndex={0} role="region" aria-label="Satellite passes">
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-wt-panel text-wt-fg-dim">
              <tr className="border-b border-wt-line">
                <th className="px-2 py-1 text-left font-normal">Start (UTC)</th>
                <th className="px-2 py-1 text-left font-normal">Minutes</th>
                <th className="px-2 py-1 text-left font-normal">Satellite</th>
                <th className="px-2 py-1 text-left font-normal">Group</th>
                <th className="px-2 py-1 text-right font-normal">Altitude</th>
              </tr>
            </thead>
            <tbody>
              {passes.map(({ s, p }) => (
                <tr key={`${s.el.NORAD_CAT_ID}-${p.start}`} className="border-b border-wt-line last:border-0">
                  <td className="px-2 py-1">{formatUtc(new Date(p.start).toISOString())}</td>
                  <td className="px-2 py-1">{Math.max(1, Math.round((p.end - p.start) / 60_000))}</td>
                  <td className="px-2 py-1">
                    <Link to={`/?at=${p.closest.lat.toFixed(2)},${p.closest.lon.toFixed(2)},3&sel=sat:${s.el.NORAD_CAT_ID}`} className="hover:underline">
                      {s.el.OBJECT_NAME}
                    </Link>
                  </td>
                  <td className="px-2 py-1 text-wt-fg-muted">{s.g === 'military' ? 'military' : 'imaging'}</td>
                  <td className="px-2 py-1 text-right">{Math.round(p.closest.altKm)} km</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <p className="border-t border-wt-line px-2 py-1 text-2xs text-wt-fg-dim">{data.groups.map((g) => `${SAT_GROUPS.find((x) => x.id === g.id)?.label ?? g.id}: ${g.count}`).join(' · ')}</p>}
    </Panel>
  );
}
