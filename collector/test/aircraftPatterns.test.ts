// @vitest-environment node
/** Unusual aircraft movement (v0.63.0). Synthetic aircraft; positions over Iraq (Middle East watch area). */
import { describe, expect, it } from 'vitest';
import type { AircraftPosition, AircraftSnapshot } from '../../shared/domain/aircraft.ts';
import { detectPatterns, distanceKm, emptyMemory, findHold, packTrack, unpackTrack, type PatternMemory } from '../adapters/aircraftPatterns.ts';
import { validateEvent } from '../lib/validate.ts';
import { INDICATOR_CATALOG } from '../../shared/domain/indicators/catalog.ts';
import { evaluateIndicator } from '../../shared/domain/indicators/evaluate.ts';

const DAY = 86_400_000;
const T = Date.parse('2026-12-20T10:00:00Z');
const ac = (p: Partial<AircraftPosition> = {}): AircraftPosition => ({
  hex: 'ae0001', cs: 'TEST01', reg: null, t: 'K35R', cls: 'tanker', la: 33, lo: 44, alt: 30_000, gs: 420, trk: 90, age: 1, em: null, ...p,
});
const snap = (aircraft: AircraftPosition[], at: number): AircraftSnapshot => ({ fetchedAt: new Date(at).toISOString(), provider: 'adsb.lol', totalMarked: aircraft.length, aircraft });
/** Memory that started `days` ago and has seen nothing. */
const oldMemory = (days: number, at = T): PatternMemory => emptyMemory(new Date(at - days * DAY).toISOString());

/** Runs the detector over successive 30-minute snapshots, returning all records and the final memory. */
function runs(positions: AircraftPosition[][], start: number, mem: PatternMemory | null) {
  let m = mem;
  const all = [];
  for (let i = 0; i < positions.length; i++) {
    const r = detectPatterns(snap(positions[i], start + i * 30 * 60_000), start + i * 30 * 60_000, m);
    all.push(...r.events);
    m = r.memory;
  }
  return { events: all, memory: m! };
}

/** A tanker circling 20 km around (33, 44). */
const orbit = (n: number, p: Partial<AircraftPosition> = {}) =>
  Array.from({ length: n }, (_, i) => [ac({ la: 33 + 0.18 * Math.sin(i), lo: 44 + 0.2 * Math.cos(i), ...p })]);

describe('findHold', () => {
  it('needs three positions spanning about an hour, close together, at altitude', () => {
    expect(findHold([[0, 33, 44, 30000], [30, 33.1, 44.1, 30000]])).toBeNull();
    expect(findHold([[0, 33, 44, 30000], [30, 33.1, 44.1, 30000], [60, 33, 44.2, 30000]])).toMatchObject({ minutes: 60 });
    // Passing through: 3 positions 200+ km apart.
    expect(findHold([[0, 33, 40, 30000], [30, 33, 42, 30000], [60, 33, 44, 30000]])).toBeNull();
    // Low: circuits near an airfield are not holds.
    expect(findHold([[0, 33, 44, 2000], [30, 33.1, 44.1, 2500], [60, 33, 44.2, 2000]])).toBeNull();
  });

  it('finds the hold at the end of a track that arrived from far away', () => {
    expect(findHold([[0, 33, 38, 30000], [30, 33, 44, 30000], [60, 33.1, 44.1, 30000], [90, 33, 44.2, 30000]])).toMatchObject({ minutes: 60 });
  });

  it('packs tracks as text (Firestore cannot store nested arrays) and reads them back', () => {
    const pts: [number, number, number, number | null][] = [[100, 33.1234, -44.5, 30000], [130, 33.2, -44.6, null]];
    expect(packTrack(pts)).toBe('100,33.1234,-44.5,30000;130,33.2,-44.6,');
    expect(unpackTrack(packTrack(pts))).toEqual(pts);
    expect(unpackTrack('junk;1,2,3,')).toEqual([[1, 2, 3, null]]);
  });

  it('keeps memory free of nested arrays', () => {
    const { memory } = runs(orbit(3), T, null);
    const nested = (v: unknown): boolean => (Array.isArray(v) ? v.some((x) => Array.isArray(x) || nested(x)) : v !== null && typeof v === 'object' ? Object.values(v).some(nested) : false);
    expect(nested(memory)).toBe(false);
  });

  it('measures distance in km', () => {
    expect(Math.round(distanceKm(0, 0, 0, 1))).toBe(111);
  });
});

