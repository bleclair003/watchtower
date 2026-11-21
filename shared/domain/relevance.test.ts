import { describe, expect, it } from 'vitest';
import type { EventCategory, SourceClass } from './types.ts';
import { offTopicReason, relevantTopic } from './relevance.ts';

/** Headlines are real ones seen on 2026-11-20/21. */
const item = (title: string, o: { url?: string; category?: EventCategory; sourceClass?: SourceClass } = {}) => ({
  title,
  sourceUrl: o.url ?? 'https://www.bbc.co.uk/news/articles/x',
  category: o.category ?? ('general' as EventCategory),
  sourceClass: o.sourceClass ?? ('media' as SourceClass),
});

describe('news relevance (relevant topics only)', () => {
  it('keeps news about security, politics, rights, humanitarian issues and the economy, wherever it happens', () => {
    expect(relevantTopic(item('Denmark accuses Russia of plotting to assassinate US-Ukrainian rapper'))).toMatch(/security/);
    // Found on live data: missed before combat verbs were added.
    expect(offTopicReason(item('Russia targets Kyiv crossings days after Ukraine hits Crimean Bridge'))).toBeNull();
    expect(relevantTopic(item("ANC fights to keep control of South Africa's key cities after election setback"))).toMatch(/politics: "election"/);
    expect(relevantTopic(item('Myanmar committed genocide against Rohingya minority, top UN court rules'))).not.toBeNull();
    expect(relevantTopic(item("Can Africa's new credit rating agency change how the continent is assessed?"))).toMatch(/economy/);
    expect(relevantTopic(item('Zelensky says Putin is a killer'))).not.toBeNull();
  });

  it('hides everything else, with the reason', () => {
    expect(offTopicReason(item('Can Mauricio Pochettino save Man United from Premier League relegation?', { url: 'https://www.aljazeera.com/sports/2026/11/21/x' })))
      .toBe('Filed under sport by the outlet');
    expect(offTopicReason(item("Catherine Zeta-Jones' daughter says parents warned her about 'nepo baby' label"))).toMatch(/^Entertainment/);
    expect(offTopicReason(item('Texas death-row inmate screams as execution takes more than one hour'))).toBe('No relevant topic in the headline');
    expect(offTopicReason(item('Indonesian daycare principal jailed for five years over child abuse case'))).toBe('No relevant topic in the headline');
  });

  it('never hides classified topics or official and structured sources', () => {
    expect(offTopicReason(item('Football stadium becomes shelter', { category: 'disaster' }))).toBeNull();
    expect(offTopicReason(item('Museum reopens', { sourceClass: 'official' }))).toBeNull();
    expect(offTopicReason(item('Earthquake M5.1 — Vanuatu', { sourceClass: 'scientific' }))).toBeNull();
  });

  it('matches whole words, and short abbreviations only in capitals', () => {
    expect(offTopicReason(item('New software firm opens office'))).not.toBeNull(); // "war" inside "software" does not count
    expect(offTopicReason(item('An unusual week for bakers'))).not.toBeNull(); // "un" inside words, lowercase
    expect(relevantTopic(item('UN chief calls for calm'))).toMatch(/politics: "un"/);
  });
});
