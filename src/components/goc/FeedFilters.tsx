import { EVENT_CATEGORIES, type EventCategory, type IntelligenceEvent } from '@shared/domain/types';
import { WATCH_REGIONS } from '@shared/domain/regions';
import { CATEGORY_STYLES } from '../../config/categories';
import { TIME_WINDOWS, countActiveFilters, type DashboardFilters, type SourceClassFilter } from '../../lib/filters';
import { CategoryGlyph } from '../ui/CategoryGlyph';

interface Props {
  filters: DashboardFilters;
  onChange: (patch: Partial<DashboardFilters>) => void;
  onReset: () => void;
  events: IntelligenceEvent[];
}

const selectCls =
  'h-6 min-w-0 border border-wt-line-strong bg-wt-bg px-1 text-2xs text-wt-fg uppercase focus:border-wt-info focus:outline-none';

export function FeedFilters({ filters, onChange, onReset, events }: Props) {
  const sources = Array.from(new Map(events.map((e) => [e.sourceId, e.sourceName])).entries()).sort((a, b) =>
    a[1].localeCompare(b[1]),
  );
  const active = countActiveFilters(filters);

  function toggleCategory(c: EventCategory) {
    const has = filters.categories.includes(c);
    onChange({ categories: has ? filters.categories.filter((x) => x !== c) : [...filters.categories, c] });
  }

  return (
    <div className="space-y-1 border-b border-wt-line bg-wt-bg2/60 p-1.5">
      <div className="flex flex-wrap items-center gap-1">
        <div role="group" aria-label="Time window" className="flex">
          {TIME_WINDOWS.map((w) => (
            <button
              key={w.label}
              onClick={() => onChange({ windowHours: w.hours })}
              aria-pressed={filters.windowHours === w.hours}
              className={`h-6 border border-wt-line-strong px-1.5 text-2xs -ml-px first:ml-0 ${
                filters.windowHours === w.hours ? 'bg-wt-fg text-wt-bg' : 'text-wt-fg-muted hover:text-wt-fg'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
        <select
          aria-label="Reporting class"
          className={selectCls}
          value={filters.sourceClass}
          onChange={(e) => onChange({ sourceClass: e.target.value as SourceClassFilter })}
        >
          <option value="all">ALL CLASSES</option>
          <option value="official">OFFICIAL ONLY</option>
          <option value="non-official">MEDIA / OTHER</option>
        </select>
        {active > 0 && (
          <button onClick={onReset} className="ml-auto text-2xs text-wt-warn hover:underline">
            RESET ({active})
          </button>
        )}
      </div>
      <div className="flex gap-1">
        <select
          aria-label="Region"
          className={`${selectCls} flex-1`}
          value={filters.regionId ?? ''}
          onChange={(e) => onChange({ regionId: e.target.value || null })}
        >
          <option value="">ALL REGIONS</option>
          {WATCH_REGIONS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Source"
          className={`${selectCls} flex-1`}
          value={filters.sourceId ?? ''}
          onChange={(e) => onChange({ sourceId: e.target.value || null })}
        >
          <option value="">ALL SOURCES</option>
          {sources.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
          {filters.sourceId && !sources.some(([id]) => id === filters.sourceId) && (
            <option value={filters.sourceId}>{filters.sourceId} (no records)</option>
          )}
        </select>
      </div>
      <div className="flex gap-1">
        <input
          type="search"
          aria-label="Keyword filter"
          placeholder="KEYWORD…"
          value={filters.keyword}
          onChange={(e) => onChange({ keyword: e.target.value })}
          className="h-6 min-w-0 flex-1 border border-wt-line-strong bg-wt-bg px-1.5 text-2xs text-wt-fg placeholder:text-wt-fg-dim focus:border-wt-info focus:outline-none"
        />
      </div>
      <div role="group" aria-label="Categories" className="flex flex-wrap gap-0.5">
        {EVENT_CATEGORIES.map((c) => {
          const on = filters.categories.includes(c);
          return (
            <button
              key={c}
              onClick={() => toggleCategory(c)}
              aria-pressed={on}
              title={CATEGORY_STYLES[c].label}
              className={`flex h-5 items-center gap-1 border px-1 text-2xs ${
                on ? 'border-wt-info text-wt-info' : 'border-wt-line text-wt-fg-muted hover:text-wt-fg'
              }`}
            >
              <CategoryGlyph category={c} size={9} />
              {CATEGORY_STYLES[c].code}
            </button>
          );
        })}
      </div>
    </div>
  );
}
