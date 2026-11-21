// @vitest-environment node
/**
 * IMF PortWatch chokepoint transits. Fixtures are real responses captured on 2026-11-21:
 * daily counts Jul 1 – Nov 15 2026, the 2025 averages, and the chokepoint points.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { FetchResult } from '../lib/http.ts';
import { PORTWATCH_DAILY, PORTWATCH_POINTS, PORTWATCH_SOURCE_ID, chokepointEvents, isoWeek, portwatchChokepoints } from '../adapters/portwatch.ts';
import { assessChokepoint, type DailyTransit } from '../../shared/domain/chokepoints.ts';
import { validateEvent } from '../lib/validate.ts';
import { INDICATOR_CATALOG, validateCatalog } from '../../shared/domain/indicators/catalog.ts';
import { evaluateIndicator } from '../../shared/domain/indicators/evaluate.ts';
import { getSource } from '../../shared/domain/sources.ts';

const NOW = Date.parse('2026-11-21T09:00:00Z');
const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const ok = (b: string): FetchResult => ({ kind: 'ok', status: 200, body: b, bytes: b.length, validators: {} });
const fetchFixtures = vi.fn(async (url: string) => {
  if (url.startsWith(PORTWATCH_POINTS)) return ok(fx('portwatch-points.sample.json'));
  if (url.startsWith(PORTWATCH_DAILY) && url.includes('outStatistics')) return ok(fx('portwatch-ref2025.sample.json'));
  if (url.startsWith(PORTWATCH_DAILY)) return ok(fx('portwatch-daily.sample.json'));
  throw new Error(`unexpected ${url}`);
});
const days = (values: number[], start = '2026-10-01'): DailyTransit[] =>
  values.map((v, i) => [new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10), v, 0]);

describe('chokepoint status', () => {
  it('compares the last 7 days with the 2025 average and with the previous 4 weeks', () => {
    expect(assessChokepoint(days(Array(35).fill(80)), { total: 85 }).status).toBe('normal');
    expect(assessChokepoint(days(Array(35).fill(50)), { total: 85 }).status).toBe('reduced');
    expect(assessChokepoint(days(Array(35).fill(3)), { total: 85 }).status).toBe('severe');
    expect(assessChokepoint(days([...Array(28).fill(90), ...Array(7).fill(52)]), { total: 85 }).status).toBe('sudden-drop');
    expect(assessChokepoint(days(Array(5).fill(80)), { total: 85 }).status).toBe('insufficient-data');
    expect(assessChokepoint(days(Array(35).fill(80)), null).status).toBe('insufficient-data');
  });

  it('labels ISO weeks', () => {
    expect(isoWeek('2026-11-15')).toBe('2026-W46');
    expect(isoWeek('2026-01-01')).toBe('2026-W01');
    expect(isoWeek('2027-01-01')).toBe('2026-W53');
  });
});

describe('PortWatch adapter (real responses)', () => {
  it('reads six chokepoints and flags Hormuz (severe) and the Bosporus (reduced)', async () => {
    fetchFixtures.mockClear();
    const r = await portwatchChokepoints.collect({ now: NOW, state: null, fetch: fetchFixtures });
    expect(fetchFixtures).toHaveBeenCalledTimes(3);
    const latest = r.state.latest!;
    expect(latest.latestDate).toBe('2026-11-15');
    expect(latest.items.map((i) => i.id).sort()).toEqual(['bab-el-mandeb', 'bosporus', 'hormuz', 'malacca', 'suez', 'taiwan-strait']);
    const by = Object.fromEntries(latest.items.map((i) => [i.id, i]));
    expect(by.hormuz.status).toBe('severe');
    expect(by.hormuz.ref2025!.total).toBeCloseTo(85.5, 1);
    expect(by.hormuz.lat).toBeCloseTo(26.297, 2);
    expect(by.bosporus.status).toBe('reduced');
    expect(by['taiwan-strait'].status).toBe('normal');
    expect(r.events.map((e) => e.metadata?.chokepoint).sort()).toEqual(['bosporus', 'hormuz']);
    const h = r.events.find((e) => e.metadata?.chokepoint === 'hormuz')!;
    expect(validateEvent(h, NOW)).toBeNull();
    expect(h.title).toMatch(/^Strait of Hormuz \(MIDEAST\): ship transits severely reduced — \d+\.\d a day \(7 days to 2026-11-15\) vs 85\.5 in 2025 \(−9\d%\)$/);
    expect(h.summary).toMatch(/Source: International Monetary Fund, PortWatch/);
    expect(h).toMatchObject({ regionIds: ['middle-east'], category: 'maritime', locationPrecision: 'exact' });
  });

  it('queries at most once a day, and the same week does not repeat a record', async () => {
    const first = await portwatchChokepoints.collect({ now: NOW, state: null, fetch: fetchFixtures });
    fetchFixtures.mockClear();
    const soon = await portwatchChokepoints.collect({ now: NOW + 6 * 3_600_000, state: first.state, fetch: fetchFixtures });
    expect(fetchFixtures).not.toHaveBeenCalled();
    expect(soon.notModified).toBe(true);
    const next = await portwatchChokepoints.collect({ now: NOW + 24 * 3_600_000, state: first.state, fetch: fetchFixtures });
    expect(fetchFixtures).toHaveBeenCalledTimes(1); // daily counts only; references are monthly
    expect(next.events.map((e) => e.id).sort()).toEqual(first.events.map((e) => e.id).sort()); // same ids → de-duplicated
  });

  it('records a return to normal once', () => {
    const item = { id: 'bosporus', name: 'Bosporus', regionId: 'eastern-europe', lat: 41, lon: 29, ref2025: { total: 92, tanker: 24 }, series: days(Array(35).fill(90)), ...assessChokepoint(days(Array(35).fill(90)), { total: 92 }) };
    const [e] = chokepointEvents([item], { bosporus: 'reduced' }, new Date(NOW).toISOString());
    expect(e.metadata).toMatchObject({ status: 'normal', change: 'recovered' });
    expect(chokepointEvents([item], { bosporus: 'normal' }, new Date(NOW).toISOString())).toEqual([]);
  });

  it('puts the readings in the dashboard snapshot, and the terms decision is recorded', async () => {
    const { runCollection } = await import('../pipeline.ts');
    const { MemoryStore } = await import('../store/memory.ts');
    const adapter = { ...portwatchChokepoints, collect: (ctx: Parameters<typeof portwatchChokepoints.collect>[0]) => portwatchChokepoints.collect({ ...ctx, fetch: fetchFixtures }) };
    const { snapshot } = await runCollection([adapter as never], new MemoryStore(), { trigger: 'manual', now: () => NOW });
    expect(snapshot.chokepoints?.items.length).toBe(6);
    expect(getSource(PORTWATCH_SOURCE_ID)!.termsNotes).toMatch(/owner chose/);
  });
});

describe('chokepoint indicators', () => {
  it('are valid, and Hormuz triggers the Middle East severe indicator', async () => {
    const defs = INDICATOR_CATALOG.filter((d) => d.requiredSourceIds.includes(PORTWATCH_SOURCE_ID));
    expect(validateCatalog(defs)).toEqual([]);
    expect(defs.length).toBe(8);
    const r = await portwatchChokepoints.collect({ now: NOW, state: null, fetch: fetchFixtures });
    const iso = (t: number) => new Date(t).toISOString();
    const status = [{ sourceId: PORTWATCH_SOURCE_ID, health: 'ONLINE' as const, lastAttemptAt: iso(NOW), lastSuccessAt: iso(NOW), firstSuccessAt: iso(NOW - 864e5), lastNewItemAt: iso(NOW), consecutiveFailures: 0, parseErrors: 0, lastError: null }];
    const get = (id: string) => evaluateIndicator(defs.find((d) => d.id === id)!, r.events, status, NOW).state;
    expect(get('middle-east.chokepoint-severe')).toBe('TRIGGERED');
    expect(get('middle-east.chokepoint-reduced')).toBe('ELEVATED');
    expect(get('eastern-europe.chokepoint-reduced')).toBe('ELEVATED');
    expect(get('eastern-europe.chokepoint-severe')).toBe('NORMAL');
    expect(get('taiwan-strait.chokepoint-severe')).toBe('NORMAL');
  });
});
