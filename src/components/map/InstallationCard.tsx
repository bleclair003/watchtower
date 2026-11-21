import { useMemo, type ReactNode } from 'react';
import { ExternalLink, X } from 'lucide-react';
import type { IntelligenceEvent } from '@shared/domain/types';
import {
  STATUS_LABEL,
  componentOf,
  dodRef,
  installationAliases,
  operationOf,
  operatorCountriesOf,
  relatedRecords,
  worldRef,
  type Installation,
  type InstallationDataset,
  type PlaceRef,
  type WorldDataset,
  type WorldInstallation,
} from '@shared/domain/installations';
import { US_STATE_NAMES } from '@shared/domain/geo/usPlaces';
import { countryName } from '../../lib/regionSummary';
import { formatAge } from '../../lib/time';
import { safeExternalUrl } from '../../lib/sanitize';
import { Tag } from '../ui/Tag';
import { BRANCH_COLOR, OPERATION_COLOR, OPERATION_LABEL } from './WorldMap';
import { BASE_ACTIVITY, type BaseActivitySnapshot } from '@shared/domain/baseActivity';

export type SelectedSite =
  | { kind: 'dod'; site: Installation; dataset: InstallationDataset }
  | { kind: 'world'; site: WorldInstallation; dataset: WorldDataset };

interface Props {
  selected: SelectedSite;
  /** Records currently loaded (the newest ~700). */
  events: IntelligenceEvent[];
  now: number;
  onClose: () => void;
  /** Weekly activity for all installations (snapshot), if loaded. */
  activity?: BaseActivitySnapshot | null;
}

const MAX_ROWS = 12;

/** This week's records against the usual weekly level (computed by the collector over its loaded history). */
function ActivityBlock({ activity, siteKey }: { activity: BaseActivitySnapshot; siteKey: string }) {
  const item = activity.items.find((i) => i.key === siteKey);
  const week = item?.week ?? 0;
  return (
    <div className={`border-t border-wt-line px-2 py-1 ${item?.unusual ? 'bg-wt-warn/10' : ''}`}>
      <div className="flex items-center gap-1.5">
        <span className="text-wt-fg-dim">ACTIVITY — LAST 7 DAYS</span>
        {item?.unusual && <span className="border border-wt-warn px-1 text-wt-warn">UNUSUAL</span>}
        {activity.simulated && <span className="text-wt-fg-dim">(SIMULATED)</span>}
      </div>
      <p className="tabular-nums">
        {week} record{week === 1 ? '' : 's'}
        {item ? ` (${item.named} naming it, ${item.nearby} within ${BASE_ACTIVITY.radiusKm} km; ${item.sources} source${item.sources === 1 ? '' : 's'})` : ''}
        {' · usual '}
        {activity.flagsActive && item?.usualPerWeek !== null && item?.usualPerWeek !== undefined
          ? `${item.usualPerWeek} a week (${activity.baselineWeeks} earlier weeks)`
          : activity.flagsActive
            ? `0 a week (${activity.baselineWeeks} earlier weeks)`
            : `not yet known (${activity.historyDays} of ${BASE_ACTIVITY.minHistoryDays} days of history)`}
      </p>
      <p className="text-wt-fg-dim">
        Unusual = at least {BASE_ACTIVITY.minWeek} records from {BASE_ACTIVITY.minSources}+ sources and {BASE_ACTIVITY.ratio}× the usual week. Location matches leave out weather, earthquake, fire and disaster records.
      </p>
    </div>
  );
}

function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  const safe = safeExternalUrl(href);
  if (!safe) return null;
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-0.5 text-wt-info underline">
      {children} <ExternalLink size={9} aria-hidden />
    </a>
  );
}

