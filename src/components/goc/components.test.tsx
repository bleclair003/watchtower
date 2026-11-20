import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { buildDemoEvents } from '../../data/demo/demoEvents';
import { DEFAULT_FILTERS } from '../../lib/filters';
import { IntelFeed } from './IntelFeed';
import { RegionalWatchlist } from './RegionalWatchlist';
import { CommandConsole } from '../layout/CommandConsole';
import { DashboardProvider, useDashboard } from '../../state/DashboardContext';

const NOW = Date.parse('2026-11-20T12:00:00Z');
const events = buildDemoEvents(NOW);

describe('IntelFeed', () => {
  it('labels demo records and states that no original source exists', async () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <IntelFeed
        allEvents={events}
        events={events.slice(0, 3)}
        filters={DEFAULT_FILTERS}
        onFiltersChange={() => {}}
        onResetFilters={() => {}}
        selectedEventId={null}
        onSelect={onSelect}
        now={NOW}
      />,
    );
    const list = screen.getByRole('list', { name: 'Intelligence feed items' });
    expect(within(list).getAllByText('DEMO')).toHaveLength(3);

    await userEvent.click(screen.getByText(events[0].title));
    expect(onSelect).toHaveBeenCalledWith(events[0].id);

    rerender(
      <IntelFeed
        allEvents={events}
        events={events.slice(0, 3)}
        filters={DEFAULT_FILTERS}
        onFiltersChange={() => {}}
        onResetFilters={() => {}}
        selectedEventId={events[0].id}
        onSelect={onSelect}
        now={NOW}
      />,
    );
    expect(screen.getByText('SIMULATED RECORD — NO ORIGINAL SOURCE EXISTS')).toBeInTheDocument();
    expect(screen.queryByText(/OPEN ORIGINAL SOURCE/)).not.toBeInTheDocument();
  });

  it('shows an explicit empty state', () => {
    render(
      <IntelFeed
        allEvents={events}
        events={[]}
        filters={DEFAULT_FILTERS}
        onFiltersChange={() => {}}
        onResetFilters={() => {}}
        selectedEventId={null}
        onSelect={() => {}}
        now={NOW}
      />,
    );
    expect(screen.getByText('NO RECORDS MATCH CURRENT FILTERS.')).toBeInTheDocument();
  });
});

describe('RegionalWatchlist', () => {
  it('never shows a fabricated RAI score and toggles region selection', async () => {
    const onSelect = vi.fn();
    render(<RegionalWatchlist events={events} selectedRegionId={null} onSelect={onSelect} now={NOW} />);
    expect(screen.getAllByText('RAI N/E')).toHaveLength(7);
    await userEvent.click(screen.getByText('RED SEA / GULF OF ADEN'));
    expect(onSelect).toHaveBeenCalledWith('red-sea');
  });
});

function Probe() {
  const { filters } = useDashboard();
  const loc = useLocation();
  return (
    <div data-testid="probe">
      {loc.pathname}|{filters.regionId ?? 'none'}|{filters.keyword}
    </div>
  );
}

describe('CommandConsole', () => {
  function setup(initial = '/sources') {
    render(
      <MemoryRouter initialEntries={[initial]}>
        <DashboardProvider>
          <CommandConsole />
          <Routes>
            <Route path="*" element={<Probe />} />
          </Routes>
        </DashboardProvider>
      </MemoryRouter>,
    );
    return screen.getByRole('combobox', { name: 'Command or search' });
  }

  it('WATCH sets the region filter and navigates to the GOC', async () => {
    const input = setup();
    await userEvent.type(input, 'WATCH REDSEA{Enter}');
    expect(screen.getByTestId('probe')).toHaveTextContent('/|red-sea|');
    expect(screen.getByRole('status')).toHaveTextContent('WATCH REDSEA — FEED FILTERED, MAP FOCUSED');
  });

  it('reports unbuilt modules honestly', async () => {
    const input = setup('/');
    await userEvent.type(input, 'ALERTS{Enter}');
    expect(screen.getByRole('status')).toHaveTextContent('ALERT SYSTEM NOT YET DEPLOYED (PHASE 4)');
  });

  it('free text becomes a keyword filter', async () => {
    const input = setup('/');
    await userEvent.type(input, 'tanker{Enter}');
    expect(screen.getByTestId('probe')).toHaveTextContent('/|none|tanker');
  });
});
