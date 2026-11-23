// @vitest-environment node
/** NGA daily in-force files (v0.66.1). Warning texts are invented, in the NGA layout. */
import { describe, expect, it } from 'vitest';
import { classifyWarning, parseDailyMemo, readWarning } from '../../shared/domain/navWarnings.ts';
import { ngaMsi, NGA_DAILY_BASE, NGA_DAILY_FILES, NGA_URL } from '../adapters/ngaMsi.ts';
import { HttpError, type FetchResult } from '../lib/http.ts';

const NOW = Date.parse('2026-11-23T10:00:00Z');
const ok = (body: string): FetchResult => ({ kind: 'ok', status: 200, body, validators: {}, bytes: body.length });

const MEMO = [
  '',
  'HYDROPAC IN FORCE AS OF 212245Z NOV 26.',
  '',
  'To receive Broadcast Warning messages via email, go to',
  'msi.nga.mil.',
  '',
  '211454Z NOV 26',
  'HYDROPAC 9001/26',
  'STRAIT OF HORMUZ.',
  'TEST VESSEL ALPHA SUFFERED A SECURITY INCIDENT, IS ON FIRE',
  'IN 26-23.40N 056-18.60E.',
  '',
  '102115Z MAR 26',
  'HYDROPAC 9000/26(GEN).',
  'EASTERN INDIAN OCEAN.',
  'UNDERWATER OPERATIONS IN AREA BOUND BY',
  '12-54.90S 124-25.10E, 12-59.90S 124-35.10E.',
  '',
  '',
  '091200Z JAN 25',
  'NAVAREA IV 812/25(11416).',
  'CARIBBEAN SEA.',
  'GUNNERY EXERCISES WITHIN 5 MILES OF 18-00N 066-00W.',
].join('\r\n');

describe('daily in-force files', () => {
  it('splits warnings at their date and id lines, ids with a chart number or (GEN) included', () => {
    const { asOf, warnings } = parseDailyMemo(MEMO);
    expect(asOf).toBe('2026-11-21T22:45:00.000Z');
    expect(warnings.map((w) => `${w.navArea} ${w.msgNumber}/${w.msgYear}`)).toEqual(['P 9001/2026', 'P 9000/2026', '4 812/2025']);
    const w = warnings.map((r) => readWarning(r)!);
    expect(w[0]).toMatchObject({ key: 'HYDROPAC 9001/26', issuedAt: '2026-11-21T14:54:00.000Z', kind: 'piracy', regionIds: ['middle-east'] });
    // The next warning's text does not run into this one's.
    expect(w[1].text).toBe('EASTERN INDIAN OCEAN. UNDERWATER OPERATIONS IN AREA BOUND BY 12-54.90S 124-25.10E, 12-59.90S 124-35.10E.');
    expect(w[1].regionIds).toEqual([]);
    expect(w[2]).toMatchObject({ key: 'NAVAREA IV 812/25', kind: 'firing' });
    expect(parseDailyMemo('nothing here')).toEqual({ asOf: null, warnings: [] });
  });

  it('counts a vessel hit in a "security incident" as an attack on shipping', () => {
    expect(classifyWarning('M/V TEST SUFFERED A SECURITY INCIDENT AND SANK.')).toBe('piracy');
    expect(classifyWarning('M/V TEST STRUCK BY A PROJECTILE.')).toBe('piracy');
    expect(classifyWarning('M/V TEST SANK IN 08-40N 076-50W.')).toBe('other');
  });

  it('falls back to the daily files when the API fails, and says so', async () => {
    const urls: string[] = [];
    const fetch = async (u: string) => {
      urls.push(u);
      if (u === NGA_URL) throw new HttpError('HTTP 503', 503);
      if (u.endsWith('DailyMemPAC.txt')) return ok(MEMO);
      if (u.endsWith('DailyMemARC.txt')) throw new HttpError('HTTP 404', 404);
      return ok('HYDROLANT IN FORCE AS OF 220100Z NOV 26.\n');
    };
    const r = await ngaMsi.collect({ now: NOW, state: null, fetch });
    expect(urls).toEqual([NGA_URL, ...NGA_DAILY_FILES.map((f) => NGA_DAILY_BASE + f)]);
    expect(r.state).toMatchObject({ via: 'daily-files', asOf: '2026-11-21T22:45:00.000Z', activeTotal: 3 });
    expect(r.state.warnings.map((w) => w.key)).toEqual(['HYDROPAC 9001/26', 'HYDROPAC 9000/26', 'NAVAREA IV 812/25'].filter((k) => k !== 'HYDROPAC 9000/26'));
    const rec = r.events.find((e) => e.title.startsWith('HYDROPAC 9001/26'))!;
    expect(rec.sourceUrl).toBe(NGA_DAILY_BASE + 'DailyMemPAC.txt');
    expect(rec.summary).toMatch(/daily in-force list NGA posts while its portal is down/);
  });

  it('fails when neither the API nor any daily file answers', async () => {
    const fetch = async (u: string) => {
      if (u === NGA_URL) throw new HttpError('HTTP 503', 503);
      return ok('<html>maintenance</html>');
    };
    await expect(ngaMsi.collect({ now: NOW, state: null, fetch })).rejects.toThrow(/HTTP 503, and the daily in-force files could not be read either/);
  });
});
