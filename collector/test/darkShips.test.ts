// @vitest-environment node
/** v0.77.0: ships going dark (Fintraffic feed). Ships, positions and MMSIs are invented. */
import { describe, expect, it } from 'vitest';
import { detectDark, project, DARK, type DarkEntry, type FinEntry, type FixNow } from '../../shared/domain/darkShips.ts';
import { darkEvents } from '../adapters/aisTraffic.ts';
import { validateEvent } from '../lib/validate.ts';

const T0 = Math.floor(Date.parse('2026-11-24T10:00:00Z') / 60_000);
const TANKER = '273000001';
const identity = (m: string) => (m.startsWith('273') ? { kind: 'tanker' as const, name: `TEST ${m.slice(-2)}`, imo: m === TANKER ? '9000001' : null } : null);
const notListed = () => false;

/** Other ships (not tankers or cargo) spread around the target's track, so receivers are clearly working there. */
function others(at: number, near: [number, number][]): [string, FixNow][] {
  return near.flatMap(([la, lo], i) =>
    [0, 1, 2, 3].map((j) => [`230${String(i * 10 + j).padStart(6, '0')}`, { la: la + j * 0.02, lo: lo + j * 0.02, sog: 10, cog: 0, nav: 0, at }] as [string, FixNow]),
  );
}

function run(prev: { fin: Record<string, FinEntry>; dark: Record<string, DarkEntry> }, now: number, tanker: FixNow | null, near: [number, number][], opts: { ports?: { la: number; lo: number }[] } = {}) {
  const all = new Map<string, FixNow>(others(now, near));
  if (tanker) all.set(TANKER, tanker);
  return detectDark(prev, all, identity, notListed, opts.ports ?? [], now);
}

const track = (at: number, lo: number, extra: Partial<FixNow> = {}): FixNow => ({ la: 59.8, lo, sog: 12, cog: 90, nav: 0, at, ...extra });
const ALONG: [number, number][] = [[59.8, 25.0], [59.8, 25.5], [59.8, 26.0]];

/** Three runs of steady contact, eastbound at 12 kn, then silence. */
function steady(extra: Partial<FixNow> = {}) {
  let s = { fin: {} as Record<string, FinEntry>, dark: {} as Record<string, DarkEntry> };
  for (let i = 0; i < 3; i++) s = run(s, T0 + i * 30, track(T0 + i * 30, 24.6 + i * 0.1, extra), ALONG);
  return s;
}

describe('ships going dark', () => {
  it('flags a tanker that stops broadcasting at sea while other ships around it are still heard', () => {
    const s = steady();
    expect(s.fin[TANKER].streak).toBe(3);
    // 30 minutes later: not yet long enough.
    const early = run(s, T0 + 90, null, ALONG);
    expect(early.flags).toEqual([]);
    // 90 minutes after the last fix: dark.
    const r = run(early, T0 + 60 + 90, null, ALONG);
    expect(r.flags).toHaveLength(1);
    const f = r.flags[0];
    expect(f.type).toBe('dark');
    if (f.type === 'dark') {
      expect(f.silentMin).toBe(90);
      expect(f.ship).toMatchObject({ mmsi: TANKER, kind: 'tanker', imo: '9000001', sog: 12 });
      expect(f.projected[1]).toBeGreaterThan(24.8);
    }
    expect(r.dark[TANKER]).toBeDefined();
    const [ev] = darkEvents(r.flags, new Date((T0 + 150) * 60_000).toISOString());
    expect(ev.title).toBe('Ship went dark: Tanker TEST 01 (IMO 9000001) stopped broadcasting AIS at sea while under way (12 kn)');
    expect(ev.metadata).toMatchObject({ subtype: 'ship-dark', silentMin: 90 });
    expect(validateEvent(ev, (T0 + 150) * 60_000)).toBeNull();

    // Heard again two hours later, 40 km on: a second record.
    const back = run(r, T0 + 270, track(T0 + 270, 25.4), ALONG);
    expect(back.flags[0]).toMatchObject({ type: 'back', gapMin: 210 });
    expect(back.dark[TANKER]).toBeUndefined();
    const [bev] = darkEvents(back.flags, new Date((T0 + 270) * 60_000).toISOString());
    expect(bev.title).toMatch(/^Ship back on AIS: Tanker TEST 01 \(IMO 9000001\) after 3\.5 h dark, \d+ km from where it went quiet$/);
  });

  it('does not flag ships that were anchored, slow, near a port, briefly seen, or leaving coverage', () => {
    const later = (s: ReturnType<typeof steady>, near = ALONG, ports?: { la: number; lo: number }[]) => run(run(s, T0 + 90, null, near, { ports }), T0 + 150, null, near, { ports }).flags;
    expect(later(steady({ nav: 1 }))).toEqual([]); // at anchor
    expect(later(steady({ sog: 0.5 }))).toEqual([]); // drifting
    expect(later(steady(), ALONG, [{ la: 59.8, lo: 24.85 }])).toEqual([]); // near a port
    // Only two runs of contact.
    let s = { fin: {} as Record<string, FinEntry>, dark: {} as Record<string, DarkEntry> };
    for (let i = 0; i < 2; i++) s = run(s, T0 + i * 30, track(T0 + i * 30, 24.6 + i * 0.1), ALONG);
    expect(run(s, T0 + 120, null, ALONG).flags).toEqual([]);
    // Nobody heard where it would be by now: it sailed out of range.
    expect(later(steady(), [[59.8, 24.8]])).toEqual([]);
    expect(DARK.minStreak).toBe(3);
  });

  it('projects a position along the course', () => {
    const [la, lo] = project(60, 25, 90, 55.6);
    expect(la).toBeCloseTo(60, 1);
    expect(lo).toBeCloseTo(26, 1);
  });
});
