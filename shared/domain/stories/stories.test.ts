import { describe, expect, it } from 'vitest';
import type { IntelligenceEvent, SourceClass } from '../types.ts';
import { matchGazetteer } from '../geo/gazetteer.ts';
import { buildStories, groupFeed, storyTerms, stripLabel } from './stories.ts';

let n = 0;
/** Headlines below are real ones seen on 2026-11-20/21 (short quotes, used as test input). */
function ev(sourceId: string, title: string, publishedAt: string, sourceClass: SourceClass = 'media'): IntelligenceEvent {
  const id = `e${++n}`;
  return {
    id, contentHash: id, dataOrigin: 'live', sourceId, sourceName: `${sourceId} — feed`, sourceClass,
    sourceUrl: `https://example.org/${id}`, title, category: 'general', regionIds: [], countryCodes: matchGazetteer(title).countryCodes,
    publishedAt, occurredAt: null, collectedAt: publishedAt, credibility: sourceClass === 'official' ? 'official' : 'single-source',
    verificationStatus: 'unreviewed', locationPrecision: 'none',
  };
}

describe('story grouping', () => {
  it('groups the same event across outlets and marks it multi-source', () => {
    const a = ev('aljazeera', 'Denmark expels Russian diplomat over alleged plot to kill Ukrainian rapper', '2026-11-21T01:12:00Z');
    const b = ev('bbc-world', 'Denmark accuses Russia of plotting to assassinate US-Ukrainian rapper', '2026-11-20T21:57:00Z');
    const [s] = buildStories([a, b]);
    expect(s.memberIds).toEqual([a.id, b.id]);
    expect(s.leadId).toBe(a.id);
    expect(s.corroboration).toBe('multi-source');
    expect(s.publishers.map((p) => p.publisher).sort()).toEqual(['Al Jazeera English', 'BBC News']);
    expect(s.sharedTerms).toContain('rapper');
  });

  it('marks stories that include an official publisher', () => {
    const s = buildStories([
      ev('bbc-world', 'Myanmar committed genocide against Rohingya minority, top UN court rules', '2026-11-19T20:07:00Z'),
      ev('un-news', 'World’s top court finds Myanmar guilty of genocide against Rohingya', '2026-11-19T12:00:00Z', 'official'),
    ]);
    expect(s).toHaveLength(1);
    expect(s[0].corroboration).toBe('official');
  });

  it('counts publishers, not items: several BBC pieces are single-source', () => {
    const s = buildStories([
      ev('bbc-world', 'Myanmar committed genocide against Rohingya minority, top UN court rules', '2026-11-19T20:07:00Z'),
      ev('bbc-world', 'Myanmar faces historic genocide verdict at UN court over Rohingya massacres', '2026-11-18T23:04:00Z'),
    ]);
    expect(s[0].corroboration).toBe('single-source');
  });

  it('does not group by place names alone, nor across countries, nor far apart in time', () => {
    expect(buildStories([
      ev('bbc-world', 'Israel strikes Gaza as talks stall', '2026-11-20T10:00:00Z'),
      ev('aljazeera', 'Gaza: Israel opens crossing for aid', '2026-11-20T12:00:00Z'),
    ])).toEqual([]);
    expect(buildStories([
      ev('bbc-world', 'French police officers sentenced over assault', '2026-11-20T10:00:00Z'),
      ev('aljazeera', 'German police officers sentenced over assault', '2026-11-20T11:00:00Z'),
    ])).toEqual([]);
    expect(buildStories([
      ev('bbc-world', 'Three French police officers sentenced over assault', '2026-11-10T10:00:00Z'),
      ev('aljazeera', 'Three French police officers sentenced over assault', '2026-11-20T10:00:00Z'),
    ])).toEqual([]);
  });

  it('ignores page-type labels and never forms a story from one official publisher', () => {
    expect(stripLabel('Guidance: Military low flying: MOD sponsored air exercises')).toBe('Military low flying: MOD sponsored air exercises');
    expect(stripLabel('Bowen: Myanmar genocide verdict is historic')).toBe('Myanmar genocide verdict is historic');
    expect(buildStories([
      ev('uk-mod', 'Regulation: Notice of proposed amendments (NPA) documents', '2026-11-20T07:55:00Z', 'official'),
      ev('uk-mod', 'Regulation: Notice of proposed amendments (NPA) reference table', '2026-11-20T07:55:00Z', 'official'),
    ])).toEqual([]);
  });

  it('only headline feeds form stories', () => {
    expect(buildStories([
      ev('ioda-outages', 'Internet connectivity drop detected — Nigeria (BGP)', '2026-11-20T10:00:00Z', 'scientific'),
      ev('ioda-outages', 'Internet connectivity drop detected — Nigeria (BGP)', '2026-11-20T12:00:00Z', 'scientific'),
    ])).toEqual([]);
  });

  it('stems crudely so word forms match', () => {
    expect([...storyTerms('plot to assassinate').keys()]).toEqual(['plot', 'assass']);
    expect(storyTerms('assassination').has('assass')).toBe(true);
  });
});

describe('grouped feed', () => {
  it('shows each story once, at its newest report, and leaves other items alone', () => {
    const a = ev('aljazeera', 'Denmark expels Russian diplomat over alleged plot to kill Ukrainian rapper', '2026-11-21T01:12:00Z');
    const other = ev('usgs-earthquakes', 'Earthquake M5.1 — Vanuatu', '2026-11-21T00:30:00Z', 'scientific');
    const b = ev('bbc-world', 'Denmark accuses Russia of plotting to assassinate US-Ukrainian rapper', '2026-11-20T21:57:00Z');
    const feed = groupFeed([a, other, b], buildStories([a, other, b]));
    expect(feed.map((f) => f.event.id)).toEqual([a.id, other.id]);
    expect(feed[0].story?.memberIds).toHaveLength(2);
    expect(feed[1].story).toBeNull();
  });
});
