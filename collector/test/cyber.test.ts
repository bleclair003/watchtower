// @vitest-environment node
/** Phase 20: the CYBER page data, national cyber agencies (RSS, RDF, CERT-UA) and EPSS. */
import { describe, expect, it } from 'vitest';
import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { buildCyberSnapshot } from '../../shared/domain/cyber.ts';
import { parseFeed } from '../lib/feed.ts';
import { cccsCanada, certUa, firstEpss, parseCertUaList } from '../adapters/cyberAgencies.ts';
import type { FetchResult } from '../lib/http.ts';

const NOW = Date.parse('2026-11-22T00:00:00Z');
const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString();
const ok = (body: string): FetchResult => ({ kind: 'ok', status: 200, body, validators: {}, bytes: body.length });

let n = 0;
function ev(sourceId: string, daysAgo: number, metadata: Record<string, unknown> = {}): IntelligenceEvent {
  const id = `c${++n}`;
  return {
    id, contentHash: id, dataOrigin: 'live', sourceId, sourceName: sourceId, sourceClass: 'official', sourceUrl: `https://example.test/${id}`, title: `${sourceId} ${id}`,
    category: 'cyber', regionIds: ['global-cyber'], countryCodes: [], publishedAt: iso(NOW - daysAgo * DAY), occurredAt: null, collectedAt: iso(NOW - daysAgo * DAY),
    credibility: 'official', verificationStatus: 'unreviewed', locationPrecision: 'none', metadata,
  };
}

describe('CYBER page data', () => {
  it('keeps 30 days of KEV with EPSS, CISA and agency items, and 7 days of disruptions', () => {
    const kev = [
      { cve: 'CVE-2026-1', vendor: 'A', product: 'X', name: 'n', added: '2026-11-20', due: null, ransomware: true },
      { cve: 'CVE-2026-2', vendor: 'B', product: 'Y', name: 'n', added: '2026-11-20', due: null, ransomware: false },
      { cve: 'CVE-2026-3', vendor: 'C', product: 'Z', name: 'n', added: '2026-09-01', due: null, ransomware: false },
    ];
    const events = [
      ev('cisa-advisories', 2, { subtype: 'joint-advisory', routine: false }),
      ev('cisa-advisories', 3, { subtype: 'ics-advisory', routine: true }),
      ev('cisa-advisories', 40, { subtype: 'alert', routine: false }),
      ev('cert-ua', 5),
      ev('cloudflare-radar-outages', 1, { outageCause: 'GOVERNMENT_DIRECTED', endedAt: null }),
      ev('cloudflare-radar-outages', 9, { outageCause: 'CABLE_CUT', endedAt: null }),
      ev('bbc-world', 1),
    ];
    const s = buildCyberSnapshot(events, kev, { 'CVE-2026-2': [0.6, 0.99] }, iso(NOW), NOW);
    expect(s.kev.map((k) => [k.cve, k.epss])).toEqual([['CVE-2026-2', 0.6], ['CVE-2026-1', null]]); // same day: higher EPSS first; September dropped
    expect(s.advisories.map((a) => [a.label, a.routine])).toEqual([['Joint advisory', false], ['ICS advisory', true]]);
    expect(s.agencies.map((a) => a.label)).toEqual(['CERT-UA (Ukraine)']);
    expect(s.outages.map((o) => [o.cause, o.ongoing])).toEqual([['GOVERNMENT_DIRECTED', true]]);
  });
});

describe('agency feeds', () => {
  it('reads RSS 1.0 (RDF) feeds such as JPCERT/CC', () => {
    const rdf = `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <channel rdf:about="https://www.jpcert.or.jp/english/"><title>JPCERT/CC RSS Feed</title></channel>
      <item rdf:about="https://www.jpcert.or.jp/english/at/2026/at260020.html"><title>Security Alert: Microsoft Releases November 2026 Security Updates</title><link>https://www.jpcert.or.jp/english/at/2026/at260020.html</link><dc:date>2026-11-11T11:21+09:00</dc:date></item>
    </rdf:RDF>`;
    expect(parseFeed(rdf).map((i) => [i.title, i.link, i.published])).toEqual([['Security Alert: Microsoft Releases November 2026 Security Updates', 'https://www.jpcert.or.jp/english/at/2026/at260020.html', '2026-11-11T11:21+09:00']]);
  });

  it('keeps Canadian alerts, leaves out routine vendor-patch advisories, and tags only the global cyber watch', async () => {
    const rss = (items: string[]) => `<rss version="2.0"><channel><title>Alerts and advisories</title>${items.map((t, i) => `<item><title>${t}</title><link>https://www.cyber.gc.ca/en/alerts-advisories/${i}</link><pubDate>Fri, 21 Nov 2026 13:17:12 GMT</pubDate></item>`).join('')}</channel></rss>`;
    const r = await cccsCanada.collect({ now: NOW, state: null, fetch: async () => ok(rss(['Apache security advisory (AV26-1188)', 'AL26-029 - Critical vulnerability impacting Oracle Java - CVE-2026-114938'])) });
    expect(r.events.map((e) => [e.title, e.regionIds, e.category])).toEqual([['AL26-029 - Critical vulnerability impacting Oracle Java - CVE-2026-114938', ['global-cyber'], 'cyber']]);
  });

  it('reads CERT-UA articles, with English titles for recent ones', async () => {
    const item = (id: number, title: string, eng: number, date: string) => `<items><id>${id}</id><title>${title}</title><description>x</description><engId>${eng}</engId><engStatus>1</engStatus><date>${date}</date><tags></tags></items>`;
    const list = `<ResponseArticleRecommendationDTO><items>${item(1, 'Кібератака UAC-0255', 11, '18.11.2026')}${item(2, 'Стара стаття', 12, '01.02.2026')}</items></ResponseArticleRecommendationDTO>`;
    expect(parseCertUaList(list).map((a) => [a.id, a.engId, a.date])).toEqual([['1', '11', '2026-11-18'], ['2', '12', '2026-02-01']]);
    const r = await certUa.collect({ now: NOW, state: null, fetch: async (url) => ok(url.includes('byId') ? '<FullArticleDTO><id>11</id><title>Cyber attack by UAC-0255</title><body>…</body></FullArticleDTO>' : list) });
    expect(r.events.map((e) => [e.title, e.regionIds, e.sourceUrl])).toEqual([['CERT-UA: Cyber attack by UAC-0255', ['global-cyber', 'eastern-europe'], 'https://cert.gov.ua/article/11']]);
    expect(r.state?.titles).toEqual({ '11': 'Cyber attack by UAC-0255' });
  });

  it('scores the KEV entries of the last 30 days with EPSS, every 6 hours', async () => {
    const kevState = { validators: {}, catalogVersion: '1', firstRunAt: iso(NOW), recent: [{ cve: 'CVE-2026-9', vendor: 'v', product: 'p', name: 'n', added: '2026-11-20', due: null, ransomware: false }] };
    let url = '';
    const r = await firstEpss.collect({
      now: NOW,
      state: null,
      peerState: (async () => kevState) as never,
      fetch: async (u) => {
        url = u;
        return ok(JSON.stringify({ data: [{ cve: 'CVE-2026-9', epss: '0.74323', percentile: '0.99512' }] }));
      },
    });
    expect(url).toBe('https://api.first.org/data/v1/epss?cve=CVE-2026-9');
    expect(r.state?.scores).toEqual({ 'CVE-2026-9': [0.7432, 0.995] });
    expect((await firstEpss.collect({ now: NOW + 3_600_000, state: r.state!, fetch: async () => ok('') })).notModified).toBe(true);
  });
});
