import { describe, expect, it } from 'vitest';
import type { EvidenceLink, Incident } from './types.ts';
import { buildBoard, originOf, removeHypothesis, setMark, validateHypotheses, type Mark } from './hypotheses.ts';
import { addWithMembers, incidentToMarkdown, validateIncident } from './logic.ts';
import type { IntelligenceEvent } from '../types.ts';

let n = 0;
function link(title: string, sourceId: string, assessment: EvidenceLink['assessment'] = 'confirmed', credibility: EvidenceLink['event']['credibility'] = 'official'): EvidenceLink {
  n++;
  return {
    event: {
      eventId: `ev${n}`,
      title,
      sourceId,
      sourceName: sourceId,
      sourceClass: 'media',
      sourceUrl: `https://example.test/${n}`,
      category: 'maritime',
      credibility,
      regionIds: ['eastern-europe'],
      countryCodes: [],
      publishedAt: '2026-11-24T10:00:00Z',
      occurredAt: null,
      collectedAt: '2026-11-24T10:05:00Z',
      dataOrigin: 'live',
    },
    assessment,
    addedAt: '2026-11-24T11:00:00Z',
    note: '',
  };
}
const H = [
  { id: 'acc', label: 'Accident (anchor drag)', note: '' },
  { id: 'sab', label: 'Sabotage', note: '' },
  { id: 'mnt', label: 'Scheduled maintenance', note: '' },
];
function incident(evidence: EvidenceLink[], hypotheses = H): Incident {
  return {
    id: 'i1',
    title: 'Invented cable fault',
    summary: '',
    status: 'developing',
    category: 'maritime',
    regionIds: ['eastern-europe'],
    evidence,
    notes: [],
    linkedIncidentIds: [],
    indicatorIds: [],
    hypotheses,
    createdAt: '2026-11-24T11:00:00Z',
    updatedAt: '2026-11-24T11:00:00Z',
    version: 1,
  };
}
const mark = (i: Incident, ev: EvidenceLink, marks: Record<string, Mark>) =>
  Object.entries(marks).reduce((d, [h, m]) => setMark(d, ev.event.eventId, h, { m, why: '' }), i);

