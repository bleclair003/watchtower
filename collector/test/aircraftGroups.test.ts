// @vitest-environment node
/** Grouping and odd hours (v0.66.0). Synthetic aircraft; positions over Iraq (Middle East watch area). */
import { describe, expect, it } from 'vitest';
import type { AircraftPosition, AircraftSnapshot } from '../../shared/domain/aircraft.ts';
import { detectPatterns, emptyMemory, findGroups, hourKey, unpackHours, type PatternMemory } from '../adapters/aircraftPatterns.ts';
import { validateEvent } from '../lib/validate.ts';
import { INDICATOR_CATALOG } from '../../shared/domain/indicators/catalog.ts';
import { evaluateIndicator } from '../../shared/domain/indicators/evaluate.ts';
import { AIRCRAFT_PATTERN_LABEL } from '../../shared/domain/aircraftPatterns.ts';

const DAY = 86_400_000;
const T = Date.parse('2026-12-20T03:10:00Z');
const ac = (hex: string, p: Partial<AircraftPosition> = {}): AircraftPosition => ({
  hex, cs: `TEST${hex.slice(-2)}`, reg: null, t: 'K35R', cls: 'tanker', la: 33, lo: 44, alt: 30_000, gs: 420, trk: 90, age: 1, em: null, ...p,
});
const snap = (aircraft: AircraftPosition[], at: number): AircraftSnapshot => ({ fetchedAt: new Date(at).toISOString(), provider: 'adsb.lol', totalMarked: aircraft.length, aircraft });
const oldMemory = (days: number): PatternMemory => emptyMemory(new Date(T - days * DAY).toISOString());
/** Three strategic aircraft within ~150 km of each other over Iraq. */
const trio = () => [ac('ae0001'), ac('ae0002', { la: 33.8, lo: 44.6, t: 'E3CF', cls: 'isr' }), ac('ae0003', { la: 32.5, lo: 45.1, t: 'B52', cls: 'bomber' })];

describe('grouping', () => {
  it('clusters greedily within the radius', () => {
    const pts = [{ la: 33, lo: 44 }, { la: 33.5, lo: 44.5 }, { la: 34, lo: 45 }, { la: 50, lo: 10 }, { la: 50.1, lo: 10.1 }];
    expect(findGroups(pts).map((g) => g.length)).toEqual([3]);
    expect(findGroups(pts, 300, 2).map((g) => g.length)).toEqual([3, 2]);
  });

  it('flags three strategic aircraft together where no group has been seen, once learning is over', () => {
    const r = detectPatterns(snap(trio(), T), T, oldMemory(20));
    const g = r.events.filter((e) => e.metadata?.pattern === 'group');
    expect(g).toHaveLength(1);
    expect(g[0].title).toMatch(/^3 strategic aircraft together — MIDEAST watch area: 1 tanker, 1 .*; no such group there in 20 days$/);
    expect(g[0].metadata).toMatchObject({ groupSize: 3, cell: 'middle-east|33|42', callsign: null });
    expect(validateEvent(g[0], T + 60_000)).toBeNull();
    // Seen again the same day: same record id; on a later day within 30 days: not flagged.
    const again = detectPatterns(snap(trio(), T + 1_800_000), T + 1_800_000, r.memory);
    expect(again.events.filter((e) => e.metadata?.pattern === 'group').map((e) => e.id)).toEqual([g[0].id]);
    const later = detectPatterns(snap(trio(), T + 5 * DAY), T + 5 * DAY, again.memory);
    expect(later.events.filter((e) => e.metadata?.pattern === 'group')).toHaveLength(0);
  });

  it('does not count low, VIP or transport aircraft, or groups while group memory is learning', () => {
    const low = [ac('ae0001', { alt: 2_000 }), ...trio().slice(1)];
    expect(detectPatterns(snap(low, T), T, oldMemory(20)).events.filter((e) => e.metadata?.pattern === 'group')).toHaveLength(0);
    const vip = [ac('ae0001', { cs: 'SAM123', t: 'C32', cls: 'other' as never }), ...trio().slice(1)];
    expect(detectPatterns(snap(vip, T), T, oldMemory(20)).events.filter((e) => e.metadata?.pattern === 'group')).toHaveLength(0);
    // Memory from before v0.66 has no group memory: it starts learning now.
    const pre = oldMemory(20);
    delete pre.groups;
    delete pre.groupsSince;
    const r = detectPatterns(snap(trio(), T), T, pre);
    expect(r.events.filter((e) => e.metadata?.pattern === 'group')).toHaveLength(0);
    expect(r.memory.groupsSince).toBe(new Date(T).toISOString());
    expect(Object.keys(r.memory.groups!)).toEqual(['middle-east|33|42']);
  });
});

