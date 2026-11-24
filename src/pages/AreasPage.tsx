import { useEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { describeShape, shapeBounds, shapeCentre, type WatchArea } from '@shared/domain/watchAreas';
import { underseaName, UNDERSEA_LABEL } from '@shared/domain/undersea';
import { INFRA_LABEL, type InfraType } from '@shared/domain/infrastructure';
import { useData } from '../state/DataContext';
import { useWatchAreas } from '../state/WatchAreasContext';
import { useNow } from '../hooks/useNow';
import { useBases, useInfrastructure, useUndersea } from '../data/useInstallations';
import { areaContents, recentInside, type AreaContents } from '../lib/areaContents';
import { formatAge, formatUtc } from '../lib/time';
import { safeExternalUrl } from '../lib/sanitize';
import { Panel } from '../components/ui/Panel';
import { Tag } from '../components/ui/Tag';

/** A GOC link that opens the map on the area with it selected. */
function mapLinkFor(a: WatchArea): string {
  const [w, s, e, n] = shapeBounds(a.shape);
  const span = Math.max(e - w, n - s, 0.05);
  const zoom = Math.max(1, Math.min(11, Math.log2(360 / span) - 0.6));
  const [la, lo] = shapeCentre(a.shape);
  return `/?at=${la.toFixed(3)},${lo.toFixed(3)},${zoom.toFixed(1)}&sel=warea:${a.id}`;
}

/** Everything the app has loaded, for working out what is inside an area. */
function useAreaSources() {
  const data = useData();
  const bases = useBases(true, true, null);
  const infra = useInfrastructure(true);
  const undersea = useUndersea(true);
  return {
    events: data.events,
    aircraft: data.aircraft?.aircraft,
    emergencies: data.aircraftEmergencies?.aircraft,
    ships: data.sanctionedShips?.sightings,
    navWarnings: data.navWarnings?.warnings,
    gnssCells: data.gnss?.cells,
    lostGps: data.gnss?.lost,
    conflicts: data.conflictEvents?.events,
    bases: bases.us.data?.installations,
    worldBases: bases.world.data?.installations,
    sites: infra.data?.sites,
    flaggedSites: data.infrastructure?.flagged,
    lines: undersea.data?.lines,
  };
}

function AlertLine({ a }: { a: WatchArea }) {
  return a.alert.enabled ? (
    <span>
      <Tag tone="warn">{a.alert.severity}</Tag> {a.alert.categories.length ? a.alert.categories.join(', ') : 'all categories'}
      {a.alert.discord ? ' · Discord' : ''}
    </span>
  ) : (
    <span className="text-wt-fg-muted">No alert</span>
  );
}

/** /areas: every watch area with what has happened inside it lately. */
export default function AreasPage() {
  const { id } = useParams();
  return id ? <AreaDetail id={id} /> : <AreaList />;
}

function AreaList() {
  const watch = useWatchAreas();
  const sources = useAreaSources();
  const now = useNow(60_000).getTime();
  useEffect(() => {
    document.title = 'WATCHTOWER // WATCH AREAS';
  }, []);
  const rows = useMemo(() => watch.areas.map((a) => ({ a, c: areaContents(a.shape, sources) })), [watch.areas, sources]);
  return (
    <div className="h-full space-y-1.5 overflow-y-auto p-1.5">
      <Panel title={`Watch areas (${watch.areas.length})`} designator="WA">
        <p className="border-b border-wt-line px-2 py-1 text-2xs text-wt-fg-dim">
          Circles and polygons drawn with the AREA tool on the GOC map{watch.storage === 'local' ? ' (demo mode: kept in this browser only)' : ', shared with every member'}. Each can alert on exactly located records inside it. Records placed only at a city or country are not counted.
        </p>
        {watch.error && <p role="alert" className="px-2 py-1 text-2xs text-wt-crit">{watch.error}</p>}
        {watch.loading ? (
          <p className="p-3 text-xs text-wt-fg-muted">LOADING…</p>
        ) : rows.length === 0 ? (
          <p className="p-3 text-xs text-wt-fg-muted">
            No watch areas yet. On the <Link to="/" className="text-wt-info underline">GOC map</Link>, use AREA to draw one{watch.canEdit ? '' : ' (the owner and editors can draw them)'}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-2xs tabular-nums">
              <thead className="text-wt-fg-dim">
                <tr className="border-b border-wt-line">
                  <th className="px-2 py-1 text-left font-normal">AREA</th>
                  <th className="px-2 text-left font-normal">SHAPE</th>
                  <th className="px-2 text-left font-normal">ALERT</th>
                  <th className="px-2 text-right font-normal">RECORDS 24 H</th>
                  <th className="px-2 text-right font-normal">7 DAYS</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ a, c }) => (
                  <tr key={a.id} className="border-b border-wt-line last:border-0">
                    <td className="px-2 py-1">
                      <Link to={`/areas/${a.id}`} className="text-wt-fg hover:underline">{a.name}</Link>
                    </td>
                    <td className="px-2 text-wt-fg-muted">{describeShape(a.shape)}</td>
                    <td className="px-2"><AlertLine a={a} /></td>
                    <td className="px-2 text-right">{recentInside(c, now, 24).length}</td>
                    <td className="px-2 text-right">{recentInside(c, now, 168).length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function Section({ title, items }: { title: string; items: { key: string; text: string; detail?: string }[] }) {
  if (!items.length) return null;
  return (
    <div className="border-t border-wt-line px-2 py-1.5">
      <p className="text-wt-fg-dim">
        {title} ({items.length})
      </p>
      <ul className="mt-0.5 space-y-0.5">
        {items.slice(0, 50).map((i) => (
          <li key={i.key}>
            <span className="text-wt-fg">{i.text}</span>
            {i.detail && <span className="text-wt-fg-muted"> · {i.detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function insideNow(c: AreaContents) {
  return [
    { title: 'MILITARY AIRCRAFT', items: c.aircraft.map((a) => ({ key: a.hex, text: a.cs?.trim() || a.reg || a.hex.toUpperCase(), detail: [a.t, a.cls].filter(Boolean).join(' · ') })) },
    { title: 'AIRCRAFT EMERGENCIES', items: c.emergencies.map((a) => ({ key: `${a.hex}${a.sq}`, text: a.cs?.trim() || a.hex.toUpperCase(), detail: `squawk ${a.sq}` })) },
    { title: 'SANCTIONED SHIPS (48 H)', items: c.ships.map((s) => ({ key: s.mmsi, text: s.listedName, detail: `${s.sog ?? '?'} kn · ${formatUtc(s.seenAt)}` })) },
    { title: 'NGA WARNINGS', items: c.navWarnings.map((w) => ({ key: w.key, text: w.key, detail: `${w.kind}${w.issuedAt ? ` · ${formatUtc(w.issuedAt)}` : ''}` })) },
    { title: 'GPS INTERFERENCE SQUARES (24 H)', items: c.gnssCells.filter((x) => x.level !== 'low').map((x) => ({ key: x.k, text: x.k.replace('|', '°N ') + '°E', detail: `${x.level}, ${x.bad}/${x.n}` })) },
    { title: 'GPS LOST HERE (24 H)', items: c.lostGps.map((p, i) => ({ key: `${i}`, text: `${p.la.toFixed(2)}, ${p.lo.toFixed(2)}`, detail: `${formatUtc(p.at)}${p.cs ? ` · ${p.cs}` : ''}` })) },
    { title: 'CONFLICT EVENTS (UCDP, LATEST RELEASE)', items: c.conflicts.map((x) => ({ key: String(x.id), text: `${x.a} vs ${x.b}`, detail: `${x.d}${x.k ? ` · ${x.k} killed (best estimate)` : ''}` })) },
    { title: 'BASES', items: c.bases.map((b) => ({ key: b.key, text: b.name })) },
    { title: 'SITES', items: c.sites.map((s) => ({ key: s.id, text: s.name, detail: `${INFRA_LABEL[s.type as InfraType] ?? s.type}${s.flagged ? ' · flagged' : ''}` })) },
    { title: 'UNDERSEA CABLES AND PIPELINES', items: c.lines.map((l) => ({ key: l.id, text: underseaName(l), detail: UNDERSEA_LABEL[l.k] })) },
  ];
}

function AreaDetail({ id }: { id: string }) {
  const watch = useWatchAreas();
  const sources = useAreaSources();
  const now = useNow(60_000).getTime();
  const area = watch.areas.find((a) => a.id === id) ?? null;
  useEffect(() => {
    document.title = `WATCHTOWER // ${area ? area.name.toUpperCase() : 'WATCH AREA'}`;
  }, [area]);
  const c = useMemo(() => (area ? areaContents(area.shape, sources) : null), [area, sources]);
  if (watch.loading) return <p className="p-3 text-xs text-wt-fg-muted">LOADING…</p>;
  if (!area || !c) {
    return (
      <div className="grid h-full place-items-center text-center text-xs">
        <div>
          <p className="tracking-widest text-wt-warn">UNKNOWN WATCH AREA</p>
          <Link to="/areas" className="mt-2 inline-block text-wt-fg-muted hover:text-wt-fg">[ALL WATCH AREAS]</Link>
        </div>
      </div>
    );
  }
  const week = recentInside(c, now, 24 * 30);
  return (
    <div className="h-full space-y-1.5 overflow-y-auto p-1.5">
      <Panel title={`Watch area // ${area.name}`} designator="WA">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 px-2 py-1.5 text-2xs">
          <dt className="text-wt-fg-dim">SHAPE</dt>
          <dd>{describeShape(area.shape)}</dd>
          <dt className="text-wt-fg-dim">ALERT</dt>
          <dd><AlertLine a={area} /></dd>
          <dt className="text-wt-fg-dim">RECORDS INSIDE</dt>
          <dd className="tabular-nums">
            {recentInside(c, now, 24).length} in 24 h · {recentInside(c, now, 168).length} in 7 days · {c.records.length} loaded
          </dd>
          {area.note && (
            <>
              <dt className="text-wt-fg-dim">NOTE</dt>
              <dd>{area.note}</dd>
            </>
          )}
        </dl>
        <p className="border-t border-wt-line px-2 py-1 text-2xs">
          <Link to={mapLinkFor(area)} className="text-wt-info underline">Show on the map</Link>
          <span className="text-wt-fg-dim"> · edit or delete it from its card there · </span>
          <Link to="/areas" className="text-wt-info underline">All watch areas</Link>
        </p>
      </Panel>
      <div className="grid gap-1.5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Panel title={`Records inside (${week.length})`} designator="W1" bodyClassName="max-h-[560px] overflow-y-auto">
          <p className="border-b border-wt-line px-2 py-1 text-2xs text-wt-fg-dim">Exactly located records the dashboard has loaded, newest first. Records placed only at a city or country are not tested.</p>
          {week.length === 0 ? (
            <p className="px-2 py-1.5 text-2xs text-wt-fg-muted">None.</p>
          ) : (
            <ul className="divide-y divide-wt-line text-2xs">
              {week.slice(0, 200).map((e) => {
                const url = safeExternalUrl(e.sourceUrl);
                return (
                  <li key={e.id} className="px-2 py-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Tag>{e.category.toUpperCase()}</Tag>
                      <span className="text-wt-fg-muted tabular-nums" title={formatUtc(e.occurredAt ?? e.publishedAt ?? e.collectedAt)}>
                        {formatAge(e.occurredAt ?? e.publishedAt ?? e.collectedAt, now)} ago
                      </span>
                      <span className="text-wt-fg-dim">{e.sourceName}</span>
                    </div>
                    <p className="text-xs text-wt-fg">
                      {e.title}{' '}
                      {url && (
                        <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center text-wt-info" aria-label="Open source">
                          <ExternalLink size={9} />
                        </a>
                      )}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
        <Panel title="Inside now" designator="W2">
          <p className="px-2 py-1 text-2xs text-wt-fg-dim">From the latest map layers: snapshots, not live tracks.</p>
          <div className="text-2xs">
            {insideNow(c).map((s) => <Section key={s.title} title={s.title} items={s.items} />)}
          </div>
        </Panel>
      </div>
    </div>
  );
}