describe('competing hypotheses', () => {
  it('ranks by evidence against, not for, and flags records that do not help choose', () => {
    const dragged = link('Invented ship seen dragging anchor over the cable', 'ais-sanctioned-ships');
    const noNotice = link('Invented operator: no maintenance was planned', 'operator-news');
    const outage = link('Invented internet outage on the island', 'ioda-outages');
    let i = incident([dragged, noNotice, outage]);
    i = mark(i, dragged, { acc: 'CC', sab: 'C', mnt: 'II' });
    i = mark(i, noNotice, { acc: 'N', sab: 'N', mnt: 'II' });
    i = mark(i, outage, { acc: 'C', sab: 'C', mnt: 'C' });
    const b = buildBoard(i);
    expect(b.ranking.map((s) => [s.id, s.against, s.support])).toEqual([
      ['acc', 0, 3],
      ['sab', 0, 2],
      ['mnt', 4, 1],
    ]);
    expect(b.tied).toBe(true);
    expect(b.notDiagnostic).toEqual([outage.event.eventId]);
    expect(b.unmarked).toEqual([]);
  });

  it('counts records with the same origin once (the same agency credited, or the same source)', () => {
    const a = link('Invented port closed after blast, Reuters reports', 'bbc-world');
    const b = link('Invented port closure confirmed (Reuters)', 'aljazeera');
    const c = link('Invented harbour authority statement', 'official-feed');
    expect(originOf(a)).toBe(originOf(b));
    let i = incident([a, b, c]);
    i = mark(i, a, { acc: 'I' });
    i = mark(i, b, { acc: 'II' });
    i = mark(i, c, { acc: 'I' });
    const board = buildBoard(i);
    const s = board.ranking.find((x) => x.id === 'acc')!;
    // Reuters counts once at its strongest (2), plus the separate statement (1).
    expect(s.against).toBe(3);
    expect(s.marked).toBe(3);
    expect(board.sharedOrigins).toEqual([[originOf(a), 2]]);
  });

  it('separates weak evidence and shows when confirmed evidence alone changes the leader', () => {
    const rumour = link('Invented unverified claim of divers at the cable', 'chat-channel', 'unconfirmed', 'unverified');
    const fact = link('Invented official finding: hull scrape marks', 'official-feed', 'confirmed');
    const two = H.slice(0, 2);
    let i = incident([rumour, fact], two);
    i = mark(i, rumour, { acc: 'II', sab: 'C' });
    i = mark(i, fact, { acc: 'C', sab: 'I' });
    const b = buildBoard(i);
    expect(b.ranking.map((s) => s.id)).toEqual(['sab', 'acc']);
    expect(b.ranking[1]).toMatchObject({ id: 'acc', against: 2, againstWeak: 2 });
    expect(b.confirmedRanking[0].id).toBe('acc');
    expect(b.leaderChangesOnConfirmed).toBe(true);
  });

  it('validates hypotheses and marks, and removing a hypothesis removes its marks', () => {
    const ev = link('Invented record', 'x');
    let i = mark(incident([ev]), ev, { acc: 'I', sab: 'C' });
    expect(validateIncident(i)).toEqual([]);
    expect(validateHypotheses({ ...i, hypotheses: [...H, ...H] })).toContain('hypotheses[3]: invalid id');
    expect(validateHypotheses({ ...i, hypotheses: [{ id: 'a', label: ' ', note: '' }] }).join()).toMatch(/label/);
    i = removeHypothesis(i, 'sab');
    expect(i.hypotheses!.map((h) => h.id)).toEqual(['acc', 'mnt']);
    expect(i.evidence[0].marks).toEqual({ acc: { m: 'I', why: '' } });
    expect(validateIncident({ ...i, evidence: [{ ...i.evidence[0], marks: { gone: { m: 'C', why: '' } } }] }).join()).toMatch(/unknown hypothesis/);
    expect(validateIncident({ ...i, evidence: [{ ...i.evidence[0], marks: { acc: { m: 'X' as Mark, why: '' } } }] }).join()).toMatch(/invalid mark/);
    // Older dossiers without hypotheses stay valid.
    const { hypotheses: _h, ...old } = incident([link('Invented', 'y')]);
    expect(validateIncident(old)).toEqual([]);
  });

  it('brings the records behind a convergence record into the dossier', () => {
    const rec = (id: string, extra: Partial<IntelligenceEvent> = {}): IntelligenceEvent => ({
      id,
      contentHash: id,
      dataOrigin: 'live',
      sourceId: 'ais-shipping',
      sourceName: 'AIS',
      sourceClass: 'official',
      sourceUrl: `https://example.test/${id}`,
      title: `Invented ${id}`,
      category: 'maritime',
      regionIds: ['eastern-europe'],
      countryCodes: [],
      publishedAt: '2026-11-24T10:00:00Z',
      collectedAt: '2026-11-24T10:00:00Z',
      credibility: 'official',
      verificationStatus: 'unreviewed',
      locationPrecision: 'none',
      ...extra,
    });
    const conv = rec('conv', { sourceId: 'watchtower-convergence', metadata: { signalEventIds: ['s1', 's2', 'gone'] } });
    const r = addWithMembers(incident([], []), conv, [rec('s1'), rec('s2'), rec('other')], '2026-11-24T12:00:00Z');
    expect(r.incident.evidence.map((l) => l.event.eventId)).toEqual(['conv', 's1', 's2']);
    expect(r).toMatchObject({ added: 2, missing: 1 });
  });

  it('exports the ranking and every mark with its reason', () => {
    const ev = link('Invented ship seen dragging anchor', 'ais-sanctioned-ships');
    const i = setMark(incident([ev]), ev.event.eventId, 'mnt', { m: 'II', why: 'Operator says nothing was planned' });
    const md = incidentToMarkdown(i, '2026-11-24T12:00:00Z');
    expect(md).toContain('## Competing hypotheses');
    expect(md).toContain('against 2');
    expect(md).toContain('Scheduled maintenance: II (Very inconsistent) — Operator says nothing was planned');
  });
});
