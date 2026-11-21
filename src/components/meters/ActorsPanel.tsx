import type { ActorsSnapshot } from '@shared/domain/actors';
import { getRegion } from '@shared/domain/regions';
import { safeExternalUrl } from '../../lib/sanitize';
import { formatAge } from '../../lib/time';
import { Panel } from '../ui/Panel';
import { Tag } from '../ui/Tag';
import { Sparkline } from './MeterCard';

/** Tracked people and groups (mentions, 14-day line) and new names, for all regions or one. */
export function ActorsPanel({ data, regionId, now, designator = 'M7' }: { data: ActorsSnapshot | null; regionId?: string; now: number; designator?: string }) {
  if (!data) return null;
  const actors = data.actors.filter((a) => (!regionId || a.regionIds.includes(regionId)) && a.last7d > 0);
  const names = data.newNames.filter((n) => !regionId || n.regionIds.includes(regionId));
  if (regionId && !actors.length && !names.length) return null;
  const day = 86_400_000;
  return (
    <Panel title="People and groups" designator={designator} actions={data.simulated ? <Tag tone="warn">SIMULATED</Tag> : undefined}>
      {actors.length > 0 && (
        <table className="w-full text-2xs" aria-label="Tracked people and groups">
          <thead className="text-wt-fg-dim">
            <tr>
              <th className="px-2 py-0.5 text-left font-normal">NAME</th>
              <th className="px-1 py-0.5 text-right font-normal" title="Records naming them">24 H</th>
              <th className="px-1 py-0.5 text-right font-normal">72 H</th>
              <th className="px-1 py-0.5 text-right font-normal">7 D</th>
              <th className="px-2 py-0.5 text-left font-normal">14 DAYS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-wt-line">
            {actors.slice(0, regionId ? 10 : 20).map((a) => (
              <tr key={a.id}>
                <td className="px-2 py-0.5">
                  {a.name}
                  {a.rising && (
                    <span className="ml-1">
                      <Tag tone="warn" title={`Usual: ${a.usual72h} per 72 h`}>RISING</Tag>
                    </span>
                  )}
                  {!regionId && <span className="text-wt-fg-dim"> · {a.regionIds.map((r) => getRegion(r)?.shortCode ?? r).join('/')}</span>}
                </td>
                <td className="px-1 py-0.5 text-right tabular-nums">{a.last24h}</td>
                <td className="px-1 py-0.5 text-right tabular-nums">{a.last72h}</td>
                <td className="px-1 py-0.5 text-right tabular-nums">{a.last7d}</td>
                <td className="px-2 py-0.5">
                  <Sparkline points={a.daily.map((v, i) => ({ t: now - (13 - i) * day, v }))} width={84} height={16} emptyText="" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="border-t border-wt-line px-2 py-1 text-2xs">
        <h3 className="text-wt-fg-dim">NEW NAMES — FIRST SEEN IN 7 DAYS</h3>
        {names.length === 0 ? (
          <p className="text-wt-fg-dim">None with 2 or more headlines{regionId ? ' about this region' : ''}. Tracking since {data.trackingSince.slice(0, 10)}.</p>
        ) : (
          <ul className="space-y-0.5">
            {names.map((n) => {
              const url = safeExternalUrl(n.sample.url);
              return (
                <li key={n.name} className="flex flex-wrap gap-x-1.5">
                  <span className="text-wt-fg">{n.name}</span>
                  <span className="text-wt-fg-dim">
                    {n.mentions} headlines, {n.publishers} publisher{n.publishers > 1 ? 's' : ''} · first seen {formatAge(n.firstSeen, now)} ago
                  </span>
                  {url && (
                    <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="min-w-0 basis-full truncate text-wt-fg-muted hover:underline">
                      {n.sample.title}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <p className="border-t border-wt-line px-2 py-1 text-2xs text-wt-fg-dim">
        Tracked names are a curated list (shared/domain/actors.ts). New names are capitalised word runs in sentence-case headlines, minus places, institutions and tracked names: candidates, not identifications.
      </p>
    </Panel>
  );
}
