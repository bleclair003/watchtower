import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DisplacementPanel } from './DisplacementPanel';
import { buildDemoDisplacement } from '../../data/demo/demoDisplacement';

describe('DisplacementPanel', () => {
  it('shows figures, flags large rises, and names countries without data', () => {
    const data = buildDemoDisplacement(Date.parse('2026-11-21T00:00:00Z'));
    render(<DisplacementPanel countries={['LB', 'SY']} data={data} />);
    expect(screen.getByText('Displacement — UNHCR 2026')).toBeInTheDocument();
    expect(screen.getByText('400k')).toBeInTheDocument(); // Lebanon IDPs
    expect(screen.getByText('990k')).toBeInTheDocument(); // hosted
    expect(screen.getByText('▲6.7×')).toBeInTheDocument(); // 60k → 400k
    expect(screen.getByText(/No UNHCR figures: Syria/)).toBeInTheDocument();
    expect(screen.getByText(/SIMULATED/)).toBeInTheDocument();
  });

  it('says so when nothing is loaded', () => {
    render(<DisplacementPanel countries={['UA']} data={null} />);
    expect(screen.getByText('No UNHCR figures loaded yet.')).toBeInTheDocument();
  });
});

describe('DisplacementPanel rounding', () => {
  it('shows 999,700 as 1.0M, never "1000k" (real case: refugees hosted in Poland)', () => {
    const data = buildDemoDisplacement(Date.parse('2026-11-21T00:00:00Z'));
    const row = { ...data.rows[0], country: 'PL', latest: { ...data.rows[0].latest, refugeesHosted: 999_700, asylumSeekersHosted: 0 } };
    render(<DisplacementPanel countries={['PL']} data={{ ...data, rows: [row] }} />);
    expect(screen.getByText('1.0M')).toBeInTheDocument();
  });
});
