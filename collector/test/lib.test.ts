// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { htmlToText, cleanText, safeUrl, truncate } from '../lib/text.ts';
import { parseFeedDate } from '../lib/dates.ts';
import { parseFeed, FeedParseError } from '../lib/feed.ts';
import { politeFetch, USER_AGENT } from '../lib/http.ts';
import { advisoryToIso, FIPS_TO_ISO } from '../lib/fips.ts';
import { contentHash } from '../lib/hash.ts';
import { computeHealth } from '../../shared/domain/health.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('text sanitization', () => {
  it('reduces HTML (including double-encoded HTML) to clean text', () => {
    expect(htmlToText('<p>Do not travel to <b>Iran </b>due to <b>terrorism</b>, <b>unrest</b>.</p><ul><li>One</li></ul>')).toBe(
      'Do not travel to Iran due to terrorism, unrest. One.',
    );
    expect(htmlToText('&lt;h2&gt;Summary&lt;/h2&gt;&lt;p&gt;Exploit &amp;amp; impact&lt;/p&gt;')).toBe('Summary. Exploit & impact.');
    expect(htmlToText('<script>alert(1)</script>safe<style>x{}</style>')).toBe('safe');
    expect(htmlToText('<blockquote>quoted</blockquote>')).toBe('quoted');
  });

  it('strips control and bidi-override characters', () => {
    expect(cleanText('a\u202Eb\u200Bc\u0007d\n\te')).toBe('abcd e');
  });

  it('accepts only http(s) URLs', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,x')).toBeNull();
    expect(safeUrl('/x/y#frag', 'https://www.cisa.gov/')).toBe('https://www.cisa.gov/x/y');
    expect(safeUrl(42)).toBeNull();
  });

  it('truncates at word boundaries', () => {
    expect(truncate('alpha beta gamma delta', 15)).toBe('alpha beta…');
    expect(truncate('short', 15)).toBe('short');
  });
});

describe('parseFeedDate', () => {
  it('handles the formats real sources use', () => {
    expect(parseFeedDate('Thu, 19 Nov 26 12:00:00 +0000')).toBe('2026-11-19T12:00:00.000Z'); // CISA 2-digit year
    expect(parseFeedDate('Fri, 23 Oct 2026')).toBe('2026-10-23T00:00:00.000Z'); // State Dept date-only
    expect(parseFeedDate('Fri, 20 Nov 2026 07:19:07 GMT')).toBe('2026-11-20T07:19:07.000Z');
    expect(parseFeedDate('Fri, 20 Nov 2026 02:19:07 -0500')).toBe('2026-11-20T07:19:07.000Z');
    expect(parseFeedDate('2026-11-18T19:17:41.0354Z')).toBe('2026-11-18T19:17:41.035Z');
    expect(parseFeedDate('2026-11-18')).toBe('2026-11-18T00:00:00.000Z');
  });

  it('returns null rather than guessing', () => {
    expect(parseFeedDate('31 Feb 2026')).toBeNull();
    expect(parseFeedDate('yesterday')).toBeNull();
    expect(parseFeedDate('Fri, 20 Nov 2026 07:19 XYZ')).toBeNull();
    expect(parseFeedDate(undefined)).toBeNull();
  });
});

describe('parseFeed', () => {
  it('parses the real State Dept RSS sample with structured categories', () => {
    const items = parseFeed(fixture('state-advisories.sample.xml'));
    expect(items).toHaveLength(8);
    const iran = items.find((i) => i.title.startsWith('Iran'))!;
    expect(iran.link).toMatch(/^https:\/\/travel\.state\.gov\//);
    expect(iran.categories).toEqual(
      expect.arrayContaining([
        { domain: 'Threat-Level', value: 'Level 4: Do Not Travel' },
        { domain: 'Country-Tag', value: 'IR' },
      ]),
    );
  });

  it('parses the real CISA RSS sample', () => {
    const items = parseFeed(fixture('cisa-advisories.sample.xml'));
    expect(items).toHaveLength(5);
    expect(items[0].published).toBe('Thu, 19 Nov 26 12:00:00 +0000');
  });

  it('parses Atom', () => {
    const items = parseFeed(
      `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>tag:x,1</id><title>UK statement</title>
       <link rel="alternate" href="https://www.gov.uk/x"/><updated>2026-11-19T10:00:00Z</updated><summary>Text &amp; more</summary></entry></feed>`,
    );
    expect(items[0]).toMatchObject({ title: 'UK statement', link: 'https://www.gov.uk/x', published: '2026-11-19T10:00:00Z', description: 'Text & more' });
  });

  it('refuses documents that declare entities, and non-feeds', () => {
    expect(() => parseFeed('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><rss><channel></channel></rss>')).toThrow(FeedParseError);
    expect(() => parseFeed('<html><body>Access denied</body></html>')).toThrow(FeedParseError);
  });
});

describe('FIPS → ISO mapping (State Dept country tags)', () => {
  const pairs = JSON.parse(fixture('state-country-tags.json')) as { fips: string; name: string }[];
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  // Feed names that legitimately differ from CLDR English names.
  const ALIASES: Record<string, string> = {
    BQ: 'Bonaire|Saba', MM: 'Burma', CG: 'Republic of Congo', CD: 'Democratic Republic of the Congo', CZ: 'Czechia',
    CI: 'Côte d’Ivoire', KG: 'Kyrgyz', MX: 'Mexico', NR: 'Naoero', PS: 'Gaza|West Bank', TO: 'Tonga', CV: 'Cabo Verde',
    MF: 'Saint Martin', BL: 'Saint Barthelemy', ST: 'São Tomé', VC: 'Saint Vincent', KN: 'Saint Kitts', LC: 'Saint Lucia',
    FM: 'Micronesia', BS: 'Bahamas', GM: 'Gambia', TR: 'Turkey', XK: 'Kosovo', HK: 'Hong Kong', MO: 'Macau',
    SZ: 'Eswatini', TL: 'Timor-Leste', KP: 'North Korea', KR: 'South Korea', VG: 'British Virgin Islands', CW: 'Curaçao',
  };

  it('maps every observed tag except the multi-territory "French West Indies"', () => {
    const unmapped = pairs.filter((p) => !advisoryToIso(p.fips, p.name)).map((p) => p.name);
    expect(unmapped).toEqual(['French West Indies']);
  });

  it('maps each tag to the country the feed itself names', () => {
    const norm = (x: string) =>
      x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, 'and').replace(/\bthe\b/g, '').replace(/[^a-z]/g, '');
    const mismatches: string[] = [];
    for (const p of pairs) {
      const iso = advisoryToIso(p.fips, p.name);
      if (!iso) continue;
      const candidates = [...(ALIASES[iso]?.split('|') ?? []), names.of(iso) ?? ''].map(norm).filter(Boolean);
      const name = norm(p.name);
      if (!candidates.some((c) => name.includes(c) || c.includes(name))) mismatches.push(`${p.fips} "${p.name}" → ${iso} (${names.of(iso)})`);
    }
    expect(mismatches).toEqual([]);
  });

  it('never confuses FIPS with ISO for the dangerous collisions', () => {
    expect(FIPS_TO_ISO.RS).toBe('RU'); // not Serbia
    expect(FIPS_TO_ISO.IS).toBe('IL'); // not Iceland
    expect(FIPS_TO_ISO.UP).toBe('UA');
    expect(FIPS_TO_ISO.KS).toBe('KR');
    expect(FIPS_TO_ISO.KN).toBe('KP');
    expect(advisoryToIso('IS', 'Gaza')).toBe('PS');
  });
});

