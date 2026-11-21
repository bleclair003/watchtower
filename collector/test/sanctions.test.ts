// @vitest-environment node
/**
 * Sanctions lists. Fixtures are real entries cut from the OFAC SDN, EU and UK lists published
 * 2026-11-20 (headers kept, a few dozen entries each).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { FetchResult } from '../lib/http.ts';
import { euSanctions, ofacSdn, parseEuList, parseOfacSdn, parseUkList, sanctionsEvents, stateIds, stateVessels, ukSanctions } from '../adapters/sanctions.ts';
import { programCountry, sanctionsCountry, targetCountry, type Designee } from '../../shared/domain/sanctions.ts';
import { validateEvent } from '../lib/validate.ts';
import { INDICATOR_CATALOG, validateCatalog } from '../../shared/domain/indicators/catalog.ts';
import { evaluateIndicator } from '../../shared/domain/indicators/evaluate.ts';

const NOW = Date.parse('2026-11-21T10:00:00Z');
const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const ok = (b: string): FetchResult => ({ kind: 'ok', status: 200, body: b, bytes: b.length, validators: { etag: '"x"' } });
const ofacXml = fx('ofac-sdn.sample.xml');
const euXml = fx('eu-sanctions.sample.xml');
const ukXml = fx('uk-sanctions.sample.xml');

describe('parsing the real lists', () => {
  it('OFAC: entries, programmes, countries and vessel identifiers', () => {
    const p = parseOfacSdn(ofacXml, 1);
    expect(p.publishedOn).toBe('2026-11-20');
    const artavil = p.designees.find((d) => d.name === 'ARTAVIL');
    const vessel = artavil ?? p.designees.find((d) => d.kind === 'vessel' && d.mmsi)!;
    expect(vessel.kind).toBe('vessel');
    expect(vessel.imo).toMatch(/^\d{7}$/);
    expect(vessel.mmsi).toMatch(/^\d{9}$/);
    expect(p.designees.some((d) => d.programs.includes('RUSSIA-EO14024'))).toBe(true);
    expect(p.designees.some((d) => d.countries.includes('YE'))).toBe(true);
    expect(() => parseOfacSdn('<html>maintenance</html>')).toThrow(/not an SDN list/);
    expect(() => parseOfacSdn(ofacXml)).toThrow(/only \d+ entries/); // a truncated list is refused
  });

  it('EU: dates, programmes and IMO numbers', () => {
    const p = parseEuList(euXml, 1);
    expect(p.publishedOn).toBe('2026-11-20');
    expect(p.designees.some((d) => d.designatedOn === '2026-10-08')).toBe(true);
    expect(p.designees.some((d) => d.programs.includes('UKR'))).toBe(true);
    expect(p.designees.filter((d) => d.kind === 'vessel').every((d) => /^\d{7}$/.test(d.imo ?? ''))).toBe(true);
  });

  it('UK: dates, regimes, ships', () => {
    const p = parseUkList(ukXml, 1);
    expect(p.publishedOn).toBe('2026-11-20');
    const nov12 = p.designees.filter((d) => d.designatedOn === '2026-11-12');
    expect(nov12.length).toBe(20);
    expect(nov12.filter((d) => d.kind === 'vessel').length).toBe(11);
    expect(nov12.every((d) => d.programs[0].includes('Russia'))).toBe(true);
    expect(nov12.filter((d) => d.kind === 'vessel').every((d) => /^\d{7}$/.test(d.imo ?? ''))).toBe(true);
  });
});

describe('target country', () => {
  it('comes from the programme, else from addresses, and never from vessel flags', () => {
    expect(programCountry('ofac', 'RUSSIA-EO14024')).toBe('RU');
    expect(programCountry('ofac', 'IFSR')).toBe('IR');
    expect(programCountry('ofac', 'SDGT')).toBeNull();
    expect(programCountry('eu', 'UKR')).toBe('RU');
    expect(programCountry('uk', "The Democratic People's Republic of Korea (Sanctions) (EU Exit) Regulations 2019")).toBe('KP');
    expect(sanctionsCountry('Korea, North')).toBe('KP');
    expect(sanctionsCountry('Region: Crimea')).toBe('UA');
    expect(targetCountry('ofac', { programs: ['SDGT'], countries: ['YE'] })).toEqual({ country: 'YE', basis: 'address' });
    expect(targetCountry('ofac', { programs: ['SDGT'], countries: [] })).toEqual({ country: null, basis: 'none' });
  });
});

describe('records', () => {
  const d = (id: string, p: Partial<Designee>): Designee => ({ id, name: `NAME ${id}`, kind: 'entity', programs: [], countries: [], designatedOn: null, imo: null, mmsi: null, ...p });

  it('groups new designations by target country, with honest wording', () => {
    const events = sanctionsEvents('ofac', '2026-11-20', [
      d('1', { programs: ['IRAN-EO13902'], kind: 'vessel' }),
      d('2', { programs: ['IFSR'] }),
      d('3', { programs: ['SDGT'], countries: ['YE'], kind: 'individual' }),
      d('4', { programs: ['CYBER2'] }),
    ], new Date(NOW).toISOString());
    expect(events.map((e) => e.title)).toEqual([
      'OFAC sanctions: 2 new designations targeting Iran — 1 vessel, 1 entity (2026-11-20)',
      'OFAC sanctions: 1 new designation linked to Yemen (addresses, nationality) — 1 individual (2026-11-20)',
      'OFAC sanctions: 1 new designation not country-specific — 1 entity (2026-11-20)',
    ]);
    expect(events[0]).toMatchObject({ regionIds: ['middle-east'], countryCodes: ['IR'], category: 'economic', sourceClass: 'official', locationPrecision: 'country' });
    expect(events[1].regionIds).toEqual(['red-sea']);
    expect(events[2]).toMatchObject({ regionIds: [], countryCodes: [], locationPrecision: 'none' });
    for (const e of events) expect(validateEvent(e, NOW)).toBeNull();
    expect(events[0].summary).toMatch(/not proof of the conduct alleged/);
  });
});

describe('adapters', () => {
  const run = (adapter: typeof ofacSdn, body: string, state: Parameters<typeof ofacSdn.collect>[0]['state'], now = NOW) => adapter.collect({ now, state, fetch: async () => ok(body) });

  it('OFAC: first run stores a baseline only (no dates); later runs record what is new', async () => {
    await expect(run(ofacSdn, ofacXml, null)).rejects.toThrow(/only \d+ entries/); // the fixture alone is too small to be a real list
    const filler = Array.from({ length: 1000 }, (_, i) => `<sdnEntry><uid>9${i}</uid><lastName>FILLER ${i}</lastName><sdnType>Entity</sdnType><programList><program>SDGT</program></programList></sdnEntry>`).join('');
    const full = ofacXml.replace('</sdnList>', `${filler}</sdnList>`);
    // Yesterday's copy lacked entry 36 (AEROCARIBBEAN AIRLINES, CUBA programme).
    const before = full.replace(/<sdnEntry>\s*<uid>36<\/uid>[\s\S]*?<\/sdnEntry>/, '');
    expect(before.length).toBeLessThan(full.length);
    const first = await run(ofacSdn, before, null);
    expect(first.events).toEqual([]);
    expect(stateVessels(first.state).some((v) => v.mmsi)).toBe(true);
    // Stored as single strings: Firestore refuses documents with ~20,000 indexed array elements.
    expect(typeof first.state.idsPacked).toBe('string');
    expect(first.state.ids).toBeUndefined();
    expect(stateIds(first.state).length).toBeGreaterThan(1000);
    const second = await run(ofacSdn, full, first.state, NOW + 3_600_000);
    expect(second.events.map((e) => e.title)).toEqual(['OFAC sanctions: 1 new designation targeting Cuba — 1 entity (2026-11-20)']);
  });

  it('refuses a flood of new ids (id scheme change), and respects 304 and the EU daily cadence', async () => {
    const state = { ids: ['a'], publishedOn: '2026-11-19', lastFetchedAt: new Date(NOW - 86_400_000).toISOString(), vessels: [] };
    const filler = Array.from({ length: 1200 }, (_, i) => `<sdnEntry><uid>8${i}</uid><lastName>X${i}</lastName><sdnType>Entity</sdnType></sdnEntry>`).join('');
    await expect(run(ofacSdn, ofacXml.replace('</sdnList>', `${filler}</sdnList>`), { ...state, ids: Array.from({ length: 1000 }, (_, i) => `z${i}`) })).rejects.toThrow(/refusing/);
    const notModified = await ofacSdn.collect({ now: NOW, state, fetch: async () => ({ kind: 'not-modified', status: 304 }) });
    expect(notModified).toMatchObject({ notModified: true, events: [] });
    const eu = await euSanctions.collect({ now: NOW, state: { ...state, lastFetchedAt: new Date(NOW - 3_600_000).toISOString() }, fetch: async () => { throw new Error('should not fetch'); } });
    expect(eu.notModified).toBe(true);
  });

  it('UK: the first run back-fills 30 days from designation dates', async () => {
    const filler = Array.from({ length: 1000 }, (_, i) => `<Designation><DateDesignated>01/01/2020</DateDesignated><UniqueID>F${i}</UniqueID><Names><Name><Name6>F${i}</Name6><NameType>Primary Name</NameType></Name></Names><RegimeName>The Cyber (Sanctions) (EU Exit) Regulations 2020</RegimeName><IndividualEntityShip>Entity</IndividualEntityShip></Designation>`).join('');
    const r = await run(ukSanctions, ukXml.replace('</Designations>', `${filler}</Designations>`), null);
    const russia = r.events.find((e) => e.countryCodes[0] === 'RU' && e.metadata?.designatedOn === '2026-11-12')!;
    expect(russia.title).toBe('UK sanctions: 20 new designations targeting Russia — 11 vessels, 9 entities (2026-11-12)');
    expect(russia.regionIds).toEqual(['eastern-europe']);
    expect(stateVessels(r.state).filter((v) => v.list === 'uk').length).toBeGreaterThanOrEqual(11);
  });
});

describe('sanctions indicators', () => {
  it('are valid, cover the foreign watch regions, and a large package triggers', () => {
    const defs = INDICATOR_CATALOG.filter((d) => /\.sanctions-/.test(d.id));
    expect(validateCatalog(defs)).toEqual([]);
    expect(defs.length).toBe(12);
    expect(defs.some((d) => d.regionId === 'united-states')).toBe(false);
    const many = Array.from({ length: 30 }, (_, i): Designee => ({ id: `r${i}`, name: `R${i}`, kind: 'entity', programs: ['RUSSIA-EO14024'], countries: [], designatedOn: null, imo: null, mmsi: null }));
    const events = sanctionsEvents('ofac', '2026-11-20', many, new Date(NOW).toISOString());
    const iso = (t: number) => new Date(t).toISOString();
    const status = ['ofac-sdn', 'uk-sanctions'].map((sourceId) => ({ sourceId, health: 'ONLINE' as const, lastAttemptAt: iso(NOW), lastSuccessAt: iso(NOW), firstSuccessAt: iso(NOW - 864e5), lastNewItemAt: iso(NOW), consecutiveFailures: 0, parseErrors: 0, lastError: null }));
    expect(evaluateIndicator(defs.find((d) => d.id === 'eastern-europe.sanctions-package')!, events, status, NOW).state).toBe('TRIGGERED');
    expect(evaluateIndicator(defs.find((d) => d.id === 'eastern-europe.sanctions-activity')!, events, status, NOW).state).toBe('NORMAL'); // one batch
  });
});
