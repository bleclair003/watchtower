// @vitest-environment node
/** UNHCR displacement. Fixtures are the real API tables of 2026-11-21 (2026 and 2025, by origin and by asylum). */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { FetchResult } from '../lib/http.ts';
import { buildDisplacement, figuresByCountry, unhcrDisplacement, unhcrUrl } from '../adapters/unhcr.ts';

const NOW = Date.parse('2026-11-21T13:00:00Z');
const raw = (n: string) => readFileSync(new URL(`./fixtures/unhcr-${n}.sample.json`, import.meta.url), 'utf8');
const items = (n: string) => JSON.parse(raw(n)).items;
const ok = (body: string): FetchResult => ({ kind: 'ok', status: 200, body, bytes: body.length, validators: {} });

describe('UNHCR displacement (real)', () => {
  it('keeps watch-region countries only, mapped to ISO2', () => {
    const s = buildDisplacement(2026, figuresByCountry(items('o2026'), items('a2026')), figuresByCountry(items('o2025'), items('a2025')), '');
    expect(s.rows.length).toBe(32);
    expect(s.rows.some((r) => r.country === 'TW')).toBe(false); // no UNHCR figures for Taiwan
    const lb = s.rows.find((r) => r.country === 'LB')!;
    expect(lb.latest.idps).toBe(430600);
    expect(lb.previous?.idps).toBe(64417);
    expect(lb.latest.refugeesHosted).toBe(892314);
    const ua = s.rows.find((r) => r.country === 'UA')!;
    expect(ua.latest.refugeesAbroad).toBe(5191571);
    expect(ua.latest.idps).toBe(3871000);
  });

  it('fetches four tables once a day and emits no records', async () => {
    const fetch = vi.fn(async (url: string): Promise<FetchResult> => {
      const y = url.includes('year=2026') ? '2026' : '2025';
      return ok(raw(`${url.includes('coo_all') ? 'o' : 'a'}${y}`));
    });
    const r = await unhcrDisplacement.collect({ now: NOW, state: null, fetch });
    expect(fetch.mock.calls.map((c) => c[0]).sort()).toEqual([unhcrUrl(2025, 'asylum'), unhcrUrl(2025, 'origin'), unhcrUrl(2026, 'asylum'), unhcrUrl(2026, 'origin')].sort());
    expect(r.events).toEqual([]);
    expect(r.state.latest?.year).toBe(2026);
    expect(r.state.latest?.rows.length).toBe(32);
    fetch.mockClear();
    expect((await unhcrDisplacement.collect({ now: NOW + 12 * 3_600_000, state: r.state, fetch })).notModified).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('falls back to last year when this year is not yet published', async () => {
    const empty = JSON.stringify({ items: [] });
    const fetch = vi.fn(async (url: string): Promise<FetchResult> => {
      if (url.includes('year=2026')) return ok(empty);
      return ok(raw(`${url.includes('coo_all') ? 'o' : 'a'}2025`));
    });
    const r = await unhcrDisplacement.collect({ now: NOW, state: null, fetch });
    expect(r.state.latest?.year).toBe(2025);
  });
});
