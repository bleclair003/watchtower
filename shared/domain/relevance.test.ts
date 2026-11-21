import { describe, expect, it } from 'vitest';
import type { EventCategory, SourceClass } from './types.ts';
import { offTopicReason } from './relevance.ts';

/** Headlines are real ones seen on 2026-11-20/21. */
const item = (title: string, o: { url?: string; category?: EventCategory; sourceClass?: SourceClass; regionIds?: string[] } = {}) => ({
  title,
  sourceUrl: o.url ?? 'https://www.bbc.co.uk/news/articles/x',
  category: o.category ?? ('general' as EventCategory),
  sourceClass: o.sourceClass ?? ('media' as SourceClass),
  regionIds: o.regionIds ?? [],
});

describe('off-topic news', () => {
  it('hides sport by the outlet section, and entertainment, arts and lifestyle by keyword', () => {
    expect(offTopicReason(item('Can Mauricio Pochettino save Man United from Premier League relegation?', { url: 'https://www.aljazeera.com/sports/2026/11/21/x' })))
      .toBe('Filed under sport by the outlet');
    expect(offTopicReason(item("Catherine Zeta-Jones' daughter says parents warned her about 'nepo baby' label"))).toMatch(/Entertainment.*nepo baby/);
    expect(offTopicReason(item('Van Gogh painting sells for record $190.4m after row over its Nazi history'))).toMatch(/Arts.*painting/);
    expect(offTopicReason(item('Cumin-laced fizzy sodas are giving cola giants a tough fight in India'))).toMatch(/Lifestyle/);
  });

  it('never hides security stories, watch-region stories, classified topics or non-media sources', () => {
    // Found on live data: hidden for "rapper" before the safeguards.
    expect(offTopicReason(item('Denmark accuses Russia of plotting to assassinate US-Ukrainian rapper'))).toBeNull();
    expect(offTopicReason(item('Rapper performs at festival', { regionIds: ['eastern-europe'] }))).toBeNull();
    expect(offTopicReason(item('Football stadium used as military base', { category: 'military' }))).toBeNull();
    expect(offTopicReason(item('Museum reopens', { sourceClass: 'official' }))).toBeNull();
  });

  it('matches whole words only', () => {
    expect(offTopicReason(item('New software rules for chip exports'))).toBeNull(); // "war" inside "software" is not a security word…
    expect(offTopicReason(item('Software firm sponsors football league'))).toMatch(/Sport.*football/); // …so this is still off-topic
    expect(offTopicReason(item('Petrol prices rise'))).toBeNull(); // "pet" inside "petrol"
  });

  it('leaves ordinary general news visible', () => {
    expect(offTopicReason(item('ANC fights to keep control of South Africa key cities after election setback'))).toBeNull();
  });
});
