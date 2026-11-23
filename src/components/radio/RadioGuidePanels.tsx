import { useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { getRegion } from '@shared/domain/regions';
import { TWENTE_WEBSDR, kiwiTuneUrl, nearestReceivers, regionCentre, twenteTuneUrl, type RadioReceiversSnapshot } from '@shared/domain/radio';
import {
  shortwaveForRegion,
  sortForNow,
  stationsForCountries,
  swMode,
  type LocalStation,
  type RadioGuide,
  type SwBroadcast,
} from '@shared/domain/shortwave';
import { safeExternalUrl } from '../../lib/sanitize';
import { useRadioGuide } from '../../data/useRadioGuide';
import { formatAge, formatUtc } from '../../lib/time';
import { Panel } from '../ui/Panel';
import { Tag } from '../ui/Tag';

const ext = { target: '_blank', rel: 'noopener noreferrer nofollow' } as const;
const SHOW = 20;

interface GuideProps {
  regionId: string;
  guide: RadioGuide | null;
  loading: boolean;
  error: string | null;
  now: number;
}

const regionName = (id: string) => getRegion(id)?.name ?? id;

function GuideState({ loading, error, what }: { loading: boolean; error: string | null; what: string }) {
  if (loading) return <p className="text-wt-fg-dim">Loading the radio guide…</p>;
  if (error) return <p className="text-wt-warn">{error}</p>;
  return <p className="text-wt-fg-dim">The {what} has not been collected yet (it is fetched once a day).</p>;
}

// ── Shortwave ─────────────────────────────────────────────────────────────

/** Phase 29: shortwave transmissions aimed at a region, and from stations based in it (EiBi schedule). */
export function ShortwavePanel({ regionId, guide, loading, error, now, receivers, designator = 'SW' }: GuideProps & { receivers: RadioReceiversSnapshot | null; designator?: string }) {
  const sw = guide?.shortwave ?? null;
  const [dir, setDir] = useState<'to' | 'from'>('to');
  const [onlyNow, setOnlyNow] = useState(true);
  const split = useMemo(() => (sw ? shortwaveForRegion(sw.broadcasts, regionId) : { to: [], from: [] }), [sw, regionId]);
  const rows = useMemo(() => sortForNow(split[dir], now).filter((b) => !onlyNow || b.air !== 'no'), [split, dir, now, onlyNow]);
  const broadcast = rows.filter((b) => !b.utility);
  const utility = rows.filter((b) => b.utility);
  const [lat, lon] = regionCentre(regionId);
  return (
    <Panel title={`Shortwave — ${regionName(regionId)}`} designator={designator}>
      <div className="space-y-2 px-2 py-1.5 text-2xs">
        {!sw ? (
          <GuideState loading={loading} error={error} what="shortwave schedule" />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Which transmissions">
              {(['to', 'from'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={dir === d}
                  onClick={() => setDir(d)}
                  className={`border px-1.5 py-0.5 ${dir === d ? 'border-wt-info text-wt-info' : 'border-wt-line text-wt-fg-muted hover:text-wt-fg'}`}
                >
                  {d === 'to' ? `Aimed at the region (${split.to.length})` : `From stations in the region (${split.from.length})`}
                </button>
              ))}
              <label className="ml-1 inline-flex items-center gap-1 text-wt-fg-muted">
                <input type="checkbox" checked={onlyNow} onChange={(e) => setOnlyNow(e.target.checked)} /> On the schedule now
              </label>
            </div>
            <SwSection title="Broadcasters" rows={broadcast} sw={sw} dir={dir} lat={lat} lon={lon} receivers={receivers} empty={onlyNow ? 'None scheduled at this hour.' : 'None listed.'} />
            <SwSection
              title="Military, numbers and other utility stations"
              note="Traffic not meant for the public: some countries, the UK among them, forbid listening to it or passing on what you hear."
              rows={utility}
              sw={sw}
              dir={dir}
              lat={lat}
              lon={lon}
              receivers={receivers}
              empty={onlyNow ? 'None scheduled at this hour.' : 'None listed.'}
            />
            <div className="space-y-0.5 border-t border-wt-line pt-1.5 text-wt-fg-dim">
              <p>
                Source:{' '}
                <a href={sw.sourceUrl} {...ext} className="inline-flex items-center gap-0.5 hover:text-wt-fg hover:underline">
                  EiBi shortwave schedule {sw.season} <ExternalLink size={9} aria-hidden />
                </a>
                {sw.simulated ? ' (SIMULATED)' : ''}, fetched {formatUtc(sw.fetchedAt)} ({formatAge(sw.fetchedAt, now)}).
              </p>
              <p>
                A schedule, not a log: "on now" means listed for now. Stations go off the air, change frequency or are jammed without the list showing it, and
                hearing one depends on propagation. Frequency links open the receiver nearest the region; a broadcast aimed elsewhere may be heard better near its target.
              </p>
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}

interface SectionProps {
  title: string;
  note?: string;
  rows: (SwBroadcast & { air: 'yes' | 'no' | 'unknown' })[];
  sw: NonNullable<RadioGuide['shortwave']>;
  dir: 'to' | 'from';
  lat: number;
  lon: number;
  receivers: RadioReceiversSnapshot | null;
  empty: string;
}

function SwSection({ title, note, rows, sw, dir, lat, lon, receivers, empty }: SectionProps) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, SHOW);
  return (
    <section className="space-y-1">
      <h3 className="text-wt-fg-muted uppercase tracking-wider">
        {title} <span className="text-wt-fg-dim tabular-nums">({rows.length})</span>
      </h3>
      {note && <p className="text-wt-fg-dim">{note}</p>}
      {rows.length === 0 ? (
        <p className="text-wt-fg-dim">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {shown.map((b, i) => (
            <SwRow key={`${b.station}|${b.start}|${b.kHz.join(',')}|${i}`} b={b} sw={sw} dir={dir} lat={lat} lon={lon} receivers={receivers} />
          ))}
        </ul>
      )}
      {rows.length > SHOW && (
        <button type="button" onClick={() => setAll(!all)} className="text-wt-info hover:underline">
          {all ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
    </section>
  );
}

function SwRow({ b, sw, dir, lat, lon, receivers }: { b: SwBroadcast & { air: 'yes' | 'no' | 'unknown' }; sw: NonNullable<RadioGuide['shortwave']>; dir: 'to' | 'from'; lat: number; lon: number; receivers: RadioReceiversSnapshot | null }) {
  const mode = swMode(b);
  const near = receivers ? nearestReceivers(receivers.receivers, lat, lon, b.kHz.slice(0, 1), 1)[0] : undefined;
  const tune = (k: number) => (near ? kiwiTuneUrl(near, k, mode) : k <= TWENTE_WEBSDR.maxKhz ? twenteTuneUrl(k, mode) : null);
  const lang = b.lang ? (sw.languages[b.lang] ?? b.lang) : null;
  const place = (code: string) => sw.countries[code] ?? code;
  const relay = b.site.startsWith('/') ? b.site.slice(1).split('-')[0] : null;
  return (
    <li className="space-y-0.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {b.air === 'yes' ? (
          <Tag tone="info" title="Listed in the schedule for this hour">ON NOW</Tag>
        ) : b.air === 'unknown' ? (
          <Tag tone="muted" title={`Day rule "${b.days}": irregular or unusual, so whether it is on now is not known`}>{b.days || '?'}</Tag>
        ) : null}
        <span className="text-xs text-wt-fg">{b.station}</span>
        {lang && <span className="text-wt-fg-muted">{lang}</span>}
      </div>
      <p className="text-wt-fg-dim">
        <span className="tabular-nums">
          {b.start}–{b.end} UTC
        </span>
        {b.days && b.air !== 'unknown' ? ` · ${b.days}` : ''}
        {dir === 'to' ? ` · from ${place(b.itu)}` : ` · aimed at ${place(b.target)}`}
        {relay ? ` · relayed from ${place(relay)}` : ''}
        {b.dates ? ` · only ${b.dates[0].slice(0, 2)}/${b.dates[0].slice(2)} to ${b.dates[1].slice(0, 2)}/${b.dates[1].slice(2)}` : ''}
      </p>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-wt-fg-dim uppercase">{mode}</span>
        {b.kHz.map((k) => {
          const href = safeExternalUrl(tune(k));
          return href ? (
            <a key={k} href={href} {...ext} title={`Open ${near ? near.name : TWENTE_WEBSDR.name} tuned to ${k} kHz`} className="border border-wt-line px-1 text-wt-fg tabular-nums hover:bg-wt-bg2">
              {k}
            </a>
          ) : (
            <span key={k} className="border border-wt-line px-1 text-wt-fg-dim tabular-nums">
              {k}
            </span>
          );
        })}
      </div>
    </li>
  );
}

// ── Local radio ───────────────────────────────────────────────────────────

let regionNames: Intl.DisplayNames | null = null;
function countryName(cc: string): string {
  try {
    regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' });
    return regionNames.of(cc) ?? cc;
  } catch {
    return cc;
  }
}

/** Phase 29: internet radio stations in each of the region's countries (Radio Browser), news and talk first. */
export function LocalRadioPanel({ regionId, guide, loading, error, now, designator = 'LR' }: GuideProps & { designator?: string }) {
  const lr = guide?.localRadio ?? null;
  const codes = getRegion(regionId)?.countryCodes ?? [];
  const stations = lr ? stationsForCountries(lr.stations, codes) : [];
  return (
    <Panel title={`Local radio — ${regionName(regionId)}`} designator={designator}>
      <div className="space-y-2 px-2 py-1.5 text-2xs">
        {!lr ? (
          <GuideState loading={loading} error={error} what="station list" />
        ) : (
          <>
            <p className="text-wt-fg-dim">
              Stations broadcasting from inside the region often report alerts, closures and casualties before outside outlets. Links open the station's own page or
              stream in a new tab.
            </p>
            <ul className="space-y-1.5">
              {codes.map((cc) => {
                const list = stations.filter((s) => s.cc === cc);
                return (
                  <li key={cc}>
                    <span className="text-wt-fg-muted">{countryName(cc)}</span>
                    {list.length === 0 ? (
                      <span className="text-wt-fg-dim"> — none listed</span>
                    ) : (
                      <ul className="mt-0.5 space-y-0.5 pl-2">
                        {list.map((s) => (
                          <StationRow key={s.uuid} s={s} />
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="space-y-0.5 border-t border-wt-line pt-1.5 text-wt-fg-dim">
              <p>
                Source:{' '}
                <a href="https://www.radio-browser.info/" {...ext} className="inline-flex items-center gap-0.5 hover:text-wt-fg hover:underline">
                  Radio Browser community directory <ExternalLink size={9} aria-hidden />
                </a>
                {lr.simulated ? ' (SIMULATED)' : ''}, fetched {formatUtc(lr.fetchedAt)} ({formatAge(lr.fetchedAt, now)}). Up to 8 per country: news and talk first, then the
                most played. Entries are community-submitted and can be wrong or dead.
              </p>
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}

function StationRow({ s }: { s: LocalStation }) {
  const home = safeExternalUrl(s.homepage);
  const stream = safeExternalUrl(s.stream);
  return (
    <li className="flex flex-wrap items-center gap-1.5">
      {home ? (
        <a href={home} {...ext} className="inline-flex items-center gap-0.5 text-wt-fg hover:underline">
          {s.name} <ExternalLink size={9} aria-hidden />
        </a>
      ) : (
        <span className="text-wt-fg">{s.name}</span>
      )}
      {s.news && (
        <Tag tone="info" title="Tagged news or talk in the directory">
          NEWS
        </Tag>
      )}
      {stream && (
        <a href={stream} {...ext} title="Open the station's stream in a new tab" className="text-wt-info hover:underline">
          ▶ stream
        </a>
      )}
      {(s.language || s.state) && <span className="text-wt-fg-dim">{[s.state, s.language].filter(Boolean).join(' · ')}</span>}
    </li>
  );
}

/** Both Phase 29 panels for a geographic region (the guide is read once per visit). */
export function RadioGuideSection({ regionId, receivers, now }: { regionId: string; receivers: RadioReceiversSnapshot | null; now: number }) {
  const { guide, loading, error } = useRadioGuide();
  if (!getRegion(regionId)?.countryCodes.length) return null;
  return (
    <>
      <ShortwavePanel regionId={regionId} guide={guide} loading={loading} error={error} now={now} receivers={receivers} designator="SW" />
      <LocalRadioPanel regionId={regionId} guide={guide} loading={loading} error={error} now={now} designator="LR" />
    </>
  );
}