describe('odd hours', () => {
  /** Memory with this hour checked on the last `days` days, with `busy` of them having aircraft. */
  function withHistory(days: number, busy: number): PatternMemory {
    const m = oldMemory(20);
    const counts = new Map<string, number>();
    for (let d = 1; d <= days; d++) {
      counts.set(hourKey(T - d * DAY), d <= busy ? 2 : 0);
      counts.set(hourKey(T - d * DAY + 6 * 3_600_000), 4); // other hours are busy
    }
    m.hours = { 'middle-east': [...counts].map(([k, v]) => `${k}:${v}`).join(';') };
    return m;
  }
  const two = () => [ac('ae0001', { cls: 'airlift', t: 'C17' }), ac('ae0002', { la: 30, lo: 47 })];

  it('flags notable aircraft in an hour that was empty on nearly all of the last 14 days', () => {
    const r = detectPatterns(snap(two(), T), T, withHistory(14, 1));
    const o = r.events.filter((e) => e.metadata?.pattern === 'odd-hour');
    expect(o).toHaveLength(1);
    expect(o[0].title).toMatch(/^2 military aircraft at 03:00Z — MIDEAST watch area, an hour with none on 13 of the last 14 days: /);
    expect(o[0].metadata).toMatchObject({ aircraftCount: 2, hourUtc: 3, daysChecked: 14, busyDays: 1 });
    expect(validateEvent(o[0], T + 60_000)).toBeNull();
    expect(unpackHours(r.memory.hours!['middle-east']).get(hourKey(T))).toBe(2);
  });

  it('does not flag a usually busy hour, too little history, one aircraft, or aircraft on the ground', () => {
    const odd = (m: PatternMemory, list = two()) => detectPatterns(snap(list, T), T, m).events.filter((e) => e.metadata?.pattern === 'odd-hour');
    expect(odd(withHistory(14, 2))).toHaveLength(0);
    expect(odd(withHistory(11, 0))).toHaveLength(0);
    expect(odd(withHistory(14, 0), two().slice(0, 1))).toHaveLength(0);
    expect(odd(withHistory(14, 0), [ac('ae0001', { alt: null }), ac('ae0002', { alt: 500 })])).toHaveLength(0);
  });

  it('records every watch area each check, and forgets hours older than the lookback', () => {
    const m = oldMemory(20);
    m.hours = { 'middle-east': `${hourKey(T - 20 * DAY)}:3` };
    const r = detectPatterns(snap([], T), T, m);
    expect(r.memory.hours!['middle-east']).toBe(`${hourKey(T)}:0`);
    expect(Object.keys(r.memory.hours!)).toContain('korean-peninsula');
    expect(Object.keys(r.memory.hours!)).not.toContain('global-cyber');
  });
});

it('both feed the experimental region indicator and have labels', () => {
  const a = detectPatterns(snap(trio(), T), T, oldMemory(20)).events;
  const at = T + 60_000;
  const iso = (t: number) => new Date(t).toISOString();
  const status = [{ sourceId: 'adsb-military', health: 'ONLINE' as const, lastAttemptAt: iso(at), lastSuccessAt: iso(at), firstSuccessAt: iso(at - 20 * DAY), lastNewItemAt: iso(at), consecutiveFailures: 0, parseErrors: 0, lastError: null }];
  const def = INDICATOR_CATALOG.find((d) => d.id === 'middle-east.air-patterns')!;
  expect(evaluateIndicator(def, a, status, at).matchedCount).toBeGreaterThanOrEqual(1);
  expect(def.description).toMatch(/three or more strategic aircraft together/);
  expect(AIRCRAFT_PATTERN_LABEL.group).toBe('unusual grouping');
  expect(AIRCRAFT_PATTERN_LABEL['odd-hour']).toBe('unusual hour');
});
