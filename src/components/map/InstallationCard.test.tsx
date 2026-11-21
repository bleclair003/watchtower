import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InstallationCard } from './InstallationCard';
import { buildDemoBaseActivity } from '../../data/demo/demoBaseActivity';
import type { InstallationDataset } from '@shared/domain/installations';

const NOW = Date.parse('2026-12-20T12:00:00Z');
const site = { name: 'Naval Station Norfolk', component: 'usn', status: 'act', state: 'VA', country: 'US', joint: false, lat: 36.95, lon: -76.31 };
const dataset = { source: 'DoD MIRTA', sourceUrl: 'https://example.test', licence: 'CC BY 4.0', dataCurrency: '2024', coverage: 'US', retrievedAt: '2026-11-20', count: 1, installations: [site] } as unknown as InstallationDataset;

describe('InstallationCard activity', () => {
  it('marks unusual activity with the week and usual level', () => {
    render(<InstallationCard selected={{ kind: 'dod', site, dataset } as never} events={[]} now={NOW} onClose={() => {}} activity={buildDemoBaseActivity(NOW)} />);
    expect(screen.getByText('UNUSUAL')).toBeInTheDocument();
    expect(screen.getByText(/7 records \(6 naming it, 1 within 50 km; 4 sources\) · usual 1\.5 a week \(4 earlier weeks\)/)).toBeInTheDocument();
  });

  it('says the usual level is not known yet before 21 days of history', () => {
    const early = { ...buildDemoBaseActivity(NOW), flagsActive: false, historyDays: 1.2, baselineWeeks: 0, items: [] };
    render(<InstallationCard selected={{ kind: 'dod', site, dataset } as never} events={[]} now={NOW} onClose={() => {}} activity={early} />);
    expect(screen.queryByText('UNUSUAL')).toBeNull();
    expect(screen.getByText(/usual not yet known \(1\.2 of 21 days of history\)/)).toBeInTheDocument();
  });
});
