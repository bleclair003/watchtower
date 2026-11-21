// @vitest-environment node
/**
 * US embassy posture from State Department advisories. The fixture is real: the Yemen, Iraq,
 * Ukraine, Russia and Belarus advisories from the feed of 2026-11-21.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { FetchResult } from '../lib/http.ts';
import { parseFeed } from '../lib/feed.ts';
import { htmlToText } from '../lib/text.ts';
import { advisoryPosture, postureChanges, stateTravelAdvisories, type StateAdvisoryState } from '../adapters/stateTravelAdvisories.ts';
import { validateEvent } from '../lib/validate.ts';
import { INDICATOR_CATALOG, validateCatalog } from '../../shared/domain/indicators/catalog.ts';
import { evaluateIndicator } from '../../shared/domain/indicators/evaluate.ts';

const NOW = Date.parse('2026-11-21T11:00:00Z');
const xml = readFileSync(new URL('./fixtures/state-advisories-posture.sample.xml', import.meta.url), 'utf8');
const ok = (b: string): FetchResult => ({ kind: 'ok', status: 200, body: b, bytes: b.length, validators: {} });
const text = (name: string) => htmlToText(parseFeed(xml).find((i) => i.title.startsWith(name))!.description);

describe('embassy posture in real advisories', () => {
  it('reads ordered departure and suspended operations', () => {
    expect(advisoryPosture(text('Belarus'))).toEqual({ departure: 'ordered', suspended: true });
    expect(advisoryPosture(text('Yemen'))).toEqual({ departure: null, suspended: true });
    expect(advisoryPosture(text('Russia')).suspended).toBe(true);
    expect(advisoryPosture(text('Iraq'))).toEqual({ departure: null, suspended: false }); // "limited ability to help" only
  });

  it('reads standard departure wording and its lifting', () => {
    expect(advisoryPosture('On October 19, 2026, the Department of State ordered the departure of non-emergency U.S. government employees and family members.').departure).toBe('ordered');
    expect(advisoryPosture('The Department authorized the departure of family members of U.S. government employees.').departure).toBe('authorized');
    expect(advisoryPosture('On May 2, the Department lifted the ordered departure of non-emergency staff.').departure).toBeNull();
    expect(advisoryPosture('The U.S. Embassy resumed normal operations on June 1.').suspended).toBe(false);
  });

  it('lists the changes between two readings', () => {
    expect(postureChanges({ departure: null, suspended: false }, { departure: 'ordered', suspended: false })).toEqual(['ordered-departure']);
    expect(postureChanges({ departure: 'authorized', suspended: false }, { departure: 'ordered', suspended: true })).toEqual(['ordered-departure', 'operations-suspended']);
    expect(postureChanges({ departure: 'ordered', suspended: true }, { departure: null, suspended: false })).toEqual(['departure-lifted', 'operations-resumed']);
  });
});

describe('adapter', () => {
  const iraqUrl = parseFeed(xml).find((i) => i.title.startsWith('Iraq'))!.link;

  it('a reissued advisory that adds an ordered departure becomes its own record, and the indicator fires', async () => {
    // Yesterday's state: Iraq known, no departure, published earlier.
    const prev: StateAdvisoryState = { validators: {}, baselineAt: '2026-11-01T00:00:00Z', advisories: { [iraqUrl]: { name: 'Iraq', iso: 'IQ', level: 4, publishedAt: '2026-01-01T00:00:00.000Z', posture: { departure: null, suspended: false } } } };
    const reissued = xml.replace(/(<title>Iraq - Level 4: Do Not Travel<\/title>[\s\S]*?<description>)/, '$1On November 20, 2026, the Department of State ordered the departure of non-emergency U.S. government employees from Baghdad. ');
    const r = await stateTravelAdvisories.collect({ now: NOW, state: prev, fetch: async () => ok(reissued) });
    const posture = r.events.filter((e) => e.metadata?.subtype === 'embassy-posture');
    expect(posture.map((e) => [e.countryCodes[0], e.metadata?.postureChange])).toEqual([['IQ', 'ordered-departure']]);
    expect(posture[0].title).toBe('Iraq: ORDERED DEPARTURE of US government staff — State Department travel advisory (Level 4)');
    expect(posture[0].regionIds).toEqual(['middle-east']);
    expect(validateEvent(posture[0], NOW)).toBeNull();
    expect(r.state.advisories[iraqUrl].posture).toEqual({ departure: 'ordered', suspended: false });

    const defs = INDICATOR_CATALOG.filter((d) => d.id.endsWith('.embassy-drawdown'));
    expect(validateCatalog(defs)).toEqual([]);
    expect(defs.length).toBe(6);
    const iso = (t: number) => new Date(t).toISOString();
    const status = [{ sourceId: 'state-travel-advisories', health: 'ONLINE' as const, lastAttemptAt: iso(NOW), lastSuccessAt: iso(NOW), firstSuccessAt: iso(NOW - 30 * 864e5), lastNewItemAt: iso(NOW), consecutiveFailures: 0, parseErrors: 0, lastError: null }];
    expect(evaluateIndicator(defs.find((d) => d.regionId === 'middle-east')!, r.events, status, NOW).state).toBe('TRIGGERED');
  });

  it('advisories recorded before posture tracking get a baseline, not a flood of records', async () => {
    const prev: StateAdvisoryState = { validators: {}, baselineAt: '2026-11-01T00:00:00Z', advisories: { [iraqUrl]: { name: 'Iraq', iso: 'IQ', level: 4, publishedAt: '2026-01-01T00:00:00.000Z' } } };
    const r = await stateTravelAdvisories.collect({ now: NOW, state: prev, fetch: async () => ok(xml) });
    expect(r.events.filter((e) => e.metadata?.subtype === 'embassy-posture')).toEqual([]);
    expect(r.state.advisories[iraqUrl].posture).toEqual({ departure: null, suspended: false });
  });
});
