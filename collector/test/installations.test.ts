// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { COMPONENTS, STATUS_LABEL, distanceKm, dodRef, installationAliases, operationOf, relatedRecords, worldRef, type InstallationDataset, type WorldDataset } from '../../shared/domain/installations.ts';
import { isCrimea } from '../geo/countries.ts';

const data = JSON.parse(readFileSync(new URL('../../public/data/installations-us.json', import.meta.url), 'utf8')) as InstallationDataset;
const find = (name: string) => dodRef(data.installations.find((i) => i.name === name)!);

describe('installations dataset (DoD MIRTA points)', () => {
  it('records its source and licence, and every point is plausible', () => {
    expect(data.source).toMatch(/MIRTA/);
    expect(data.licence).toMatch(/CC BY 4\.0/);
    expect(data.count).toBe(data.installations.length);
    expect(data.count).toBeGreaterThan(800);
    for (const i of data.installations) {
      // US states and territories span roughly 13°S (American Samoa) to 72°N and 180°W to 145°E (Guam).
      expect(i.lat).toBeGreaterThan(-15);
      expect(i.lat).toBeLessThan(72);
      expect(i.lon > -180 && (i.lon < -64 || i.lon > 144)).toBe(true);
      expect(COMPONENTS[i.component]).toBeDefined();
      expect(STATUS_LABEL[i.status]).toBeDefined();
    }
    expect(new Set(data.installations.map((i) => i.name)).size).toBe(data.count);
  });

  it('contains well-known installations', () => {
    for (const n of ['Fort Bragg', 'Pentagon', 'Naval Station Norfolk', 'Beale Air Force Base', 'Marine Corps Base Camp Lejeune']) expect(find(n)).toBeDefined();
  });
});

describe('installation aliases', () => {
  it('adds a short name and former/current names, never a generic one', () => {
    expect(installationAliases('Beale Air Force Base')).toContain('Beale');
    expect(installationAliases('Fort Bragg')).toContain('Fort Liberty');
    expect(installationAliases('Marine Corps Base Camp Lejeune')).toContain('Camp Lejeune');
    expect(installationAliases('Army Research Office')).toEqual(['Army Research Office']);
    expect(installationAliases('1LT John A Fera USARC')).toEqual(['1LT John A Fera USARC']);
  });
});

describe('related records', () => {
  const ev = (p: Partial<IntelligenceEvent> & { title: string }): IntelligenceEvent => ({
    id: p.title, contentHash: p.title, dataOrigin: 'live', sourceId: 'military-times', sourceName: 'Military Times — Military Times', sourceClass: 'media',
    sourceUrl: 'https://example.org/', category: 'military', regionIds: ['united-states'], countryCodes: ['US'], publishedAt: '2026-11-20T10:00:00Z',
    occurredAt: null, collectedAt: '2026-11-20T10:00:00Z', credibility: 'single-source', verificationStatus: 'unreviewed', locationPrecision: 'country', ...p,
  });

  it('matches by name (including FAA wording) or by exact location within 50 km, and says why', () => {
    const beale = find('Beale Air Force Base');
    const rows = relatedRecords(beale, [
      ev({ title: 'FAA Security (national defence airspace) flight restriction — Beale AFB, CA', sourceId: 'faa-tfr' }),
      ev({ title: 'Earthquake M4.6 — near Marysville', locationPrecision: 'exact', latitude: beale.lat + 0.1, longitude: beale.lon, sourceId: 'usgs-earthquakes' }),
      ev({ title: 'Earthquake far away', locationPrecision: 'exact', latitude: 0, longitude: 0 }),
      ev({ title: 'Grand Forks AFB drone sightings' }),
    ]);
    expect(rows.map((r) => r.reason)).toEqual(['names "Beale"', '11 km away']);
  });

  it('does not match common words, or short names in records about other countries', () => {
    expect(installationAliases('Clear Space Force Station')).not.toContain('Clear');
    expect(relatedRecords(find('Clear Space Force Station'), [ev({ title: 'It is not clear when troops will leave' })])).toEqual([]);
    const norfolk = find('Naval Station Norfolk');
    // "Norfolk" is also an English county: a UK-tagged record must not match the short name.
    expect(relatedRecords(norfolk, [ev({ title: 'Floods hit Norfolk villages', regionIds: [], countryCodes: ['GB'] })])).toEqual([]);
    expect(relatedRecords(norfolk, [ev({ title: 'FAA Security flight restriction — NORFOLK, VA', sourceId: 'faa-tfr' })])[0].reason).toBe('names "Norfolk"');
    // Lower-case one-word short names never match.
    expect(relatedRecords(find('Beale Air Force Base'), [ev({ title: 'beale street festival' })])).toEqual([]);
  });

  it('finds the renamed name in headlines', () => {
    expect(relatedRecords(find('Fort Bragg'), [ev({ title: 'Shooting reported at Fort Liberty' })])[0].reason).toBe('names "Fort Liberty"');
  });

  it('computes great-circle distance', () => {
    expect(Math.round(distanceKm(38.8719, -77.0563, 36.9463, -76.3135))).toBe(224); // Pentagon → Norfolk: 223.8 km (independent haversine)
  });
});

