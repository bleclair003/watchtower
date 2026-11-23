import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FeedbackControls } from './FeedbackControls';
import { ScorecardPanel } from './ScorecardPanel';
import { buildScorecard } from '@shared/domain/alerts/scorecard';
import { buildDemoScorecardInput } from '../../data/demo/demoScorecard';

describe('alert feedback controls', () => {
  it('saves a verdict with the note, and clears it when the same verdict is chosen again', async () => {
    const onSave = vi.fn();
    const { rerender } = render(<FeedbackControls feedback={null} onSave={onSave} />);
    fireEvent.change(screen.getByPlaceholderText(/Optional: why/), { target: { value: ' Announced exercise ' } });
    fireEvent.click(screen.getByRole('button', { name: 'FALSE POSITIVE' }));
    expect(onSave).toHaveBeenCalledWith({ verdict: 'false-positive', note: 'Announced exercise', at: expect.any(String) });
    // The buttons are disabled while a save is in flight.
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'USEFUL' })).not.toBeDisabled());

    rerender(<FeedbackControls feedback={{ verdict: 'useful', note: '', at: '2026-11-23T00:00:00.000Z' }} onSave={onSave} />);
    expect(screen.getByRole('button', { name: 'USEFUL' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'USEFUL' }));
    expect(onSave).toHaveBeenLastCalledWith(null);
  });
});

describe('scorecard panel', () => {
  it('shows shares with their counts, flags a noisy rule and marks demo data as simulated', () => {
    const now = Date.parse('2026-11-23T12:00:00Z');
    const d = buildDemoScorecardInput(now);
    const sc = buildScorecard({ now, windowDays: 30, alerts: d.alerts, missed: d.missed, runs: d.runs, runDays: 7 });
    render(<ScorecardPanel scorecard={sc} missed={d.missed} canEdit simulated />);
    expect(screen.getByText(/\[SIMULATED\] Demo numbers/)).toBeInTheDocument();
    expect(screen.getByText('15 of 19 alerts')).toBeInTheDocument();
    expect(screen.getByText('NOISY')).toBeInTheDocument();
    expect(screen.getByText(/1 missed · 1 late · median 9.0 h late/)).toBeInTheDocument();
    // Demo data cannot be edited.
    expect(screen.queryByText('[+ LOG A MISSED INCIDENT]')).toBeNull();
  });

  it('checks a missed incident before saving it', async () => {
    const now = Date.now();
    const sc = buildScorecard({ now, windowDays: 30, alerts: [], missed: [], runs: null });
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ScorecardPanel scorecard={sc} missed={[]} canEdit onSaveMissed={onSave} />);
    fireEvent.click(screen.getByText('[+ LOG A MISSED INCIDENT]'));
    fireEvent.click(screen.getByLabelText('CAUGHT IT LATE'));
    fireEvent.change(screen.getByLabelText('WHAT HAPPENED'), { target: { value: 'Invented port closure' } });
    fireEvent.click(screen.getByRole('button', { name: 'LOG IT' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Late by how many hours/);
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('HOURS LATE'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'LOG IT' }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({ title: 'Invented port closure', kind: 'late', lateHours: 6, version: 1 });
  });
});
