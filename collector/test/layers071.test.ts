// @vitest-environment node
/** v0.71.0 map layers: undersea lines near a point, embassy and nuclear-facility rules, search. Sites and lines are invented. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { nearbyLines, underseaName, type UnderseaLine } from '../../shared/domain/undersea.ts';
import { computeInfrastructure, sitePatterns } from '../../shared/domain/infraProximity.ts';
import type { InfraSite } from '../../shared/domain/infrastructure.ts';
import type { IntelligenceEvent } from '../../shared/domain/types.ts';

const line: UnderseaLine = { id: 'osm:way/1', k: 'telecom', n: 'Test Cable', op: 'Test Operator', kv: null, sub: null, g: [[[20, 59], [22, 59]]] };

describe('undersea lines', () => {
  it('measures the distance from a point to the nearest part of a line', () => {
    // 0.1° of latitude north of a line along 59°N is about 11 km.
    expect(nearbyLines([line], 59.1, 21, 20)).toEqual([{ line, km: 11.1 }]);
    expect(nearbyLines([line], 59.3, 21, 20)).toEqual([]);
    // Past the end of the line, the distance is to the end point.
    expect(nearbyLines([line], 59, 22.2, 20)[0].km).toBeCloseTo(11.5, 0);
    expect(underseaName({ ...line, n: null })).toBe('Unnamed telecom cable');
  });
});

describe('embassies and nuclear facilities', () => {
  const T = Date.parse('2026-11-23T12:00:00Z');
  const sites: InfraSite[] = [
    { id: 'wd:Q1', n: ['Embassy of Testland, Testcity'], t: 'embassy', la: 50, lo: 30, c: 'UA', s: ['wikidata'] },
    { id: 'wd:Q2', n: ['Testa Nuclear Facility'], t: 'nuclear-site', la: 33, lo: 51, c: 'IR', s: ['wikidata'] },
  ];
  const ev = (id: string, lat: number, lon: number, title = 'Strike reported'): IntelligenceEvent => ({
    id, contentHash: id, dataOrigin: 'live', sourceId: 'nasa-firms', sourceName: 'FIRMS', sourceClass: 'scientific', sourceUrl: `https://example.test/${id}`, title,
    category: 'military', regionIds: [], countryCodes: [], publishedAt: new Date(T - 3_600_000).toISOString(), occurredAt: null, collectedAt: new Date(T - 3_600_000).toISOString(),
    credibility: 'single-source', verificationStatus: 'unreviewed', locationPrecision: 'exact', latitude: lat, longitude: lon,
  });

  it('flags an embassy only for exactly located records within 1 km, and never by name', () => {
    expect(sitePatterns(sites[0])).toEqual([]);
    const near = computeInfrastructure(sites, [ev('a', 50.005, 30)], T);
    expect(near.flagged.map((f) => f.id)).toEqual(['wd:Q1']);
    expect(computeInfrastructure(sites, [ev('b', 50.02, 30)], T).flagged).toEqual([]);
    const cityLevel = { ...ev('c', 50, 30), locationPrecision: 'city' as const };
    expect(computeInfrastructure(sites, [cityLevel], T).flagged).toEqual([]);
  });

  it('names a nuclear facility with its type, and uses the wider nuclear ring', () => {
    expect(sitePatterns(sites[1]).some((p) => p.test('Strikes reported near the Testa enrichment facility'))).toBe(true);
    expect(sitePatterns(sites[1]).some((p) => p.test('Fighting in Testa'))).toBe(false);
    const f = computeInfrastructure(sites, [ev('d', 33.07, 51)], T).flagged;
    expect(f.map((x) => x.id)).toEqual(['wd:Q2']);
  });
});

describe('built data files', () => {
  const read = (f: string) => JSON.parse(readFileSync(new URL(`../../public/data/${f}`, import.meta.url), 'utf8'));
  it('undersea: known Baltic cables and pipelines, with the OpenStreetMap licence', () => {
    const d = read('undersea.json');
    const names = d.lines.map((l: UnderseaLine) => l.n);
    for (const n of ['C-Lion 1', 'BCS East-West Interlink', 'Baltic Connector', 'Nord Stream', 'TurkStream']) expect(names, n).toContain(n);
    expect(d.lines.find((l: UnderseaLine) => l.n === 'HVDC Estlink 2')?.k).toBe('power');
    expect(d.source.licence).toMatch(/ODbL/);
  });
  it('sites: nuclear facilities and embassies added without losing the older types', () => {
    const d = read('infrastructure.json');
    const by = (t: string) => d.sites.filter((s: InfraSite) => s.t === t);
    expect(by('nuclear-site').find((s: InfraSite) => s.n[0].startsWith('Natanz'))?.c).toBe('IR');
    expect(by('nuclear-site').some((s: InfraSite) => s.n[0].startsWith('Yongbyon'))).toBe(true);
    expect(by('embassy').length).toBeGreaterThan(50);
    for (const t of ['nuclear', 'power', 'refinery', 'dam', 'port']) expect(by(t).length, t).toBeGreaterThan(30);
  });
  it('disputed: the Korean DMZ and Golan Heights with their notes, public domain', () => {
    const d = read('disputed.json');
    const names = d.features.map((f: { properties: { name: string } }) => f.properties.name);
    expect(names).toContain('Korean Demilitarized Zone (north)');
    expect(d.features.find((f: { properties: { name: string } }) => f.properties.name === 'Golan Heights').properties.note).toMatch(/Israel/);
    expect(d.source.licence).toMatch(/Public domain/);
  });
});