describe('worldwide installations (Wikidata)', () => {
  const world = JSON.parse(readFileSync(new URL('../../public/data/installations-world.json', import.meta.url), 'utf8')) as WorldDataset;
  const w = (name: string) => world.installations.find((i) => i.n === name)!;

  it('records source and licence, excludes the US, and every point is valid', () => {
    expect(world.licence).toMatch(/CC0/);
    expect(world.count).toBe(world.installations.length);
    expect(world.count).toBeGreaterThan(2000);
    expect(world.installations.some((i) => i.c === 'US')).toBe(false);
    for (const i of world.installations) {
      expect(Math.abs(i.la)).toBeLessThanOrEqual(90);
      expect(Math.abs(i.lo)).toBeLessThanOrEqual(180);
      expect(i.n).not.toMatch(/^Q\d+$/);
    }
    expect(new Set(world.installations.map((i) => i.q)).size).toBe(world.count);
  });

  it('classifies who operates a site relative to its host', () => {
    expect(operationOf(w('Ramstein Air Base'))).toBe('us-abroad');
    expect(operationOf(w('Kadena Air Base'))).toBe('us-abroad');
    expect(operationOf(w('Khmeimim'))).toBe('foreign');
    expect(operationOf({ q: 'x', n: 'x', la: 0, lo: 0, c: 'FR', o: ['French Air and Space Force'], oc: ['FR'], k: [], w: null })).toBe('national');
    expect(operationOf({ q: 'x', n: 'x', la: 0, lo: 0, c: '', o: [], oc: ['RU'], k: [], w: null })).toBe('national');
  });

  it('applies the Crimea rule', () => {
    const crimea = world.installations.filter((i) => isCrimea(i.la, i.lo));
    expect(crimea.length).toBeGreaterThan(0);
    expect(crimea.some((i) => i.c === 'RU')).toBe(false);
  });

  it('matches short names only in records about the host country', () => {
    const ramstein = worldRef(w('Ramstein Air Base'));
    const rec = (title: string, countryCodes: string[]) =>
      ({ id: title, contentHash: title, dataOrigin: 'live', sourceId: 'bbc-world', sourceName: 'BBC', sourceClass: 'media', sourceUrl: 'https://example.org/', title, category: 'military', regionIds: [], countryCodes, publishedAt: '2026-11-20T10:00:00Z', occurredAt: null, collectedAt: '2026-11-20T10:00:00Z', credibility: 'single-source', verificationStatus: 'unreviewed', locationPrecision: 'country' }) as IntelligenceEvent;
    expect(relatedRecords(ramstein, [rec('Protest outside Ramstein over drone strikes', ['DE'])])[0].reason).toBe('names "Ramstein"');
    expect(relatedRecords(ramstein, [rec('Ramstein band plays in Seoul', ['KR'])])).toEqual([]);
    expect(relatedRecords(ramstein, [rec('Ramstein Air Base on alert', ['KR'])])[0].reason).toBe('names "Ramstein Air Base"');
  });
});
