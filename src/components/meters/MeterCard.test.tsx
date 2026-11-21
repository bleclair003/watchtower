import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Meter } from '@shared/domain/meters/types';
import { MeterCard } from './MeterCard';

const base: Meter = {
  id: 'air-surge.middle-east', kind: 'air-surge', family: 'topic', name: 'Middle East air surge', regionId: 'middle-east',
  level: 1, label: 'LOW', value: 1, reading: '3 sightings in 72 h.', components: [], evidence: [], asOf: null, baseline: 'ok', notes: [],
};

describe('MeterCard', () => {
  it('says how the usual level was worked out', () => {
    render(<MeterCard meter={{ ...base, baselineBasis: 'Usual level from the same weekdays (Fri, Sat) over the last 4+ weeks.' }} history={[]} now={Date.now()} />);
    expect(screen.getByText(/same weekdays \(Fri, Sat\)/)).toBeInTheDocument();
  });
  it('shows nothing extra without a basis', () => {
    render(<MeterCard meter={base} history={[]} now={Date.now()} />);
    expect(screen.queryByText(/Usual level/)).toBeNull();
  });
});
