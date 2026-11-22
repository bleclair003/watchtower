import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { IntelligenceEvent } from '@shared/domain/types';
import { ListenLinks } from './ListenLinks';

const ev = (p: Partial<IntelligenceEvent>): IntelligenceEvent => ({
  id: 'x', contentHash: 'x', dataOrigin: 'live', sourceId: 'adsb-emergencies', sourceName: 'Test', sourceClass: 'aggregator', sourceUrl: 'https://example.invalid/x',
  title: 'Test aircraft', category: 'aviation', regionIds: [], countryCodes: [], publishedAt: '2026-11-22T12:00:00Z', collectedAt: '2026-11-22T12:00:00Z',
  credibility: 'single-source', verificationStatus: 'unreviewed', locationPrecision: 'exact', ...p,
});

describe('ListenLinks (Phase 28)', () => {
  it('shows LiveATC and Broadcastify links for an aircraft over New York, loading the airport table on demand', async () => {
    render(<dl><ListenLinks event={ev({ latitude: 40.7, longitude: -73.9 })} /></dl>);
    const atc = await screen.findByRole('link', { name: /LiveATC/ });
    expect(atc.getAttribute('href')).toMatch(/^https:\/\/www\.liveatc\.net\/search\/\?icao=K/);
    expect(atc.getAttribute('rel')).toContain('noopener');
    expect(screen.getByRole('link', { name: /New York \(Broadcastify\)/ }).getAttribute('href')).toBe('https://www.broadcastify.com/listen/stid/36');
  });

  it('shows nothing for a record without a location', () => {
    const { container } = render(<dl><ListenLinks event={ev({ locationPrecision: 'none' })} /></dl>);
    expect(container.textContent).toBe('');
  });
});
