import { describe, expect, it } from 'vitest';
import type { UnderseaLine } from '@shared/domain/undersea';
import { buildSearchIndex, searchMap } from './mapSearch';
import { decodeMapLink } from './mapLink';

/** v0.71.0: undersea lines and disputed areas in map search and links. Data is invented. */
const line: UnderseaLine = { id: 'osm:way/1', k: 'telecom', n: 'Test Cable', op: 'Test Operator', kv: null, sub: null, g: [[[20, 59], [22, 59]]] };

describe('search and links', () => {
  it('finds named undersea lines and disputed areas, and links can select them', () => {
    const index = buildSearchIndex({
      undersea: [line, { ...line, id: 'osm:way/2', n: null }],
      disputed: [{ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [[[[10, 10], [12, 10], [12, 12], [10, 10]]]] }, properties: { id: 'ne:1', name: 'Test Zone', note: 'Admin. by A; Claimed by B', kind: 'Disputed', sovereign: 'A' } }],
    });
    expect(searchMap(index, 'test cable')[0]).toMatchObject({ kind: 'cable', select: { kind: 'cable', key: 'osm:way/1' }, lat: 59, lon: 22 });
    expect(searchMap(index, 'claimed by b')[0]).toMatchObject({ kind: 'area', select: { kind: 'area', key: 'ne:1' } });
    expect(searchMap(index, 'unnamed')).toEqual([]);
    expect(decodeMapLink('?layers=ud&sel=cable:osm:way/1')).toMatchObject({ settings: { undersea: true, disputed: true, aircraft: false }, selection: { kind: 'cable', key: 'osm:way/1' } });
  });
});
