// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { trackRecord } from '../../shared/domain/trackRecord.ts';

const NOW = Date.parse('2026-11-25T15:00:00Z');
const H = 3_600_000;
const START = NOW - 10 * 24 * H;
let n = 0;
const ev = (title: string, sourceId: string, h: number, countryCodes = ['IL']): IntelligenceEvent => {
  const id = `e${++n}`;
  const t = new Date(NOW - h * H).toISOString();
  return { id, contentHash: id, dataOrigin: 'live', sourceId, sourceName: sourceId, sourceClass: 'media', sourceUrl: `https://example.test/${id}`, title, category: 'military', regionIds: ['middle-east'], countryCodes, publishedAt: t, occurredAt: null, collectedAt: t, credibility: 'single-source', verificationStatus: 'unreviewed', locationPrecision: 'country' };
};
const rec = (events: IntelligenceEvent[], id: string, start = START) => trackRecord(events, NOW, start).sources.find((s) => s.sourceId === id)!;

describe('source track record', () => {
  it('a leading report picked up by another publisher within 48 h is confirmed; the follower is not leading', () => {
    const e = [ev('Israeli airstrike destroys Gaza hospital wing', 'aljazeera', 100), ev('Gaza hospital wing destroyed in Israeli airstrike', 'bbc-world', 95)];
    expect(rec(e, 'aljazeera')).toMatchObject({ leading: 1, confirmed: 1, strikeLeading: 1, strikeConfirmed: 1, medianHoursToConfirm: 5 });
    expect(rec(e, 'bbc-world')).toBeUndefined();
  });

  it('unconfirmed, late and too-recent reports', () => {
    const e = [
      ev('Kuwait budget passes parliament vote', 'aljazeera', 100, ['KW']),
      ev('Kuwait parliament budget vote passes', 'bbc-world', 40, ['KW']), // 60 h later: outside 48 h, so the first is not confirmed
      ev('Fresh report from today', 'aljazeera', 5),
    ];
    expect(rec(e, 'aljazeera')).toMatchObject({ leading: 1, confirmed: 0, pending: 1 });
    expect(rec(e, 'bbc-world')).toMatchObject({ leading: 0, pending: 1 }); // 40 h old: not yet judged
  });

  it('generic shared words do not count as the same story', () => {
    const e = [ev('IRGC downs US drone as efforts to end war remain stalled', 'aljazeera', 100, []), ev('Senator rejects tying government funding to an end to the war', 'npr-national', 99, [])];
    expect(rec(e, 'aljazeera')).toMatchObject({ leading: 1, confirmed: 0 });
  });

  it('reports from before collection began are not judged', () => {
    const e = [ev('Old item from a back-filled feed', 'un-news', 300), ev('Item after collection began', 'un-news', 100)];
    expect(rec(e, 'un-news').leading).toBe(1);
  });

  it('runs on the real records of 2026-11-21 (as if three days later)', () => {
    const events = JSON.parse(readFileSync(new URL('./fixtures/meters-events.sample.json', import.meta.url), 'utf8')) as IntelligenceEvent[];
    const last = Math.max(...events.map((e) => Date.parse(e.collectedAt)));
    const start = Math.min(...events.map((e) => Date.parse(e.collectedAt)));
    const r = trackRecord(events, last + 3 * 24 * H, start);
    const bbc = r.sources.find((s) => s.publisher === 'BBC News')!;
    expect(bbc.leading).toBeGreaterThan(10);
    expect(bbc.confirmed).toBeGreaterThan(0);
    expect(r.sources.every((s) => s.confirmed <= s.leading)).toBe(true);
  });
});
