// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { actorMatcher, extractNames } from '../../shared/domain/actors.ts';
import { computeActors, packRegistry, unpackRegistry } from '../../shared/domain/actorsTrack.ts';
import { actorsMeter } from '../../shared/domain/meters/actorsMeter.ts';
import { buildBrief } from '../../shared/domain/brief/brief.ts';

const NOW = Date.parse('2026-11-21T15:00:00Z');
const H = 3_600_000;
let n = 0;
const ev = (title: string, h: number, p: Partial<IntelligenceEvent> = {}): IntelligenceEvent => {
  const id = `e${++n}`;
  const t = new Date(NOW - h * H).toISOString();
  return { id, contentHash: id, dataOrigin: 'live', sourceId: 'bbc-world', sourceName: 'BBC', sourceClass: 'media', sourceUrl: `https://example.test/${id}`, title, category: 'military', regionIds: ['middle-east'], countryCodes: [], publishedAt: t, occurredAt: null, collectedAt: t, credibility: 'single-source', verificationStatus: 'unreviewed', locationPrecision: 'country', ...p };
};

describe('names in headlines (real cases of 2026-11-21)', () => {
  it('finds personal names, stops at punctuation and possessives, drops places and phrases', () => {
    expect(extractNames('Steve Rosenberg: Historic talks with Xi and Trump are a coup for Putin')).toEqual(['Steve Rosenberg']);
    expect(extractNames('Abdul-Malik al-Houthi vows to continue attacks')).toEqual(['Abdul-Malik al-Houthi']);
    expect(extractNames('Ukraine: Civilian casualties in 2026 already far exceed previous years')).toEqual([]);
    expect(extractNames('Illicit alcohol kills 11 in northeast India’s Manipur state')).toEqual([]);
    expect(extractNames('Zelensky says Crimean Bridge strikes fair response')).toEqual([]);
    expect(extractNames('New tools for troops | Defense News Weekly Full Episode 11.17.26')).toEqual([]);
    expect(extractNames('Top US Democrat warns Trump admin')).toEqual([]);
  });

  it('tracked actors match their spellings, acronyms only in capitals', () => {
    const m = actorMatcher();
    expect(m(ev('Ansar Allah claims attack on ship', 1)).map((a) => a.id)).toEqual(['houthis']);
    expect(m(ev('Zelenskyy meets allies', 1)).map((a) => a.id)).toEqual(['zelensky']);
    expect(m(ev('IRGC navy seizes tanker', 1)).map((a) => a.id)).toEqual(['irgc']);
    expect(m(ev('Wagner fighters leave Mali as Africa Corps arrives', 1)).map((a) => a.id)).toEqual(['wagner']);
  });
});

describe('tracking', () => {
  it('the first run learns names without flagging them; later names with 2+ headlines are new', () => {
    const first = computeActors([ev('Jane Roe named envoy', 30)], NOW - 24 * H, null, null);
    expect(first.snapshot.newNames).toEqual([]);
    const reg = unpackRegistry(packRegistry(first.registry));
    expect(reg.names.get('jane roe')?.boot).toBe(true);
    const later = [ev('Jane Roe named envoy', 30), ev('Omar Haddad leads new militia', 5), ev('Omar Haddad militia clashes', 2, { sourceId: 'aljazeera' }), ev('Lina Saleh once', 3)];
    const second = computeActors(later, NOW, null, reg);
    expect(second.snapshot.newNames.map((x) => [x.name, x.mentions, x.publishers])).toEqual([['Omar Haddad', 2, 2]]);
  });

  it('counts actors per day and flags a rise against the usual level after 14 days', () => {
    const past = Array.from({ length: 6 }, (_, i) => ev('Hezbollah statement', 100 + i * 48));
    const surge = Array.from({ length: 8 }, (_, i) => ev('Hezbollah fires rockets', 2 + i * 4));
    const r = computeActors([...past, ...surge], NOW, NOW - 20 * 24 * H, null).snapshot;
    const hz = r.actors.find((a) => a.id === 'hezbollah')!;
    expect(hz.last72h).toBe(8);
    expect(hz.rising).toBe(true);
    expect(hz.daily.length).toBe(14);
    const m = actorsMeter({ now: NOW, events: [], historyStart: null, sourceStatus: [], regionScores: [], scoreHistory: [], actors: r }, 'middle-east');
    expect(m.label).toBe('1 RISING');
  });

  it('the daily brief lists new names', () => {
    const brief = buildBrief({ generatedAt: new Date(NOW).toISOString(), events: [], sourceStatus: [], lastRun: null, totalEventsStored: 0, indicatorEvaluations: [], regionScores: [], scoreHistory: [], actors: { computedAt: '', trackingSince: '', actors: [], newNames: [{ name: 'Omar Haddad', firstSeen: '', mentions: 3, publishers: 2, regionIds: ['middle-east'], sample: { title: 't', url: 'https://example.test' } }] } } as never, NOW);
    expect(brief.sections.find((s) => s.title.startsWith('New names'))!.lines[0].text).toBe('Omar Haddad — 3 headlines, 2 publisher(s) [MIDEAST]');
  });

  it('runs on the real records of 2026-11-21', () => {
    const events = JSON.parse(readFileSync(new URL('./fixtures/meters-events.sample.json', import.meta.url), 'utf8')) as IntelligenceEvent[];
    const now = Math.max(...events.map((e) => Date.parse(e.collectedAt)));
    const r = computeActors(events, now, null, null).snapshot;
    expect(r.actors[0].name).toBe('Trump');
    expect(r.actors.map((a) => a.name)).toEqual(expect.arrayContaining(['Putin', 'Houthis', 'Netanyahu', 'Hamas', 'IRGC', 'Zelensky']));
    expect(r.newNames).toEqual([]); // first run: everything is learned, nothing flagged
  });
});
