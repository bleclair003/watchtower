// @vitest-environment node
/** Phase 23: OONI censorship readings — verdicts, new blocks, the collector's rotation and records. */
import { describe, expect, it } from 'vitest';
import { CENSOR_COUNTRIES, CENSOR_TARGETS, readTarget, type DayRow } from '../../shared/domain/censorship.ts';
import { ooni } from '../adapters/ooni.ts';
import type { FetchResult } from '../lib/http.ts';

const NOW = Date.parse('2026-11-22T03:00:00Z');
/** 16 days: 14 earlier days at `before` failure share, the last 2 at `after`. */
const days = (before: number, after: number, perDay = 20): DayRow[] =>
  Array.from({ length: 16 }, (_, i) => {
    const share = i >= 14 ? after : before;
    return { measurement_start_day: `2026-11-${String(6 + i).padStart(2, '0')}`, measurement_count: perDay, anomaly_count: Math.round(perDay * share), confirmed_count: 0 };
  });

describe('readings', () => {
  it('gives blocked / partial / ok / no-data verdicts from the last 2 days', () => {
    expect(readTarget('x', days(0.9, 0.9)).status).toBe('blocked');
    expect(readTarget('x', days(0.3, 0.3)).status).toBe('partial');
    expect(readTarget('x', days(0, 0.05)).status).toBe('ok');
    expect(readTarget('x', days(0.9, 0.9, 4)).status).toBe('no-data'); // 8 tests in 2 days
    // Confirmed block pages count as failures too.
    expect(readTarget('x', [{ measurement_start_day: '2026-11-21', measurement_count: 20, anomaly_count: 4, confirmed_count: 12 }]).share).toBe(0.8);
  });

  it('flags a new block only for a clear rise against the 14 days before', () => {
    expect(readTarget('telegram', days(0.27, 1)).isNew).toBe(true); // Iraq-like: 27% → 100%
    expect(readTarget('twitter', days(0.18, 0.25)).isNew).toBe(false); // drift across the 20% line
    expect(readTarget('whatsapp', days(0.86, 0.87)).isNew).toBe(false); // long-standing block
  });
});

describe('collector', () => {
  it('reads two countries per run in turn and records a new block once', async () => {
    const seen: string[] = [];
    const ok = (body: unknown): FetchResult => ({ kind: 'ok', status: 200, body: JSON.stringify(body), validators: {}, bytes: 1 });
    const fetch = async (url: string) => {
      seen.push(url);
      const cc = url.match(/probe_cc=(\w+)/)![1];
      return ok({ result: cc === CENSOR_COUNTRIES[1].cc && url.includes('telegram') ? days(0.05, 1) : days(0, 0) });
    };
    const r1 = await ooni.collect({ now: NOW, state: null, fetch });
    expect(seen).toHaveLength(2 * CENSOR_TARGETS.length);
    expect(r1.state?.cursor).toBe(2);
    expect(r1.events.map((e) => e.title)).toEqual([`OONI: Telegram looks blocked in ${CENSOR_COUNTRIES[1].name} — 100% of 40 tests failed (usually 5%)`]);
    expect(r1.events[0].summary).toContain('CC BY-NC-SA 4.0');
    // The same block is not recorded again while it lasts.
    const r2 = await ooni.collect({ now: NOW + 3_600_000, state: { ...r1.state!, cursor: 0 }, fetch });
    expect(r2.events).toHaveLength(0);
  });
});
