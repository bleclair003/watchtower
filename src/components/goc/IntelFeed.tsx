import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { buildStories, groupFeed } from '@shared/domain/stories/stories';
import { isOffTopic } from '@shared/domain/relevance';
import { isRoutineSighting } from '@shared/domain/aircraft';
import type { IntelligenceEvent } from '@shared/domain/types';
import type { DashboardFilters } from '../../lib/filters';
import { Panel } from '../ui/Panel';
import { FeedFilters } from './FeedFilters';
import { FeedItem } from './FeedItem';

interface Props {
  allEvents: IntelligenceEvent[];
  events: IntelligenceEvent[];
  filters: DashboardFilters;
  onFiltersChange: (patch: Partial<DashboardFilters>) => void;
  onResetFilters: () => void;
  selectedEventId: string | null;
  onSelect: (id: string | null) => void;
  now: number;
  className?: string;
  /** eventId → names of active indicators citing it. */
  indicatorsByEvent?: Map<string, string[]>;
  allowDossier?: boolean;
}

/** Chronological intelligence feed. Keyboard: J / K or ↓ / ↑ to move, Esc to collapse. */
export function IntelFeed(props: Props) {
  const { events, selectedEventId, onSelect, now } = props;
  const itemRefs = useRef(new Map<string, HTMLLIElement>());
  const [grouped, setGrouped] = useState(true);
  const offTopicCount = useMemo(() => props.allEvents.filter(isOffTopic).length, [props.allEvents]);
  const routineAirCount = useMemo(() => props.allEvents.filter(isRoutineSighting).length, [props.allEvents]);
  // Stories are built from the filtered list, so a story's lead is always visible.
  const stories = useMemo(() => buildStories(events), [events]);
  const byId = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);
  const entries = useMemo(() => (grouped ? groupFeed(events, stories) : events.map((event) => ({ event, story: null }))), [grouped, events, stories]);
  // A report hidden inside a story (e.g. selected on the map) selects and expands its story.
  const visibleSelected = useMemo(() => {
    if (!selectedEventId || !grouped) return selectedEventId;
    return stories.find((s) => s.memberIds.includes(selectedEventId))?.leadId ?? selectedEventId;
  }, [selectedEventId, grouped, stories]);

  useEffect(() => {
    if (visibleSelected) itemRefs.current.get(visibleSelected)?.scrollIntoView({ block: 'nearest' });
  }, [visibleSelected]);

  function onKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    if ((e.target as HTMLElement).closest('input, select')) return;
    const idx = entries.findIndex((x) => x.event.id === visibleSelected);
    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = entries[Math.min(idx + 1, entries.length - 1)];
      if (next) onSelect(next.event.id);
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = entries[Math.max(idx - 1, 0)];
      if (prev) onSelect(prev.event.id);
    } else if (e.key === 'Escape') {
      onSelect(null);
    }
  }

  return (
    <Panel
      title="Intelligence Feed"
      designator="C1"
      actions={
        <span className="flex items-center gap-2 text-2xs text-wt-fg-muted tabular-nums">
          {offTopicCount > 0 && (
            <button
              aria-pressed={props.filters.showOffTopic}
              onClick={() => props.onFiltersChange({ showOffTopic: !props.filters.showOffTopic })}
              title="News items whose headline has no relevant topic (security, politics, rights, humanitarian, economy, disasters): sport, celebrity, local crime, lifestyle … Hidden by default; nothing is deleted."
              className={`border px-1.5 ${props.filters.showOffTopic ? 'border-wt-warn text-wt-warn' : 'border-wt-line-strong text-wt-fg-muted hover:text-wt-fg'}`}
            >
              OFF-TOPIC {props.filters.showOffTopic ? 'SHOWN' : 'HIDDEN'} ({offTopicCount})
            </button>
          )}
          {routineAirCount > 0 && (
            <button
              aria-pressed={props.filters.showRoutineAircraft}
              onClick={() => props.onFiltersChange({ showRoutineAircraft: !props.filters.showRoutineAircraft })}
              title="Routine military-aircraft sightings on ADS-B (tankers, airlift, surveillance). Hidden by default; bombers and command or VIP aircraft always show. They still count in the air-surge meters, and live positions are on the AIR map layer."
              className={`border px-1.5 ${props.filters.showRoutineAircraft ? 'border-wt-warn text-wt-warn' : 'border-wt-line-strong text-wt-fg-muted hover:text-wt-fg'}`}
            >
              AIRCRAFT {props.filters.showRoutineAircraft ? 'SHOWN' : 'HIDDEN'} ({routineAirCount})
            </button>
          )}
          <button
            aria-pressed={grouped}
            onClick={() => setGrouped((g) => !g)}
            title="Group reports of the same event from different outlets into one entry"
            className={`border px-1.5 ${grouped ? 'border-wt-info text-wt-info' : 'border-wt-line-strong text-wt-fg-muted hover:text-wt-fg'}`}
          >
            STORIES {grouped ? 'ON' : 'OFF'}
          </button>
          {grouped && stories.length > 0 ? `${entries.length} entries · ${events.length}` : events.length}/{props.allEvents.length}
        </span>
      }
      className={props.className}
      bodyClassName="flex flex-col"
    >
      <FeedFilters
        filters={props.filters}
        onChange={props.onFiltersChange}
        onReset={props.onResetFilters}
        events={props.allEvents}
      />
      {events.length === 0 ? (
        <p className="p-3 text-xs text-wt-fg-muted">NO RECORDS MATCH CURRENT FILTERS.</p>
      ) : (
        <ul
          tabIndex={0}
          onKeyDown={onKeyDown}
          aria-label="Intelligence feed items"
          className="min-h-0 flex-1 divide-y divide-wt-line overflow-y-auto focus-visible:outline focus-visible:-outline-offset-1 focus-visible:outline-wt-info"
        >
          {entries.map(({ event: e, story }) => (
            <FeedItem
              key={e.id}
              ref={(el) => {
                if (el) itemRefs.current.set(e.id, el);
                else itemRefs.current.delete(e.id);
              }}
              event={e}
              selected={e.id === visibleSelected}
              onSelect={() => onSelect(e.id === visibleSelected ? null : e.id)}
              now={now}
              indicators={props.indicatorsByEvent?.get(e.id)}
              allowDossier={props.allowDossier}
              story={story}
              storyReports={story ? story.memberIds.map((id) => byId.get(id)).filter((x): x is IntelligenceEvent => !!x) : undefined}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}
