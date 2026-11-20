// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { IntelligenceEvent } from '../types.ts';
import { addEvidence, buildTimeline, createIncident, incidentToMarkdown, suggestRelated, titleTokens, validateIncident } from './logic.ts';
import type { Incident } from './types.ts';

const NOW = '2026-12-20T12:00:00.000Z';
const t = (h: number) => new Date(Date.parse(NOW) - h * 3_600_000).toISOString();

function ev(id: string, p: Partial<IntelligenceEvent> = {}): IntelligenceEvent {
  return {
    id, contentHash: id, dataOrigin: 'live', sourceId: 'state-travel-advisories', sourceName: 'U.S. Department of State', sourceClass: 'official',
    sourceUrl: `https://travel.state.gov/${id}`, title: `Event ${id}`, category: 'diplomatic', regionIds: ['red-sea'], countryCodes: ['YE'],
    publishedAt: t(10), occurredAt: null, collectedAt: t(9), credibility: 'official', verificationStatus: 'unreviewed', locationPrecision: 'country', ...p,
  };
}

describe('createIncident / addEvidence', () => {
  it('seeds a dossier from an event with a denormalized, traceable copy', () => {
    const i = createIncident(NOW, ev('a', { title: '[SIMULATED] Yemen — Level 4: Do Not Travel' }));
    expect(i.title).toBe('Yemen — Level 4: Do Not Travel');
    expect(i.regionIds).toEqual(['red-sea']);
    expect(i.evidence[0]).toMatchObject({ assessment: 'unconfirmed', event: { eventId: 'a', sourceUrl: 'https://travel.state.gov/a', collectedAt: t(9) } });
    expect(validateIncident(i)).toEqual([]);
  });

  it('never links the same event twice', () => {
    const i = createIncident(NOW, ev('a'));
    expect(addEvidence(i, ev('a'), NOW)).toBe(i);
    expect(addEvidence(i, ev('b'), NOW).evidence).toHaveLength(2);
  });
});

describe('validateIncident', () => {
  const ok = () => createIncident(NOW, ev('a'));
  it('rejects malformed dossiers with specific reasons', () => {
    expect(validateIncident({ ...ok(), title: ' ' })[0]).toMatch(/title/);
    expect(validateIncident({ ...ok(), status: 'panic' })[0]).toMatch(/status/);
    expect(validateIncident({ ...ok(), regionIds: ['atlantis'] })[0]).toMatch(/regions/);
    const dup = ok();
    dup.evidence.push({ ...dup.evidence[0] });
    expect(validateIncident(dup)[0]).toMatch(/duplicate event/);
    const self = ok();
    expect(validateIncident({ ...self, linkedIncidentIds: [self.id] })[0]).toMatch(/linked incidents/);
    expect(validateIncident({ ...ok(), indicatorIds: ['nope'] })[0]).toMatch(/indicators/);
    expect(validateIncident({ ...ok(), notes: [{ id: 'n', text: '', createdAt: NOW, updatedAt: NOW }] })[0]).toMatch(/notes\[0\]/);
    expect(validateIncident({ ...ok(), id: '../x' })[0]).toMatch(/invalid id/);
  });
});

describe('buildTimeline', () => {
  const inc: Incident = {
    ...createIncident(NOW),
    evidence: [
      { event: { ...createIncident(NOW, ev('late')).evidence[0].event, occurredAt: t(30), publishedAt: t(5), collectedAt: t(4) }, assessment: 'confirmed', addedAt: NOW, note: '' },
      { event: { ...createIncident(NOW, ev('early')).evidence[0].event, occurredAt: null, publishedAt: t(20), collectedAt: t(2) }, assessment: 'context', addedAt: NOW, note: '' },
    ],
  };

  it('orders by the chosen clock and keeps all three times distinct', () => {
    expect(buildTimeline(inc.evidence, 'occurred').map((x) => [x.link.event.eventId, x.basisUsed])).toEqual([
      ['late', 'occurred'],
      ['early', 'published'], // occurrence not stated → falls back, and says so
    ]);
    expect(buildTimeline(inc.evidence, 'published').map((x) => x.link.event.eventId)).toEqual(['early', 'late']);
    expect(buildTimeline(inc.evidence, 'collected').map((x) => x.link.event.eventId)).toEqual(['late', 'early']);
  });

  it('reports reporting and collection lags', () => {
    const late = buildTimeline(inc.evidence, 'occurred')[0];
    expect(late.reportingLagHours).toBe(25);
    expect(late.collectionLagHours).toBe(1);
    expect(buildTimeline(inc.evidence, 'occurred')[1].reportingLagHours).toBeNull();
  });
});

describe('suggestRelated', () => {
  const inc = createIncident(NOW, ev('seed', { title: 'Houthi drone attack on tanker near Hodeidah' }));

  it('ranks by explainable shared terms / country / time, and excludes linked records', () => {
    const s = suggestRelated(inc, [
      ev('seed'),
      ev('near', { title: 'Second tanker reports drone near Hodeidah port' }),
      ev('country', { title: 'Embassy closure notice' }),
      ev('unrelated', { title: 'Siemens SIMATIC advisory', countryCodes: [], regionIds: ['global-cyber'], category: 'cyber' }),
      ev('regionOnly', { title: 'Shipping insurance rates', countryCodes: ['DJ'] }),
    ]);
    expect(s.map((x) => x.event.id)).toEqual(['near', 'country']);
    expect(s[0].reasons.join(' ')).toMatch(/shared terms: .*(tanker|drone|hodeidah)/);
    expect(s[1].reasons).toContain('same country: YE');
  });

  it('tokenizes titles without stop words', () => {
    expect([...titleTokens('Yemen — Level 4: Do Not Travel')]).toEqual(['yemen']);
    expect([...titleTokens('Syria — Level 4: Do Not Travel')]).toEqual(['syria']);
  });
});

describe('incidentToMarkdown', () => {
  it('exports a traceable evidence packet with caveats and flags non-live data', () => {
    let inc = createIncident(NOW, ev('a', { title: 'Vessel attacked', occurredAt: t(12) }));
    inc = { ...addEvidence(inc, ev('d', { dataOrigin: 'demo', title: 'Demo record', sourceUrl: '' }), NOW), summary: 'Operator view.' };
    inc.notes = [{ id: 'n1', text: 'Await UKMTO confirmation.', createdAt: NOW, updatedAt: NOW }];
    const md = incidentToMarkdown(inc, NOW);
    expect(md).toMatch(/^# WATCHTOWER dossier: Vessel attacked/);
    expect(md).toContain('https://travel.state.gov/a');
    expect(md).toContain('official statement establishes that a statement was made');
    expect(md).toContain('Data origin: DEMO (not live collection)');
    expect(md).toContain('Occurred: ' + t(12));
    expect(md).toContain('Await UKMTO confirmation.');
  });
});
