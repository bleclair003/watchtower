// @vitest-environment node
/**
 * Federal Register. Fixtures are real API responses captured 2026-11-21: presidential documents
 * since Aug. 1, BIS export-control rules since June 1, and State Department terrorist notices.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { FetchResult } from '../lib/http.ts';
import { FEDREG_SOURCE_ID, classify, federalRegister, fedregEvents, type FedRegDoc } from '../adapters/federalRegister.ts';
import { validateEvent } from '../lib/validate.ts';
import { INDICATOR_CATALOG, validateCatalog } from '../../shared/domain/indicators/catalog.ts';
import { evaluateIndicator } from '../../shared/domain/indicators/evaluate.ts';

const NOW = Date.parse('2026-11-21T12:00:00Z');
const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const docs = (n: string) => (JSON.parse(fx(n)) as { results: FedRegDoc[] }).results;
const pres = docs('fedreg-presidential.sample.json');
const titleOf = (re: RegExp, list: FedRegDoc[]) => list.find((d) => re.test(d.title))!;

describe('classification (real documents)', () => {
  it('keeps security and foreign-policy presidential documents', () => {
    expect(classify(titleOf(/Sanctioning Russia and Iran/, pres), 'presidential')).toBe('executive-order');
    expect(classify(titleOf(/Revocation of Presidential Determinations Related to Lebanon/, pres), 'presidential')).toBe('presidential-action');
    expect(classify(titleOf(/Defense Production Act/, pres), 'presidential')).toBe('presidential-action');
  });

  it('skips routine continuations, commemorations and unrelated orders', () => {
    expect(classify(titleOf(/Continuation of the National Emergency With Respect to Iran/, pres), 'presidential')).toBeNull();
    expect(classify(titleOf(/^Patriot Day/, pres), 'presidential')).toBeNull(); // mentions terrorist attacks, but commemorative
    expect(classify(titleOf(/Super Intelligence/, pres), 'presidential')).toBeNull(); // "intelligence" here is AI
    expect(classify(titleOf(/Veterans Day/, pres), 'presidential')).toBeNull();
    expect(classify(titleOf(/Housing Costs/, pres), 'presidential')).toBeNull();
  });

  it('recognises new and terminated national emergencies', () => {
    const d = (title: string): FedRegDoc => ({ title, type: 'Presidential Document', subtype: 'Executive Order', publication_date: '2026-11-20', html_url: 'https://www.federalregister.gov/d/1', document_number: '2026-1' });
    expect(classify(d('Declaring a National Emergency With Respect to the Situation in Venezuela'), 'presidential')).toBe('national-emergency-declared');
    expect(classify(d('Termination of the National Emergency With Respect to Syria'), 'presidential')).toBe('national-emergency-terminated');
  });

  it('terrorist notices: designations and revocations only', () => {
    const st = docs('fedreg-state-terror.sample.json');
    expect(classify(titleOf(/^Foreign Terrorist Organization Designation of Los Lorenzanas/, st), 'terrorism')).toBe('terrorist-designation');
    expect(classify(titleOf(/^Revocation of the Designation of Al-Nusrah Front/, st), 'terrorism')).toBe('terrorist-revocation');
    expect(classify(titleOf(/^Delegation of Authority/, st), 'terrorism')).toBeNull();
    expect(classify(titleOf(/Privacy Act/, st), 'terrorism')).toBeNull();
  });
});

describe('records', () => {
  it('tags countries from the title and abstract, and never dates in the future', () => {
    const eo = titleOf(/Sanctioning Russia and Iran/, pres);
    const future = { ...eo, document_number: 'x', publication_date: '2026-11-25' };
    const [a, b] = fedregEvents([{ doc: eo, kind: 'executive-order' }, { doc: future, kind: 'executive-order' }], NOW);
    expect(a.title).toBe('Executive order 14436: Implementing the Lindsey O. Graham Sanctioning Russia and Iran Act of 2026');
    expect(a.countryCodes).toEqual(['RU', 'IR']);
    expect(a.regionIds).toEqual(['eastern-europe', 'middle-east']);
    expect(validateEvent(a, NOW)).toBeNull();
    expect(b.publishedAt).toBe('2026-11-21T12:00:00.000Z');
    expect(b.summary).toMatch(/to be published 2026-11-25/);
  });
});

describe('adapter and indicators', () => {
  it('three queries at most every 2 hours', async () => {
    const fetch = vi.fn(async (url: string): Promise<FetchResult> => {
      const body = url.includes('PRESDOCU') ? fx('fedreg-presidential.sample.json') : url.includes('industry-and-security') ? fx('fedreg-bis.sample.json') : fx('fedreg-state-terror.sample.json');
      return { kind: 'ok', status: 200, body, bytes: body.length, validators: {} };
    });
    const r = await federalRegister.collect({ now: NOW, state: null, fetch });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(r.events.length).toBeGreaterThan(10);
    fetch.mockClear();
    expect((await federalRegister.collect({ now: NOW + 3_600_000, state: r.state, fetch })).notModified).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a new national emergency on a region triggers', () => {
    const defs = INDICATOR_CATALOG.filter((d) => d.requiredSourceIds.includes(FEDREG_SOURCE_ID));
    expect(validateCatalog(defs)).toEqual([]);
    expect(defs.length).toBe(12);
    const doc: FedRegDoc = { title: 'Declaring a National Emergency With Respect to Iran', type: 'Presidential Document', subtype: 'Executive Order', executive_order_number: 14440, publication_date: '2026-11-20', html_url: 'https://www.federalregister.gov/d/2026-99', document_number: '2026-99' };
    const events = fedregEvents([{ doc, kind: 'national-emergency-declared' }], NOW);
    const iso = (t: number) => new Date(t).toISOString();
    const status = [{ sourceId: FEDREG_SOURCE_ID, health: 'ONLINE' as const, lastAttemptAt: iso(NOW), lastSuccessAt: iso(NOW), firstSuccessAt: iso(NOW - 864e5), lastNewItemAt: iso(NOW), consecutiveFailures: 0, parseErrors: 0, lastError: null }];
    expect(evaluateIndicator(defs.find((d) => d.id === 'middle-east.us-national-emergency')!, events, status, NOW).state).toBe('TRIGGERED');
  });
});
