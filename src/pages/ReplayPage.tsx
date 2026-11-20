import { useEffect, useMemo, useState } from 'react';
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { INDICATOR_CATALOG, getIndicator } from '@shared/domain/indicators/catalog';
import { availableAt, collectionStart, isLateCollection, replayAt } from '@shared/domain/history/replay';
import { WATCH_REGIONS } from '@shared/domain/regions';
import { useData } from '../state/DataContext';
import { useArchive } from '../data/useArchive';
import { formatUtc } from '../lib/time';
import { BAND_TONE, INDICATOR_STATE_TONE } from '../config/indicators';
import { WorldMap } from '../components/map/WorldMap';
import { Panel } from '../components/ui/Panel';
import { Lamp, Tag } from '../components/ui/Tag';

const H = 3_600_000;
const SPEEDS = [
  { label: '1 H/S', hours: 1 },
  { label: '6 H/S', hours: 6 },
  { label: '1 D/S', hours: 24 },
];
const toLocalInput = (t: number) => new Date(t - new Date(t).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const floorHour = (t: number) => Math.floor(t / H) * H;

/** Historical Operations Replay: what WATCHTOWER knew, hour by hour. */
export default function ReplayPage() {
  const data = useData();
  const { archive, loading, error, load } = useArchive();
  const [fromInput, setFromInput] = useState(() => toLocalInput(floorHour(Date.now() - 7 * 24 * H)));
  // End rounded UP so the latest collected records are inside the window.
  const [toInput, setToInput] = useState(() => toLocalInput(floorHour(Date.now()) + H));
  const [window, setWindow] = useState<{ from: number; to: number } | null>(null);
  const [t, setT] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(6);
  const [reveal, setReveal] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'WATCHTOWER // REPLAY';
  }, []);

  useEffect(() => {
    if (!playing || !window || t === null) return;
    const id = globalThis.setInterval(() => {
      setT((cur) => {
        const next = (cur ?? window.from) + speed * H;
        if (next >= window.to) {
          setPlaying(false);
          return window.to;
        }
        return next;
      });
    }, 600);
    return () => globalThis.clearInterval(id);
  }, [playing, speed, window, t]);

  function loadWindow() {
    const from = floorHour(new Date(fromInput).getTime());
    const to = Math.ceil(new Date(toInput).getTime() / H) * H;
    if (!(from < to)) return;
    setWindow({ from, to });
    setT(from);
    setPlaying(false);
    // Indicators look back up to 31 days, so load history from before the window.
    void load(new Date(from - 32 * 24 * H).toISOString());
  }

  const frame = useMemo(
    () => (archive && t !== null ? replayAt(INDICATOR_CATALOG, archive.events, data.sourceStatus, t) : null),
    [archive, t, data.sourceStatus],
  );
  const start = collectionStart(data.sourceStatus);
  const recent = useMemo(
    () => (frame && t !== null ? frame.events.filter((e) => Date.parse(e.collectedAt) > t - 24 * H).sort((a, b) => b.collectedAt.localeCompare(a.collectedAt)) : []),
    [frame, t],
  );
  const mapEvents = useMemo(() => (frame && t !== null ? frame.events.filter((e) => Date.parse(e.publishedAt ?? e.collectedAt) > t - 7 * 24 * H) : []), [frame, t]);
  const later = useMemo(
    () => (archive && window && t !== null ? archive.events.filter((e) => Date.parse(e.collectedAt) > t && Date.parse(e.collectedAt) <= window.to) : []),
    [archive, window, t],
  );
  const laterDossiers = useMemo(() => {
    if (!archive || t === null) return [];
    return archive.incidents
      .map((i) => {
        const times = i.evidence.map((l) => Date.parse(l.event.occurredAt ?? l.event.publishedAt ?? l.event.collectedAt));
        return { i, start: times.length ? Math.min(...times) : Date.parse(i.createdAt) };
      })
      .filter((x) => x.start > t)
      .sort((a, b) => a.start - b.start);
  }, [archive, t]);
  const active = frame?.evaluations.filter((e) => e.state === 'TRIGGERED' || e.state === 'ELEVATED') ?? [];

  return (
    <div className="flex h-full flex-col gap-1.5 overflow-y-auto p-1.5">
      <Panel title="Historical Operations Replay" designator="R6">
        <div className="flex flex-wrap items-center gap-2 px-2 py-1.5 text-2xs">
          <span className="text-wt-fg-dim">WINDOW</span>
          <input aria-label="Replay from" type="datetime-local" value={fromInput} onChange={(e) => setFromInput(e.target.value)} className="h-6 border border-wt-line-strong bg-wt-bg px-1" />
          <span>→</span>
          <input aria-label="Replay to" type="datetime-local" value={toInput} onChange={(e) => setToInput(e.target.value)} className="h-6 border border-wt-line-strong bg-wt-bg px-1" />
          <button onClick={loadWindow} disabled={loading} className="h-6 border border-wt-fg/60 px-2 hover:bg-wt-fg hover:text-wt-bg disabled:opacity-50">
            {loading ? 'LOADING…' : 'LOAD'}
          </button>
          {archive && (
            <span className="text-wt-fg-dim">
              {archive.origin === 'archive' ? `${archive.events.length} records · ${archive.reads} reads` : 'demo data'}
              {archive.truncated && <span className="text-wt-warn"> · limit reached, oldest records may be missing</span>}
            </span>
          )}
        </div>
        <p className="border-t border-wt-line px-2 py-1 text-2xs text-wt-fg-dim">
          Hindsight rule: at each moment T, only records WATCHTOWER had actually COLLECTED by T are shown, and the indicator engine is re-run on
          exactly that data. Records published earlier but collected later appear when collected, tagged LATE. Source outages are not yet
          reconstructed: sources count as healthy from their first collection.
          {start && <> WATCHTOWER began collecting {formatUtc(new Date(start).toISOString())}.</>}
        </p>
        {error && <p role="alert" className="px-2 pb-2 text-xs text-wt-crit">ERROR: {error}</p>}
      </Panel>

      {window && t !== null && frame && (
        <>
          <div className="flex flex-wrap items-center gap-2 border border-wt-line-strong bg-wt-bg2 px-2 py-1 text-2xs">
            <button aria-label="Back" onClick={() => setT(Math.max(window.from, t - speed * H))} className="text-wt-fg-muted hover:text-wt-fg"><SkipBack size={12} /></button>
            <button aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying((p) => !p)} className="text-wt-fg hover:text-wt-info">
              {playing ? <Pause size={14} /> : <Play size={14} />}
            </button>
            <button aria-label="Forward" onClick={() => setT(Math.min(window.to, t + speed * H))} className="text-wt-fg-muted hover:text-wt-fg"><SkipForward size={12} /></button>
            <select aria-label="Playback speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="h-6 border border-wt-line-strong bg-wt-bg px-1">
              {SPEEDS.map((s) => <option key={s.hours} value={s.hours}>{s.label}</option>)}
            </select>
            <input
              aria-label="Replay time"
              type="range"
              min={window.from}
              max={window.to}
              step={H}
              value={t}
              onChange={(e) => { setT(Number(e.target.value)); setPlaying(false); }}
              className="min-w-40 flex-1 accent-[#6aff9b]"
            />
            <span className="glow font-display text-xs tracking-widest tabular-nums">T = {formatUtc(frame.at)}</span>
          </div>
          {frame.beforeCollection && (
            <p role="note" className="border border-wt-warn/50 bg-wt-warn/10 px-2 py-1 text-xs text-wt-warn">
              WATCHTOWER WAS NOT YET COLLECTING AT T. Nothing is shown because nothing was known, not because nothing happened.
            </p>
          )}

          <div className="grid gap-1.5 lg:min-h-[480px] lg:grid-cols-[230px_minmax(0,1fr)_340px]">
            <Panel title="RAI at T" designator="A">
              <ul className="divide-y divide-wt-line text-2xs">
                {WATCH_REGIONS.map((r) => {
                  const s = frame.scores.find((x) => x.regionId === r.id);
                  return (
                    <li key={r.id} className="flex items-center gap-1.5 px-2 py-1">
                      <span className="flex-1">{r.name}</span>
                      {!s || s.score === null ? <Tag tone="inactive">N/E</Tag> : <Tag tone={BAND_TONE[s.band!]}>{s.score}</Tag>}
                    </li>
                  );
                })}
              </ul>
              <p className="border-t border-wt-line px-2 py-1 text-2xs text-wt-fg-dim">ACTIVE INDICATORS AT T</p>
              <ul className="px-2 pb-2 text-2xs">
                {active.length === 0 && <li className="text-wt-fg-dim">none</li>}
                {active.map((e) => (
                  <li key={e.indicatorId} className="flex items-center gap-1.5">
                    <Lamp tone={INDICATOR_STATE_TONE[e.state]} label={e.state} />
                    {getIndicator(e.indicatorId)?.name}
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel title={`Map at T (${mapEvents.length} known, published within 7 d)`} designator="B" className="h-[380px] lg:h-auto" bodyClassName="relative">
              <WorldMap
                events={mapEvents}
                selectedEventId={selected}
                focusRegionId={null}
                onSelectEvent={setSelected}
                onSelectRegion={() => {}}
                showGraticule
                showRegions
                globalViewNonce={0}
              />
            </Panel>

            <Panel title={`Became known in 24 h before T (${recent.length})`} designator="C" className="max-h-[480px]" bodyClassName="overflow-y-auto">
              {recent.length === 0 ? (
                <p className="p-2 text-2xs text-wt-fg-dim">Nothing newly collected in the 24 hours before T.</p>
              ) : (
                <ul className="divide-y divide-wt-line">
                  {recent.map((e) => (
                    <li key={e.id} className="px-2 py-1 text-xs">
                      <div>{e.title}</div>
                      <div className="mt-0.5 flex flex-wrap gap-1.5 text-2xs text-wt-fg-dim">
                        <span>collected {formatUtc(e.collectedAt)}</span>
                        {isLateCollection(e) && <Tag tone="warn" title={`Published ${formatUtc(e.publishedAt)}`}>LATE</Tag>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <Panel
            title="Hindsight: what was learned after T"
            designator="H"
            actions={
              <button className="text-2xs text-wt-fg-muted hover:text-wt-fg" onClick={() => setReveal((r) => !r)} aria-pressed={reveal}>
                [{reveal ? 'HIDE' : 'REVEAL LATER OUTCOMES'}]
              </button>
            }
          >
            {!reveal ? (
              <p className="px-2 py-1.5 text-2xs text-wt-fg-dim">
                Hidden by default to avoid hindsight bias. {later.length} record(s) and {laterDossiers.length} dossier(s) became known after T within this window.
              </p>
            ) : (
              <div className="grid gap-2 p-2 text-2xs md:grid-cols-2">
                <div>
                  <p className="mb-1 text-wt-warn">NOT KNOWN AT T: records collected later in the window</p>
                  <ul className="max-h-48 space-y-0.5 overflow-y-auto">
                    {later.slice(0, 100).map((e) => (
                      <li key={e.id}><span className="text-wt-fg-dim tabular-nums">{formatUtc(e.collectedAt)}</span> {e.title}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="mb-1 text-wt-warn">SUBSEQUENT OUTCOMES: dossiers whose first evidence is after T</p>
                  <ul className="space-y-0.5">
                    {laterDossiers.length === 0 && <li className="text-wt-fg-dim">none</li>}
                    {laterDossiers.map(({ i, start: s }) => (
                      <li key={i.id}><span className="text-wt-fg-dim tabular-nums">{formatUtc(new Date(s).toISOString())}</span> {i.title}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </Panel>
          <p className="px-1 text-2xs text-wt-fg-dim">
            {availableAt(archive?.events ?? [], t).length} record(s) known at T.
          </p>
        </>
      )}
    </div>
  );
}