describe('politeFetch', () => {
  const ok = (body: string, headers: Record<string, string> = {}) => new Response(body, { status: 200, headers });

  it('sends a descriptive UA and conditional headers; reports 304', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 304 }));
    const r = await politeFetch('https://example.org/feed', { fetchImpl, validators: { etag: 'W/"x"', lastModified: 'Fri, 20 Nov 2026 07:50:02 GMT' } });
    expect(r.kind).toBe('not-modified');
    const headers = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers['User-Agent']).toBe(USER_AGENT);
    expect(headers['If-None-Match']).toBe('W/"x"');
    expect(headers['If-Modified-Since']).toBe('Fri, 20 Nov 2026 07:50:02 GMT');
  });

  it('retries 5xx/429 with backoff, then succeeds and returns validators', async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 429 }))
      .mockResolvedValueOnce(new Response('down', { status: 503 }))
      .mockResolvedValueOnce(ok('<rss/>', { etag: '"abc"' }));
    const r = await politeFetch('https://example.org/feed', { fetchImpl, sleep });
    expect(r).toMatchObject({ kind: 'ok', body: '<rss/>', validators: { etag: '"abc"' } });
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls[0]).toEqual([10_000]); // 429 → longer pause
  });

  it('does not retry client errors and gives up after retries are exhausted', async () => {
    const f404 = vi.fn(async () => new Response('nope', { status: 404 }));
    await expect(politeFetch('https://example.org/x', { fetchImpl: f404 })).rejects.toThrow('HTTP 404');
    expect(f404).toHaveBeenCalledTimes(1);

    const f503 = vi.fn(async () => new Response('x', { status: 503 }));
    await expect(politeFetch('https://example.org/x', { fetchImpl: f503, sleep: async () => {}, retries: 2 })).rejects.toThrow('HTTP 503');
    expect(f503).toHaveBeenCalledTimes(3);
  });

  it('enforces the maximum body size', async () => {
    const fetchImpl = vi.fn(async () => ok('x'.repeat(100)));
    await expect(politeFetch('https://example.org/x', { fetchImpl, maxBytes: 10 })).rejects.toThrow(/too large/);
  });
});

describe('contentHash', () => {
  it('is stable, normalized and 32 hex chars', () => {
    expect(contentHash('a', 'B  c')).toBe(contentHash('A', 'b c'));
    expect(contentHash('a', 'b')).not.toBe(contentHash('a', 'c'));
    expect(contentHash('x')).toMatch(/^[a-f0-9]{32}$/);
  });
});

describe('computeHealth', () => {
  const now = Date.parse('2026-11-20T12:00:00Z');
  const base = { lastAttemptAt: '2026-11-20T11:00:00Z', lastSuccessAt: '2026-11-20T11:00:00Z', consecutiveFailures: 0, parseErrors: 0 };
  it('classifies source health', () => {
    expect(computeHealth({ ...base, lastAttemptAt: null, lastSuccessAt: null }, 60, now)).toBe('NOT_CONFIGURED');
    expect(computeHealth(base, 60, now)).toBe('ONLINE');
    expect(computeHealth({ ...base, consecutiveFailures: 1 }, 60, now)).toBe('DEGRADED');
    expect(computeHealth({ ...base, parseErrors: 2 }, 60, now)).toBe('DEGRADED');
    expect(computeHealth({ ...base, consecutiveFailures: 3 }, 60, now)).toBe('OFFLINE');
    expect(computeHealth({ ...base, lastSuccessAt: '2026-11-20T07:00:00Z' }, 60, now)).toBe('STALE');
  });
});
