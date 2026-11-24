import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Incident } from '@shared/domain/incidents/types';
import { HypothesesBoard } from './HypothesesBoard';

const ev = (id: string, title: string, sourceId: string) => ({
  event: {
    eventId: id,
    title,
    sourceId,
    sourceName: sourceId,
    sourceClass: 'media' as const,
    sourceUrl: `https://example.test/${id}`,
    category: 'maritime' as const,
    credibility: 'official' as const,
    regionIds: ['eastern-europe'],
    countryCodes: [],
    publishedAt: '2026-11-24T10:00:00Z',
    occurredAt: null,
    collectedAt: '2026-11-24T10:05:00Z',
    dataOrigin: 'live' as const,
  },
  assessment: 'confirmed' as const,
  addedAt: '2026-11-24T11:00:00Z',
  note: '',
});

const start: Incident = {
  id: 'i1',
  title: 'Invented cable fault',
  summary: '',
  status: 'developing',
  category: 'maritime',
  regionIds: ['eastern-europe'],
  evidence: [ev('a', 'Invented ship dragging anchor over the cable', 'ais-sanctioned-ships'), ev('b', 'Invented operator: no work was planned', 'operator-news')],
  notes: [],
  linkedIncidentIds: [],
  indicatorIds: [],
  createdAt: '2026-11-24T11:00:00Z',
  updatedAt: '2026-11-24T11:00:00Z',
  version: 1,
};

function Harness() {
  const [d, setD] = useState(start);
  return <HypothesesBoard incident={d} onChange={(f) => setD(f)} />;
}

describe('competing hypotheses board', () => {
  it('adds explanations, marks evidence and ranks by the evidence against', () => {
    render(<Harness />);
    const add = (label: string) => {
      fireEvent.change(screen.getByLabelText('New explanation'), { target: { value: label } });
      fireEvent.click(screen.getByRole('button', { name: '[+ ADD EXPLANATION]' }));
    };
    add('Accident');
    add('Scheduled maintenance');
    expect(screen.getByLabelText('Explanation H2')).toHaveValue('Scheduled maintenance');

    const matrix = screen.getByRole('region', { name: 'Evidence against explanations' });
    const marks = within(matrix).getAllByLabelText('Mark against H2');
    fireEvent.change(marks[1], { target: { value: 'II' } });
    fireEvent.change(within(matrix).getAllByLabelText('Why, against H2')[0], { target: { value: 'Nothing was planned' } });
    fireEvent.change(within(matrix).getAllByLabelText('Mark against H1')[0], { target: { value: 'C' } });

    const ranking = screen.getByRole('list', { name: 'Hypothesis ranking' });
    const items = within(ranking).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Accident');
    expect(items[0]).toHaveTextContent('LEAST AGAINST');
    expect(items[1]).toHaveTextContent('Scheduled maintenance');
    expect(items[1]).toHaveTextContent('against 2');
    expect(screen.queryByText(/not marked yet/)).toBeNull();

    // Removing an explanation removes its column and marks.
    fireEvent.click(screen.getByRole('button', { name: 'Remove H2' }));
    expect(within(screen.getByRole('list', { name: 'Hypothesis ranking' })).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByLabelText('Why, against H2')).toBeNull();
  });
});