describe('detectPatterns', () => {
  it('flags nothing while learning, but remembers', () => {
    const r = runs(orbit(4), T, null);
    expect(r.events).toHaveLength(0);
    expect(r.memory.holds['tanker|33|44']).toBeDefined();
    expect(r.memory.types['middle-east|K35R']).toBeDefined();
  });

  it('flags a new hold and a new type once learning is over, as valid records', () => {
    const r = runs(orbit(4), T, oldMemory(20));
    const hold = r.events.filter((e) => e.metadata?.pattern === 'hold');
    const first = r.events.filter((e) => e.metadata?.pattern === 'first-appearance');
    // Same hold on later runs keeps the same id (stored once).
    expect(new Set(hold.map((e) => e.id)).size).toBe(1);
    expect(new Set(first.map((e) => e.id)).size).toBe(1);
    expect(hold[0].title).toMatch(/KC-135R\/T Stratotanker TEST01 holding about 1 h — .* no tanker hold there in 20 days/);
    expect(first[0].title).toMatch(/^First KC-135R\/T Stratotanker in the .* watch area in 20 days/);
    for (const e of [hold[0], first[0]]) {
      expect(validateEvent(e, T + 2 * 3_600_000)).toBeNull();
      expect(e.regionIds).toEqual(['middle-east']);
      expect(e.metadata).not.toHaveProperty('aircraftClass');
      expect(e.summary).toMatch(/not by itself evidence/);
    }
  });

  it('does not flag a hold or type seen there within 30 days', () => {
    const mem = oldMemory(40);
    mem.holds['tanker|33|44'] = { last: '2026-12-01' };
    mem.types['middle-east|K35R'] = { last: '2026-12-01' };
    expect(runs(orbit(4), T, mem).events).toHaveLength(0);
    // Last seen 31+ days ago: new again.
    mem.holds['tanker|33|44'] = { last: '2026-11-10' };
    mem.types['middle-east|K35R'] = { last: '2026-11-10' };
    const again = [...new Map(runs(orbit(4), T, mem).events.map((e) => [e.id, e])).values()];
    expect(again.map((e) => e.metadata?.pattern).sort()).toEqual(['first-appearance', 'hold']);
    expect(again.find((e) => e.metadata?.pattern === 'hold')!.metadata?.lastHeldBefore).toBe('2026-11-10');
  });

  it('ignores routine classes for holds and aircraft outside the watch areas', () => {
    const mem = oldMemory(20);
    mem.types['middle-east|C17'] = { last: '2026-12-19' };
    expect(runs(orbit(4, { t: 'C17', cls: 'airlift' }), T, mem).events).toHaveLength(0);
    expect(runs(orbit(4, { la: 47, lo: 2 }), T, oldMemory(20)).events).toHaveLength(0); // France
  });

  it('forgets an aircraft after an hour unseen and drops old memory', () => {
    const r1 = runs(orbit(1), T, oldMemory(20));
    expect(Object.keys(r1.memory.tracks)).toEqual(['ae0001']);
    r1.memory.types['x|Y'] = { last: '2026-10-01' };
    const r2 = detectPatterns(snap([], T + 2 * 3_600_000), T + 2 * 3_600_000, r1.memory);
    expect(r2.memory.tracks).toEqual({});
    expect(r2.memory.types['x|Y']).toBeUndefined();
  });

  it('feeds the experimental region indicator, not the volume indicators', () => {
    const events = runs(orbit(4), T, oldMemory(20)).events;
    const unique = [...new Map(events.map((e) => [e.id, e])).values()];
    const def = (id: string) => INDICATOR_CATALOG.find((d) => d.id === id)!;
    const at = T + 2 * 3_600_000;
    const iso = (t: number) => new Date(t).toISOString();
    const status = [{ sourceId: 'adsb-military', health: 'ONLINE' as const, lastAttemptAt: iso(at), lastSuccessAt: iso(at), firstSuccessAt: iso(at - 20 * DAY), lastNewItemAt: iso(at), consecutiveFailures: 0, parseErrors: 0, lastError: null }];
    expect(def('middle-east.air-patterns')).toMatchObject({ experimental: true, weight: 0 });
    expect(evaluateIndicator(def('middle-east.air-patterns'), unique, status, at).matchedCount).toBe(2);
    expect(evaluateIndicator(def('middle-east.air-patterns'), unique, status, at).state).toBe('ELEVATED');
    expect(evaluateIndicator(def('middle-east.strategic-air'), unique, status, at).matchedCount).toBe(0);
  });
});
