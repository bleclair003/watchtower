// @vitest-environment node
/**
 * North Korean launches from Yonhap. The fixture is the real English all-news feed of 2026-11-21
 * (100 items, no launch). Launch headlines follow Yonhap's usual wording.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { FetchResult } from '../lib/http.ts';
import { parseFeed, type FeedItem } from '../lib/feed.ts';
import { YONHAP_DPRK_SOURCE_ID, dprkEvents, dprkHeadlines, yonhapDprkLaunches } from '../adapters/yonhapDprk.ts';
import { validateEvent } from '../lib/validate.ts';
import { INDICATOR_CATALOG, validateCatalog } from '../../shared/domain/indicators/catalog.ts';
import { evaluateIndicator } from '../../shared/domain/indicators/evaluate.ts';

const NOW = Date.parse('2026-11-21T10:00:00Z');
const nowIso = new Date(NOW).toISOString();
const xml = readFileSync(new URL('./fixtures/yonhap-news.sample.xml', import.meta.url), 'utf8');
const item = (title: string, published: string, n = 1): FeedItem => ({ title, link: `https://en.yna.co.kr/view/AEN2026112000${n}`, description: '', published, guid: '', categories: [], content: '' });

describe('Yonhap launch headlines', () => {
  it('finds nothing in a real feed without launches (no false positives)', () => {
    expect(dprkHeadlines(parseFeed(xml))).toEqual([]);
  });

  it('keeps reports of launches and tests, drops forecasts and warnings', () => {
    const hs = dprkHeadlines([
      item('(URGENT) N. Korea fires unidentified ballistic missile toward East Sea: JCS', 'Wed, 18 Nov 2026 07:41:00 +0900', 1),
      item('(LEAD) N. Korea fires short-range ballistic missiles into East Sea', 'Wed, 18 Nov 2026 08:10:00 +0900', 2),
      item('(2nd LD) N. Korea fires 2 short-range ballistic missiles into East Sea: JCS', 'Wed, 18 Nov 2026 09:30:00 +0900', 3),
      item('N. Korea may fire ICBM around U.S. election: NIS', 'Wed, 18 Nov 2026 10:00:00 +0900', 4),
      item('N. Korea preparing for satellite launch, JCS says', 'Wed, 18 Nov 2026 11:00:00 +0900', 5),
      item('S. Korea fires Hyunmoo missile in drill', 'Wed, 18 Nov 2026 12:00:00 +0900', 6),
      item('(URGENT) N. Korea conducts nuclear test: JCS', 'Thu, 19 Nov 2026 10:31:00 +0900', 7),
    ]);
    expect(hs.map((h) => [h.kind, h.kstDate])).toEqual([
      ['launch', '2026-11-18'],
      ['launch', '2026-11-18'],
      ['launch', '2026-11-18'],
      ['nuclear-test', '2026-11-19'],
    ]);
    expect(hs[0].title).toBe('N. Korea fires unidentified ballistic missile toward East Sea: JCS'); // version tag removed
  });

  it('one record per kind and Korea day, revised as versions arrive', () => {
    const early = dprkHeadlines([item('(URGENT) N. Korea fires unidentified ballistic missile toward East Sea: JCS', 'Tue, 17 Nov 2026 23:41:00 +0000', 1)]);
    const [a] = dprkEvents(early, nowIso);
    // 23:41 UTC on the 17th is 08:41 on the 18th in Korea.
    expect(a.metadata?.kstDate).toBe('2026-11-18');
    expect(a.title).toBe('North Korea launch reported (2026-11-18, Korea time): N. Korea fires unidentified ballistic missile toward East Sea: JCS');
    expect(a).toMatchObject({ regionIds: ['korean-peninsula'], countryCodes: ['KP'], category: 'military', sourceClass: 'media' });
    expect(validateEvent(a, NOW)).toBeNull();
    const later = dprkHeadlines([
      item('(URGENT) N. Korea fires unidentified ballistic missile toward East Sea: JCS', 'Tue, 17 Nov 2026 23:41:00 +0000', 1),
      item('(LEAD) N. Korea fires 2 short-range ballistic missiles into East Sea: JCS', 'Wed, 18 Nov 2026 00:20:00 +0000', 2),
    ]);
    const [b] = dprkEvents(later, nowIso);
    expect(b.id).toBe(a.id);
    expect(b.metadata?.revisionKey).not.toBe(a.metadata?.revisionKey);
    expect(b.summary).toMatch(/fires 2 short-range ballistic missiles/);
  });
});

describe('adapter and indicators', () => {
  it('reads the feed with validators', async () => {
    const r = await yonhapDprkLaunches.collect({ now: NOW, state: null, fetch: async (): Promise<FetchResult> => ({ kind: 'ok', status: 200, body: xml, bytes: xml.length, validators: { etag: '"y"' } }) });
    expect(r).toMatchObject({ itemsSeen: 100, events: [], state: { validators: { etag: '"y"' } } });
    expect(yonhapDprkLaunches.revisable).toBe(true);
  });

  it('launches on two days within a week trigger; a nuclear test triggers at once', () => {
    const defs = INDICATOR_CATALOG.filter((d) => d.requiredSourceIds.includes(YONHAP_DPRK_SOURCE_ID));
    expect(validateCatalog(defs)).toEqual([]);
    const events = dprkEvents(
      dprkHeadlines([
        item('N. Korea fires ballistic missile toward East Sea: JCS', 'Mon, 16 Nov 2026 08:00:00 +0900', 1),
        item('N. Korea fires cruise missiles into Yellow Sea: JCS', 'Thu, 19 Nov 2026 08:00:00 +0900', 2),
        item('N. Korea conducts nuclear test: JCS', 'Fri, 20 Nov 2026 10:00:00 +0900', 3),
      ]),
      nowIso,
    );
    const iso = (t: number) => new Date(t).toISOString();
    const status = [{ sourceId: YONHAP_DPRK_SOURCE_ID, health: 'ONLINE' as const, lastAttemptAt: iso(NOW), lastSuccessAt: iso(NOW), firstSuccessAt: iso(NOW - 864e5), lastNewItemAt: iso(NOW), consecutiveFailures: 0, parseErrors: 0, lastError: null }];
    expect(evaluateIndicator(defs.find((d) => d.id === 'korean-peninsula.dprk-missile-launch')!, events, status, NOW).state).toBe('TRIGGERED');
    expect(evaluateIndicator(defs.find((d) => d.id === 'korean-peninsula.dprk-nuclear-test')!, events, status, NOW).state).toBe('TRIGGERED');
  });
});
