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
import { DataProvider } from '../../state/DataContext';
import { DemoRepository } from '../../data/repository';
import IndicatorsPage from '../../pages/IndicatorsPage';
import { RuleBuilder } from '../alerts/RuleBuilder';
import type { RegionScore } from '@shared/domain/indicators/types';

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
  it('shows N/E rather than a fabricated score when no indicator is evaluable', async () => {
    const onSelect = vi.fn();
    render(<RegionalWatchlist events={events} regionScores={[]} scoreHistory={[]} selectedRegionId={null} onSelect={onSelect} now={NOW} />);
    expect(screen.getAllByText('RAI N/E')).toHaveLength(7);
    await userEvent.click(screen.getByText('RED SEA / GULF OF ADEN'));
    expect(onSelect).toHaveBeenCalledWith('red-sea');
  });

  it('shows score, band, 24 h change and a traceable breakdown for the selected region', () => {
    const score: RegionScore = {
      regionId: 'red-sea', score: 42, band: 'ELEVATED', coverage: 1, activeIndicators: 1, evaluatedAt: new Date(NOW - 3_600_000).toISOString(),
      contributions: [
        { indicatorId: 'red-sea.advisory-raised', name: 'REDSEA travel advisory raised', state: 'TRIGGERED', weight: 3, severity: 'high', raw: 6, applied: 6, capped: false },
        { indicatorId: 'red-sea.advisory-activity', name: 'REDSEA advisory publication burst', state: 'NORMAL', weight: 2, severity: 'medium', raw: 0, applied: 0, capped: false },
      ],
    };
    const history = [{ at: new Date(NOW - 24 * 3_600_000).toISOString(), scores: { 'red-sea': 30 } }];
    render(
      <MemoryRouter>
        <RegionalWatchlist events={events} regionScores={[score]} scoreHistory={history} selectedRegionId="red-sea" onSelect={() => {}} now={NOW} />
      </MemoryRouter>,
    );
    expect(screen.getByText('RAI 42 · ELEVATED')).toBeInTheDocument();
    expect(screen.getByText('+12')).toBeInTheDocument();
    expect(screen.getByText('REDSEA travel advisory raised')).toBeInTheDocument();
    expect(screen.getByText('+6.0')).toBeInTheDocument();
    expect(screen.getByText('COVERAGE 100%')).toBeInTheDocument();
  });
});

describe('IndicatorsPage', () => {
  it('lists the catalog, separates experimental signals, and reports no-data states honestly', async () => {
    render(
      <MemoryRouter>
        <DataProvider repository={new DemoRepository(NOW)}>
          <IndicatorsPage />
        </DataProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Experimental Signals — Unvalidated')).toBeInTheDocument();
    expect(screen.getByText('Pentagon Pizza Index')).toBeInTheDocument();
    expect(screen.getByText('Ransomware-linked KEV additions')).toBeInTheDocument();
    // Demo data comes from no real collected source: everything is NO DATA, nothing NORMAL.
    expect(screen.queryAllByText('NORMAL')).toHaveLength(0);
    expect(screen.getAllByText('NO DATA').length).toBeGreaterThan(10);
    expect(screen.getAllByText('RAI N/E').length).toBeGreaterThan(0);
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
    await userEvent.type(input, 'SITREP 24H{Enter}');
    expect(screen.getByRole('status')).toHaveTextContent('SITREP GENERATOR NOT YET DEPLOYED (PHASE 6)');
  });

  it('free text becomes a keyword filter', async () => {
    const input = setup('/');
    await userEvent.type(input, 'tanker{Enter}');
    expect(screen.getByTestId('probe')).toHaveTextContent('/|none|tanker');
  });
});

describe('RuleBuilder', () => {
  async function setup() {
    const onSave = vi.fn(async () => {});
    render(
      <DataProvider repository={new DemoRepository(Date.now())}>
        <RuleBuilder initial={null} canSave={false} onSave={onSave} onCancel={() => {}} />
      </DataProvider>,
    );
    return onSave;
  }

  it('validates live, renders the condition in words, and blocks saving in demo mode', async () => {
    await setup();
    expect(await screen.findByText(/name must be/)).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText(/Red Sea maritime/), 'Red Sea watch');
    expect(screen.queryByText(/name must be/)).not.toBeInTheDocument();
    expect(screen.getByText('regionIds CONTAINS red-sea')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'SAVE RULE' })).toBeDisabled();
    expect(screen.getByText('SAVE DISABLED IN DEMO MODE')).toBeInTheDocument();
  });

  it('test mode previews matches without creating anything', async () => {
    await setup();
    await userEvent.type(screen.getByPlaceholderText(/Red Sea maritime/), 'Red Sea watch');
    await userEvent.click(screen.getByRole('button', { name: 'TEST RULE' }));
    expect(screen.getByText(/TEST MODE: \d+ match\(es\)\. No alert created, nothing sent\./)).toBeInTheDocument();
    expect(screen.getAllByText(/\[SIMULATED\]/).length).toBeGreaterThan(0);
  });

  it('switches to JSON mode and flags invalid JSON', async () => {
    await setup();
    await userEvent.type(screen.getByPlaceholderText(/Red Sea maritime/), 'x');
    await userEvent.click(screen.getByRole('button', { name: '[JSON]' }));
    const area = screen.getByLabelText('Condition JSON');
    await userEvent.clear(area);
    await userEvent.type(area, '{{"field": "evil"');
    expect(screen.getByText(/^• JSON:/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'TEST RULE' })).toBeDisabled();
  });
});

