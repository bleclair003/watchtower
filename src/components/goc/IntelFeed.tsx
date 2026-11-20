import { useEffect, useRef, type KeyboardEvent } from 'react';
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

  useEffect(() => {
    if (selectedEventId) itemRefs.current.get(selectedEventId)?.scrollIntoView({ block: 'nearest' });
  }, [selectedEventId]);

  function onKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    if ((e.target as HTMLElement).closest('input, select')) return;
    const idx = events.findIndex((x) => x.id === selectedEventId);
    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = events[Math.min(idx + 1, events.length - 1)];
      if (next) onSelect(next.id);
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = events[Math.max(idx - 1, 0)];
      if (prev) onSelect(prev.id);
    } else if (e.key === 'Escape') {
      onSelect(null);
    }
  }

  return (
    <Panel
      title="Intelligence Feed"
      designator="C1"
      actions={
        <span className="text-2xs text-wt-fg-muted tabular-nums">
          {events.length}/{props.allEvents.length}
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
          className="min-h-0 flex-1 divide-y divide-wt-line overflow-y-auto focus:outline-none"
        >
          {events.map((e) => (
            <FeedItem
              key={e.id}
              ref={(el) => {
                if (el) itemRefs.current.set(e.id, el);
                else itemRefs.current.delete(e.id);
              }}
              event={e}
              selected={e.id === selectedEventId}
              onSelect={() => onSelect(e.id === selectedEventId ? null : e.id)}
              now={now}
              indicators={props.indicatorsByEvent?.get(e.id)}
              allowDossier={props.allowDossier}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}
