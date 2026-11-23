import { useMemo, useRef, useState } from 'react';
import { Camera, Link2, Ruler, Search, X } from 'lucide-react';
import { buildSearchIndex, KIND_LABEL, searchMap, type SearchItem, type SearchSources } from '../../lib/mapSearch';
import { formatLonLat, formatMeasurement, measure, type LonLat } from '../../lib/measure';

/**
 * GOC map tools (v0.68.0): search what is on the map, a distance and bearing ruler, copy a link to this
 * exact view, and save a snapshot. Sits in the map's top-left corner.
 */
export function MapTools({
  sources,
  notSearched,
  onPick,
  onSearchCleared,
  onNeedAirports,
  measuring,
  onMeasuring,
  ruler,
  onClearRuler,
  onCopyLink,
  onSnapshot,
}: {
  sources: SearchSources;
  /** Layers switched off, whose objects are not searched. */
  notSearched: string[];
  onPick: (item: SearchItem) => void;
  onSearchCleared: () => void;
  /** Called the first time the search box is used, to load the airport table. */
  onNeedAirports: () => void;
  measuring: boolean;
  onMeasuring: (on: boolean) => void;
  ruler: LonLat[];
  onClearRuler: () => void;
  onCopyLink: () => Promise<string | null>;
  onSnapshot: () => Promise<string | null>;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [fallbackLink, setFallbackLink] = useState<string | null>(null);
  const asked = useRef(false);
  const index = useMemo(() => buildSearchIndex(sources), [sources]);
  const results = useMemo(() => searchMap(index, query), [index, query]);
  const measurement = ruler.length === 2 ? measure(ruler[0], ruler[1]) : null;

  const pick = (it: SearchItem) => {
    onPick(it);
    setOpen(false);
  };
  const flash = (s: string) => {
    setStatus(s);
    window.setTimeout(() => setStatus((x) => (x === s ? null : x)), 3000);
  };
  const btn = (on = false) =>
    `flex h-6 items-center gap-1 border px-1.5 text-2xs ${on ? 'border-wt-fg bg-wt-fg text-wt-bg' : 'border-wt-line-strong bg-wt-panel/95 text-wt-fg-muted hover:text-wt-fg'}`;

  return (
    <div className="pointer-events-none absolute top-2 left-2 z-20 flex w-[min(340px,calc(100%-1rem))] flex-col gap-1 text-2xs">
      <div className="pointer-events-auto flex gap-1">
        <div className="relative min-w-0 flex-1">
          <label className="flex h-6 items-center gap-1 border border-wt-line-strong bg-wt-panel/95 px-1.5">
            <Search size={10} aria-hidden className="shrink-0 text-wt-fg-dim" />
            <span className="sr-only">Find on map</span>
            <input
              type="search"
              role="combobox"
              aria-expanded={open && results.length > 0}
              aria-controls="map-search-results"
              aria-activedescendant={open && results[active] ? `map-result-${active}` : undefined}
              value={query}
              placeholder="FIND ON MAP: base, callsign, ship, airport…"
              className="h-full min-w-0 flex-1 bg-transparent text-2xs text-wt-fg outline-none placeholder:text-wt-fg-dim"
              onFocus={() => {
                if (!asked.current) {
                  asked.current = true;
                  onNeedAirports();
                }
                setOpen(true);
              }}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
                setOpen(true);
                if (!e.target.value) onSearchCleared();
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive((i) => Math.min(i + 1, results.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((i) => Math.max(i - 1, 0));
                } else if (e.key === 'Enter' && results[active]) {
                  e.preventDefault();
                  pick(results[active]);
                } else if (e.key === 'Escape') {
                  e.stopPropagation();
                  setOpen(false);
                }
              }}
            />
          </label>
          {open && query.trim().length >= 2 && (
            <div className="absolute top-7 left-0 w-full border border-wt-line-strong bg-wt-panel/95 shadow-lg">
              {results.length === 0 ? (
                <p className="px-2 py-1.5 text-wt-fg-muted">Nothing on the map matches.</p>
              ) : (
                <ul id="map-search-results" role="listbox" aria-label="Map search results" className="max-h-64 overflow-y-auto">
                  {results.map((r, i) => (
                    <li
                      key={`${r.kind}:${r.label}:${i}`}
                      id={`map-result-${i}`}
                      role="option"
                      aria-selected={i === active}
                      className={`cursor-pointer px-2 py-1 ${i === active ? 'bg-wt-fg/15' : 'hover:bg-wt-fg/10'}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(r)}
                      onMouseEnter={() => setActive(i)}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="shrink-0 text-wt-fg-dim">{KIND_LABEL[r.kind]}</span>
                        <span className="truncate text-wt-fg">{r.label}</span>
                      </div>
                      {r.detail && <div className="truncate text-wt-fg-muted">{r.detail}</div>}
                    </li>
                  ))}
                </ul>
              )}
              {notSearched.length > 0 && <p className="border-t border-wt-line px-2 py-1 text-wt-fg-dim">Not searched (layer off): {notSearched.join(', ')}</p>}
            </div>
          )}
        </div>
        <button type="button" className={btn(measuring)} aria-pressed={measuring} title="Measure distance and bearing between two points" onClick={() => onMeasuring(!measuring)}>
          <Ruler size={10} aria-hidden /> RULER
        </button>
        <button
          type="button"
          className={btn()}
          title="Copy a link to this exact view: position, layers, filters, selection and ruler"
          onClick={async () => {
            const failed = await onCopyLink();
            setFallbackLink(failed);
            if (!failed) flash('LINK COPIED');
          }}
        >
          <Link2 size={10} aria-hidden /> LINK
        </button>
        <button
          type="button"
          className={btn()}
          title="Save a PNG of the map with the time, layers and credits"
          onClick={async () => {
            flash('SAVING…');
            const err = await onSnapshot();
            flash(err ?? 'SNAPSHOT SAVED');
          }}
        >
          <Camera size={10} aria-hidden /> PNG
        </button>
      </div>
      {status && (
        <p role="status" className="pointer-events-auto self-start border border-wt-line-strong bg-wt-panel/95 px-1.5 py-0.5 text-wt-fg">
          {status}
        </p>
      )}
      {fallbackLink && (
        <div className="pointer-events-auto flex items-center gap-1 border border-wt-line-strong bg-wt-panel/95 px-1.5 py-1">
          <span className="shrink-0 text-wt-fg-dim">COPY:</span>
          <input readOnly value={fallbackLink} aria-label="Link to this view" className="min-w-0 flex-1 bg-transparent text-wt-fg outline-none" onFocus={(e) => e.target.select()} autoFocus />
          <button type="button" aria-label="Close" className="text-wt-fg-muted hover:text-wt-fg" onClick={() => setFallbackLink(null)}>
            <X size={10} />
          </button>
        </div>
      )}
      {(measuring || ruler.length > 0) && (
        <div className="pointer-events-auto border border-wt-line-strong bg-wt-panel/95 px-1.5 py-1" role="status" aria-live="polite">
          {measurement ? (
            <>
              <p className="text-wt-fg tabular-nums">{formatMeasurement(measurement)}</p>
              <p className="text-wt-fg-muted">
                {formatLonLat(ruler[0])} → {formatLonLat(ruler[1])}
              </p>
              <p className="text-wt-fg-dim">Great circle on a spherical Earth (within about 0.5%). {measuring ? 'Click again to start a new measurement.' : ''}</p>
            </>
          ) : (
            <p className="text-wt-fg-muted">
              {ruler.length === 1 ? `From ${formatLonLat(ruler[0])}: click the second point.` : 'Click two points on the map. Clicking a marker measures from its exact position.'}
            </p>
          )}
          <div className="mt-0.5 flex gap-2">
            {ruler.length > 0 && (
              <button type="button" className="text-wt-fg-muted hover:text-wt-fg" onClick={onClearRuler}>
                [CLEAR]
              </button>
            )}
            {measuring && (
              <button type="button" className="text-wt-fg-muted hover:text-wt-fg" onClick={() => onMeasuring(false)}>
                [DONE]
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
