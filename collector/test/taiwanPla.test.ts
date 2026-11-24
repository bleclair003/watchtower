import { describe, expect, it } from 'vitest';
import { assessDay, buildPlaSnapshot, parsePlaCsv, PLA_CSV_URL } from '../../shared/domain/taiwanPla.ts';
import { makeTaiwanPlaAdapter, PLA_FIRST_DAYS, PLA_RESEND_DAYS, type TaiwanPlaState } from '../adapters/taiwanPla.ts';
import { validateEvent } from '../lib/validate.ts';
import { matches } from '../../shared/domain/indicators/conditions.ts';
import { getIndicator } from '../../shared/domain/indicators/catalog.ts';
import { classifyCountry } from '../../shared/domain/countryConvergence.ts';

const NOW = Date.parse('2026-11-24T08:00:00Z');
const HEADER = 'date,aircraft_total,median_line_cross,cross_rate,aircraft_type,ships_total,activity_start,activity_end,special_event';

/** `days` invented days ending 2026-11-24: steady counts, then the given last-day values. */
function csv(days: number, last: { aircraft: number; ships: number }) {
  const rows = [HEADER];
  for (let k = days - 1; k >= 0; k--) {
    const date = new Date(Date.parse('2026-11-24T00:00:00Z') - k * 86_400_000).toISOString().slice(0, 10);
    const a = k === 0 ? last.aircraft : 4 + (k % 4);
    const s = k === 0 ? last.ships : 7 + (k % 3);
    rows.push(`${date},${a},${Math.floor(a / 2)},50.0,Mixed,${s},,,"逾越中線,進入西南空域(${Math.floor(a / 2)}架次)${k === 3 ? '；中共空飄氣球計偵獲2顆。' : ''}"`);
  }
  return rows.join('\n') + '\n';
}

describe('PLA activity around Taiwan', () => {
  it('parses quoted fields with commas, balloons, and keeps one row per date', () => {
    const days = parsePlaCsv(`﻿${csv(5, { aircraft: 9, ships: 8 })}2026-11-24,9,4,44.4,Mixed,8,,,dup`);
    expect(days).toHaveLength(5);
    expect(days[1]).toMatchObject({ balloons: 2, type: 'Mixed' });
    expect(days[1].note).toContain('逾越中線,進入西南空域');
    expect(days[4]).toMatchObject({ date: '2026-11-24', aircraft: 9, crossed: 4, ships: 8, note: 'dup' });
    expect(() => parsePlaCsv('a,b\n1,2')).toThrow(/unexpected columns/);
  });

  it('builds a baseline from the 60 days before, and tells ABOVE USUAL from SURGE', () => {
    expect(assessDay(parsePlaCsv(csv(20, { aircraft: 80, ships: 8 })), '2026-11-24')!.aircraft.status).toBe('building');
    const level = (aircraft: number, ships = 8) => assessDay(parsePlaCsv(csv(70, { aircraft, ships })), '2026-11-24')!.level;
    expect(level(6)).toBe('normal');
    expect(level(14)).toBe('above');
    expect(level(40)).toBe('surge');
    expect(level(5, 30)).toBe('surge');
    const snap = buildPlaSnapshot(parsePlaCsv(csv(120, { aircraft: 40, ships: 8 })), new Date(NOW).toISOString());
    expect(snap.days).toHaveLength(90);
    expect(snap.latest).toMatchObject({ date: '2026-11-24', aircraft: 40, level: 'surge' });
    expect(snap.yearMax).toEqual({ date: '2026-11-24', aircraft: 40 });
    expect(snap.totalDays).toBe(120);
  });

  it('sends recent days as valid records, reads at most every 2 hours, and honours 304', async () => {
    const adapter = makeTaiwanPlaAdapter();
    const body = csv(70, { aircraft: 40, ships: 8 });
    const urls: string[] = [];
    const ok = async (url: string) => {
      urls.push(url);
      return { kind: 'ok' as const, status: 200, body, validators: { etag: '"v1"' }, bytes: body.length };
    };
    const first = await adapter.collect({ now: NOW, state: null, fetch: ok });
    expect(urls).toEqual([PLA_CSV_URL]);
    expect(first.events).toHaveLength(PLA_FIRST_DAYS);
    for (const e of first.events) expect(validateEvent(e, NOW)).toBeNull();
    const today = first.events.at(-1)!;
    expect(today.title).toBe('PLA activity around Taiwan, 24 Nov: 40 aircraft (20 crossed the median line), 8 ships — SURGE');
    expect(today).toMatchObject({ regionIds: ['taiwan-strait'], countryCodes: ['TW'], locationPrecision: 'region', category: 'military' });
    expect(today.summary).toContain('Skyfaring’s PLA Tracker');
    expect(today.metadata).toMatchObject({ level: 'surge', direction: 'surge', aircraft: 40 });

    // The indicator and country convergence see the surge; an ordinary day is context.
    expect(matches(getIndicator('taiwan-strait.pla-surge')!.match, today)).toBe(true);
    expect(matches(getIndicator('taiwan-strait.pla-surge')!.match, first.events[0])).toBe(false);
    expect(classifyCountry(today)).toEqual({ type: 'pla-surge', feed: 'mnd', role: 'anomaly' });
    expect(classifyCountry(first.events[0])?.role).toBe('context');

    // Within 2 hours: no request.
    const soon = await adapter.collect({ now: NOW + 3_600_000, state: first.state, fetch: ok });
    expect(urls).toHaveLength(1);
    expect(soon).toMatchObject({ notModified: true, events: [] });

    // Later: a conditional request; 304 keeps the state.
    let sent: unknown;
    const notMod = async (_u: string, v?: unknown) => {
      sent = v;
      return { kind: 'not-modified' as const, status: 304 as const };
    };
    const later = await adapter.collect({ now: NOW + 3 * 3_600_000, state: first.state, fetch: notMod });
    expect(sent).toEqual({ etag: '"v1"' });
    expect(later.notModified).toBe(true);
    expect((later.state as TaiwanPlaState).latest).toEqual(first.state.latest);

    // A new file: recent days are re-sent so corrections rewrite stored records.
    const next = await adapter.collect({ now: NOW + 6 * 3_600_000, state: later.state, fetch: ok });
    expect(next.events).toHaveLength(PLA_RESEND_DAYS);
    expect(adapter.revisable).toBe(true);
    expect(String(next.events[0].metadata?.revisionKey)).toMatch(/^\d+\|\d+\|\d+\|\d+\|(normal|above|surge)$/);
  });
});
