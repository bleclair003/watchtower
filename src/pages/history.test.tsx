import type React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { DataProvider } from '../state/DataContext';
import { DemoRepository } from '../data/repository';
import SitrepPage from './SitrepPage';
import SignalLabPage from './SignalLabPage';
import { INDICATOR_CATALOG } from '@shared/domain/indicators/catalog';

const wrap = (ui: React.ReactNode) => (
  <MemoryRouter>
    <DataProvider repository={new DemoRepository(Date.now())}>{ui}</DataProvider>
  </MemoryRouter>
);

describe('SitrepPage', () => {
  it('generates all eight sections plus limitations from loaded data', async () => {
    render(wrap(<SitrepPage />));
    await userEvent.click(await screen.findByRole('button', { name: 'GENERATE' }));
    expect(await screen.findByText('1. Executive summary')).toBeInTheDocument();
    expect(screen.getByText('8. Outstanding questions')).toBeInTheDocument();
    expect(screen.getByText('Limitations')).toBeInTheDocument();
    expect(screen.getByText(/dashboard data \(demo mode, no archive\)/)).toBeInTheDocument();
    expect(screen.getByText(/record\(s\) published in the period/)).toBeInTheDocument();
  });
});

describe('SignalLabPage', () => {
  it('shows experimental research records with evidence quality', async () => {
    render(wrap(<SignalLabPage />));
    expect(await screen.findByText('Pentagon Pizza Index')).toBeInTheDocument();
    expect(screen.getByText('State Dept advisory tempo (global)')).toBeInTheDocument();
    expect(screen.getByText('EVIDENCE: ANECDOTAL')).toBeInTheDocument();
    expect(screen.getAllByText('HYPOTHESIS').length).toBe(INDICATOR_CATALOG.filter((d) => d.experimental).length);
  });
});
