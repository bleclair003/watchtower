import { describe, expect, it } from 'vitest';
import type { IntelligenceEvent } from './types.ts';
import { classifyCountry, findCountryHotspots } from './countryConvergence.ts';
import { MEMORY_HOURS, trackHotspots } from './convergenceMemory.ts';
import type { Hotspot } from './convergence.ts';

const NOW = Date.parse('2026-11-24T12:00:00Z');
const H = 3_600_000;
let n = 0;
function ev(sourceId: string, country: string, meta: Record<string, unknown> = {}, hoursAgo = 2): IntelligenceEvent {
  n++;
  return {
    id: `c${n}`,
    contentHash: `c${n}`,
    dataOrigin: 'live',
    sourceId,
    sourceName: sourceId,
    sourceClass: 'official',
    sourceUrl: `https://example.test/${n}`,
    title: `Invented record ${n}`,
    category: 'cyber',
    regionIds: ['middle-east'],
    countryCodes: [country],
    publishedAt: new Date(NOW - hoursAgo * H).toISOString(),
    collectedAt: new Date(NOW - hoursAgo * H).toISOString(),
    credibility: 'official',
    verificationStatus: 'unreviewed',
    locationPrecision: 'country',
    metadata: meta,
  };
}

describe('country convergence', () => {
  it('skips routing and DDoS records marked routine, and treats front reports and sanctions as context', () => {
    expect(classifyCountry(ev('cloudflare-radar-bgp', 'RU', { subtype: 'bgp-hijack', routine: true }))).toBeNull();
    expect(classifyCountry(ev('cloudflare-radar-bgp', 'RU', { subtype: 'bgp-hijack', routine: false }))).toEqual({ type: 'routing', feed: 'bgp', role: 'anomaly' });
    expect(classifyCountry(ev('cloudflare-radar-ddos', 'RU', { routine: true }))).toBeNull();
    expect(classifyCountry(ev('ioda-outages', 'IR'))).toEqual({ type: 'outage', feed: 'ioda', role: 'anomaly' });
    expect(classifyCountry(ev('cloudflare-radar-outages', 'IR'))).toEqual({ type: 'outage', feed: 'cloudflare', role: 'anomaly' });
    expect(classifyCountry(ev('ua-general-staff', 'UA'))?.role).toBe('context');
    expect(classifyCountry(ev('ofac-sdn', 'IR'))?.role).toBe('context');
    expect(classifyCountry(ev('bbc-world', 'IR'))).toBeNull();
  });

  it('needs anomalies of two types from two feeds in 48 hours; three feeds is strong', () => {
    const outage = ev('ioda-outages', 'IR');
    const leak = ev('cloudflare-radar-bgp', 'IR', { subtype: 'bgp-leak', routine: false });
    const ddos = ev('cloudflare-radar-ddos', 'IR', { subtype: 'ddos-surge', routine: false });
    const front = ev('ua-general-staff', 'UA');
    // One type from two feeds (outage seen by IODA and by Cloudflare) is not enough.
    expect(findCountryHotspots([outage, ev('cloudflare-radar-outages', 'IR')], NOW)).toEqual([]);
    const watch = findCountryHotspots([outage, leak, front], NOW);
    expect(watch).toHaveLength(1);
    expect(watch[0]).toMatchObject({ country: 'IR', level: 'watch', feeds: ['bgp', 'ioda'] });
    expect(findCountryHotspots([outage, leak, ddos], NOW)[0].level).toBe('strong');
    // Outside the window.
    expect(findCountryHotspots([outage, ev('cloudflare-radar-bgp', 'IR', { routine: false }, 60)], NOW)).toEqual([]);
  });
});

describe('hotspot memory', () => {
  const point = (lat: number, lon: number, level: 'watch' | 'strong'): Hotspot => ({
    id: `p${lat}`, lat, lon, radiusKm: 50, level, types: [], feeds: ['adsb', 'ais'], first: '', last: '', regionIds: [], signals: [], signalCount: 2,
  });
  const country = (c: string, level: 'watch' | 'strong') => ({ country: c, level, types: [], feeds: ['bgp', 'ioda'], first: '', last: '', regionIds: [], signals: [], signalCount: 2 });

  it('reports a hotspot when it appears and when it goes from WATCH to STRONG, not every run', () => {
    const a = trackHotspots(null, [point(59.5, 24, 'watch')], [country('IR', 'watch')], NOW);
    expect(a.changes.map((c) => `${c.kind}:${c.change}`)).toEqual(['point:new', 'country:new']);
    // Next run: same place (moved 40 km), same country: nothing new.
    const b = trackHotspots(a.memory, [point(59.8, 24.2, 'watch')], [country('IR', 'watch')], NOW + H / 2);
    expect(b.changes).toEqual([]);
    // Upgraded to STRONG: reported once, with the original first time.
    const c = trackHotspots(b.memory, [point(59.8, 24.2, 'strong')], [country('IR', 'strong')], NOW + H);
    expect(c.changes.map((x) => `${x.kind}:${x.change}`)).toEqual(['point:upgraded', 'country:upgraded']);
    expect(c.changes[0].firstAt).toBe(new Date(NOW).toISOString());
    expect(trackHotspots(c.memory, [point(59.8, 24.2, 'strong')], [], NOW + 2 * H).changes).toEqual([]);
    // A different place is new.
    expect(trackHotspots(c.memory, [point(44, 33, 'watch')], [], NOW + 2 * H).changes[0].change).toBe('new');
  });

  it('forgets a hotspot gone for a day, so its return is new', () => {
    const a = trackHotspots(null, [], [country('IR', 'watch')], NOW);
    const later = NOW + (MEMORY_HOURS + 1) * H;
    expect(trackHotspots(a.memory, [], [country('IR', 'watch')], later).changes[0].change).toBe('new');
  });
});
