// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { coverageGaps, stems } from '../../shared/domain/coverage.ts';
import { coverageMeter } from '../../shared/domain/meters/coverageMeter.ts';

const NOW = Date.parse('2026-11-21T15:00:00Z');
let n = 0;
const ev = (title: string, sourceId: string, h: number, regionIds = ['middle-east']): IntelligenceEvent => {
  const id = `e${++n}`;
  const t = new Date(NOW - h * 3_600_000).toISOString();
  return { id, contentHash: id, dataOrigin: 'live', sourceId, sourceName: sourceId, sourceClass: sourceId === 'un-news' ? 'official' : 'media', sourceUrl: `https://example.test/${id}`, title, category: 'military', regionIds, countryCodes: [], publishedAt: t, occurredAt: null, collectedAt: t, credibility: 'single-source', verificationStatus: 'unreviewed', locationPrecision: 'country' };
};
const filler = (sourceId: string, k: number, regionIds = ['middle-east']) => Array.from({ length: k }, (_, i) => ev(`${sourceId} regional item number ${i} on budgets`, sourceId, 5 + i, regionIds));

describe('coverage gaps', () => {
  it('flags a story one side ran twice while another side covered the region', () => {
    const story = [ev('Saudi-led coalition intercepts three Houthi missiles headed for Riyadh', 'aljazeera', 3), ev('Iran war live: Saudi-led coalition downs Houthi missiles', 'aljazeera', 4)];
    const c = coverageGaps([...story, ...filler('bbc-world', 3)], 'middle-east', NOW);
    expect(c.gaps).toHaveLength(1);
    expect(c.gaps[0]).toMatchObject({ side: 'aljazeera', reports: 2, kind: 'story', missingFrom: ['bbc'] });
  });

  it('does not flag the same event told in different words (real pairs of 2026-11-21)', () => {
    const e = [
      ev('Russian missiles hit Poland: What happened, and could NATO respond?', 'aljazeera', 3, ['eastern-europe']),
      ev("Russian missile hits Poland as Ukraine's allies hold military exercise, says Tusk", 'bbc-world', 4, ['eastern-europe']),
      ev('Ukraine strikes Kerch Bridge as Putin ally declares no one needs Europe', 'aljazeera', 5, ['eastern-europe']),
      ev("Zelensky says Crimean Bridge strikes 'fair response'", 'bbc-world', 6, ['eastern-europe']),
      ...filler('bbc-world', 3, ['eastern-europe']),
      ...filler('aljazeera', 3, ['eastern-europe']),
    ];
    expect(coverageGaps(e, 'eastern-europe', NOW).gaps).toEqual([]);
    expect([...stems('Russian missiles hit Poland')]).toEqual(expect.arrayContaining(['russian', 'missil', 'hit', 'poland']));
  });

  it('single strike reports count; other single reports do not', () => {
    const e = [ev('Israeli airstrike kills five in Gaza camp', 'aljazeera', 2), ev('Gaza bakery reopens', 'aljazeera', 3), ...filler('bbc-world', 4)];
    expect(coverageGaps(e, 'middle-east', NOW).gaps.map((g) => g.kind)).toEqual(['strike']);
  });

  it('says when gaps cannot be assessed or only one side reported', () => {
    const few = coverageMeter({ now: NOW, events: [ev('Israeli airstrike kills five', 'aljazeera', 2), ev('Talks on Gaza', 'bbc-world', 3)], historyStart: null, sourceStatus: [], regionScores: [], scoreHistory: [] }, 'middle-east');
    expect(few.label).toBe('TOO FEW REPORTS');
    const one = coverageMeter({ now: NOW, events: filler('aljazeera', 4), historyStart: null, sourceStatus: [], regionScores: [], scoreHistory: [] }, 'middle-east');
    expect(one.label).toBe('ONLY AL JAZEERA');
  });

  it('real records of 2026-11-21: no gaps in 72 h; plausible ones over 10 days', () => {
    const events = JSON.parse(readFileSync(new URL('./fixtures/meters-events.sample.json', import.meta.url), 'utf8')) as IntelligenceEvent[];
    const now = Math.max(...events.map((e) => Date.parse(e.collectedAt)));
    expect(coverageGaps(events, 'eastern-europe', now).gaps).toEqual([]);
    const wide = coverageGaps(events, 'middle-east', now, 240).gaps.map((g) => g.title);
    expect(wide).toContain('Saudi-led coalition intercepts three Houthi missiles headed for Riyadh');
  });
});