/** Facts from the source dataset, plus WATCHTOWER records that name the installation or lie within 50 km. */
export function InstallationCard({ selected, events, now, onClose, activity }: Props) {
  const ref: PlaceRef = selected.kind === 'dod' ? dodRef(selected.site) : worldRef(selected.site);
  const related = useMemo(() => relatedRecords(ref, events), [ref.name, ref.lat, ref.lon, ref.country, events]); // eslint-disable-line react-hooks/exhaustive-deps
  const tfrs = related.filter((r) => r.event.sourceId === 'faa-tfr');
  const others = related.filter((r) => r.event.sourceId !== 'faa-tfr');
  const aliases = installationAliases(ref.name).filter((a) => a !== ref.name);
  const osm = `https://www.openstreetmap.org/?mlat=${ref.lat}&mlon=${ref.lon}#map=12/${ref.lat}/${ref.lon}`;

  let dot: string;
  let subtitle: string;
  let rows: ReactNode;
  if (selected.kind === 'dod') {
    const i = selected.site;
    const comp = componentOf(i.component);
    dot = BRANCH_COLOR[comp.branch];
    subtitle = `${comp.label} · ${US_STATE_NAMES[i.state] ?? i.state}`;
    rows = (
      <>
        <dt className="text-wt-fg-dim">STATUS</dt>
        <dd>
          <Tag tone={i.status === 'act' ? 'ok' : 'inactive'}>{(STATUS_LABEL[i.status] ?? i.status).toUpperCase()}</Tag>
          {i.joint && <span className="ml-1"><Tag tone="info">JOINT BASE</Tag></span>}
        </dd>
        <dt className="text-wt-fg-dim">SOURCE</dt>
        <dd className="text-wt-fg-muted">
          DoD MIRTA ({selected.dataset.dataCurrency}) · {selected.dataset.licence}
        </dd>
        <dt className="text-wt-fg-dim">LOOK UP</dt>
        <dd className="flex gap-2">
          <ExtLink href={`https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(i.name)}`}>Wikipedia</ExtLink>
          <ExtLink href={osm}>OpenStreetMap</ExtLink>
        </dd>
      </>
    );
  } else {
    const w = selected.site;
    const op = operationOf(w);
    dot = OPERATION_COLOR[op];
    subtitle = `${w.k.join(', ')} · ${w.c ? countryName(w.c) : 'country not recorded'}`;
    rows = (
      <>
        <dt className="text-wt-fg-dim">OPERATED</dt>
        <dd>
          <Tag tone={op === 'national' ? 'muted' : 'info'}>{OPERATION_LABEL[op].toUpperCase()}</Tag>
        </dd>
        <dt className="text-wt-fg-dim">OPERATOR COUNTRY</dt>
        <dd className="text-wt-fg-muted">
          {(() => {
            const oc = operatorCountriesOf(w);
            if (!oc.codes.length) return 'Not recorded';
            return `${oc.codes.map(countryName).join(', ')}${oc.presumed ? ' (presumed: host country, no operator recorded)' : ''}`;
          })()}
        </dd>
        <dt className="text-wt-fg-dim">OPERATORS</dt>
        <dd className="text-wt-fg-muted">
          {w.o.length ? w.o.join(' · ') : 'Not recorded'}
          {w.o.length > 0 && <span className="block text-wt-fg-dim">From Wikidata; may include former operators.</span>}
        </dd>
        <dt className="text-wt-fg-dim">SOURCE</dt>
        <dd className="text-wt-fg-muted">
          Wikidata ({selected.dataset.dataCurrency}) · CC0 · community-maintained, not official
        </dd>
        <dt className="text-wt-fg-dim">LOOK UP</dt>
        <dd className="flex flex-wrap gap-x-2">
          {w.w ? (
            <ExtLink href={`https://en.wikipedia.org/wiki/${encodeURIComponent(w.w.replace(/ /g, '_'))}`}>Wikipedia</ExtLink>
          ) : (
            <ExtLink href={`https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(w.n)}`}>Wikipedia search</ExtLink>
          )}
          <ExtLink href={`https://www.wikidata.org/wiki/${encodeURIComponent(w.q)}`}>Wikidata</ExtLink>
          <ExtLink href={osm}>OpenStreetMap</ExtLink>
        </dd>
      </>
    );
  }

  return (
    <section
      aria-label={`Installation: ${ref.name}`}
      className="absolute right-2 bottom-2 z-10 max-h-[calc(100%-1rem)] w-[min(360px,calc(100%-1rem))] overflow-y-auto border border-wt-line-strong bg-wt-panel/95 text-2xs shadow-lg"
    >
      <header className="flex items-start gap-2 border-b border-wt-line px-2 py-1.5">
        <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ background: dot }} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-wt-fg">{ref.name}</p>
          <p className="text-wt-fg-muted">{subtitle}</p>
        </div>
        <button onClick={onClose} aria-label="Close installation details" className="text-wt-fg-muted hover:text-wt-fg">
          <X size={12} />
        </button>
      </header>

      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 px-2 py-1.5">
        {rows}
        <dt className="text-wt-fg-dim">LOCATION</dt>
        <dd className="tabular-nums">
          {ref.lat.toFixed(4)}, {ref.lon.toFixed(4)} <span className="text-wt-fg-dim">(dataset point)</span>
        </dd>
        {aliases.length > 0 && (
          <>
            <dt className="text-wt-fg-dim">ALSO MATCHED AS</dt>
            <dd className="text-wt-fg-muted">{aliases.join(' · ')}</dd>
          </>
        )}
      </dl>

      {activity && <ActivityBlock activity={activity} siteKey={selected.kind === 'dod' ? `dod:${selected.site.name}` : `wd:${selected.site.q}`} />}
      {selected.kind === 'dod' && (
        <Section title={`FAA flight restrictions (${tfrs.length})`} empty="No current security or VIP flight restriction names this installation." rows={tfrs} now={now} />
      )}
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
