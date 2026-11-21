import { useMemo } from 'react';
import { ExternalLink, X } from 'lucide-react';
import type { IntelligenceEvent } from '@shared/domain/types';
import { STATUS_LABEL, componentOf, installationAliases, relatedRecords, type Installation, type InstallationDataset } from '@shared/domain/installations';
import { US_STATE_NAMES } from '@shared/domain/geo/usPlaces';
import { formatAge } from '../../lib/time';
import { safeExternalUrl } from '../../lib/sanitize';
import { Tag } from '../ui/Tag';
import { BRANCH_COLOR } from './WorldMap';

interface Props {
  installation: Installation;
  dataset: InstallationDataset;
  /** Records currently loaded (the newest ~700). */
  events: IntelligenceEvent[];
  now: number;
  onClose: () => void;
}

const MAX_ROWS = 12;

/** Facts from the DoD dataset, plus WATCHTOWER records that name the installation or lie within 50 km. */
export function InstallationCard({ installation: i, dataset, events, now, onClose }: Props) {
  const comp = componentOf(i.component);
  const related = useMemo(() => relatedRecords(i, events), [i, events]);
  const tfrs = related.filter((r) => r.event.sourceId === 'faa-tfr');
  const others = related.filter((r) => r.event.sourceId !== 'faa-tfr');
  const aliases = installationAliases(i.name).filter((a) => a !== i.name);
  const search = `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(i.name)}`;
  const osm = `https://www.openstreetmap.org/?mlat=${i.lat}&mlon=${i.lon}#map=12/${i.lat}/${i.lon}`;

  return (
    <section
      aria-label={`Installation: ${i.name}`}
      className="absolute right-2 bottom-2 z-10 max-h-[calc(100%-1rem)] w-[min(360px,calc(100%-1rem))] overflow-y-auto border border-wt-line-strong bg-wt-panel/95 text-2xs shadow-lg"
    >
      <header className="flex items-start gap-2 border-b border-wt-line px-2 py-1.5">
        <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ background: BRANCH_COLOR[comp.branch] }} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-wt-fg">{i.name}</p>
          <p className="text-wt-fg-muted">
            {comp.label} · {US_STATE_NAMES[i.state] ?? i.state}
          </p>
        </div>
        <button onClick={onClose} aria-label="Close installation details" className="text-wt-fg-muted hover:text-wt-fg">
          <X size={12} />
        </button>
      </header>

      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 px-2 py-1.5">
        <dt className="text-wt-fg-dim">STATUS</dt>
        <dd>
          <Tag tone={i.status === 'act' ? 'ok' : 'inactive'}>{(STATUS_LABEL[i.status] ?? i.status).toUpperCase()}</Tag>
          {i.joint && <span className="ml-1"><Tag tone="info">JOINT BASE</Tag></span>}
        </dd>
        <dt className="text-wt-fg-dim">LOCATION</dt>
        <dd className="tabular-nums">
          {i.lat.toFixed(4)}, {i.lon.toFixed(4)} <span className="text-wt-fg-dim">(dataset point)</span>
        </dd>
        {aliases.length > 0 && (
          <>
            <dt className="text-wt-fg-dim">ALSO MATCHED AS</dt>
            <dd className="text-wt-fg-muted">{aliases.join(' · ')}</dd>
          </>
        )}
        <dt className="text-wt-fg-dim">SOURCE</dt>
        <dd className="text-wt-fg-muted">
          DoD MIRTA ({dataset.dataCurrency}) · {dataset.licence}
        </dd>
        <dt className="text-wt-fg-dim">LOOK UP</dt>
        <dd className="flex gap-2">
          <a href={safeExternalUrl(search)!} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-0.5 text-wt-info underline">
            Wikipedia <ExternalLink size={9} aria-hidden />
          </a>
          <a href={safeExternalUrl(osm)!} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-0.5 text-wt-info underline">
            OpenStreetMap <ExternalLink size={9} aria-hidden />
          </a>
        </dd>
      </dl>

      <Section title={`FAA flight restrictions (${tfrs.length})`} empty="No current security or VIP flight restriction names this installation." rows={tfrs} now={now} />
      <Section title={`WATCHTOWER records (${others.length})`} empty="No loaded record names this installation or lies within 50 km." rows={others} now={now} />
      <p className="border-t border-wt-line px-2 py-1 text-wt-fg-dim">
        Records are matched by name in the headline or summary, or by an exact location within 50 km, among the newest ~700 loaded. A name match is a mention, not confirmation of an event at the installation.
      </p>
    </section>
  );
}

function Section({ title, empty, rows, now }: { title: string; empty: string; rows: { event: IntelligenceEvent; reason: string }[]; now: number }) {
  return (
    <div className="border-t border-wt-line px-2 py-1.5">
      <p className="mb-0.5 tracking-wider text-wt-fg-dim">{title.toUpperCase()}</p>
      {rows.length === 0 ? (
        <p className="text-wt-fg-dim">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {rows.slice(0, MAX_ROWS).map(({ event: e, reason }) => {
            const url = safeExternalUrl(e.sourceUrl);
            return (
              <li key={e.id}>
                <span className="text-wt-fg-dim tabular-nums">{formatAge(e.publishedAt ?? e.collectedAt, now)} · </span>
                {url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="text-wt-fg hover:underline">
                    {e.title}
                  </a>
                ) : (
                  <span>{e.title}</span>
                )}
                <span className="block text-wt-fg-dim">
                  {e.sourceName.split(' — ')[0]} · {reason}
                </span>
              </li>
            );
          })}
          {rows.length > MAX_ROWS && <li className="text-wt-fg-dim">…and {rows.length - MAX_ROWS} more</li>}
        </ul>
      )}
    </div>
  );
}
