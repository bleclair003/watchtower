// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import type { DashboardSnapshot } from '../../shared/domain/snapshot.ts';
import { buildBrief, isNotableWarning } from '../../shared/domain/brief/brief.ts';
import { briefToDiscord, runDailyBrief, MAX_ATTEMPTS_PER_DAY } from '../brief/dailyBrief.ts';
import { MemoryStore } from '../store/memory.ts';

const NOW = Date.parse('2026-11-21T11:05:00Z');
const HOOK = 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz0123456789ABCD';
let n = 0;
const ev = (p: Partial<IntelligenceEvent> & { title: string }): IntelligenceEvent => {
  const id = `e${++n}`;
  return {
    id, contentHash: id, dataOrigin: 'live', sourceId: 'bbc-world', sourceName: 'BBC News — World', sourceClass: 'media',
    sourceUrl: `https://www.bbc.co.uk/news/articles/${id}`, category: 'general', regionIds: [], countryCodes: [],
    publishedAt: new Date(NOW - 3_600_000).toISOString(), occurredAt: null, collectedAt: new Date(NOW - 3_000_000).toISOString(),
    credibility: 'single-source', verificationStatus: 'unreviewed', locationPrecision: 'none', ...p,
  };
};
const snap = (events: IntelligenceEvent[]): DashboardSnapshot => ({
  schemaVersion: 2, generatedAt: new Date(NOW).toISOString(), events, sourceStatus: [], lastRun: null, totalEventsStored: events.length,
  regionScores: [{ regionId: 'middle-east', score: 20, band: 'INCREASED', coverage: 1, activeIndicators: 1, contributions: [], evaluatedAt: new Date(NOW).toISOString() }],
  scoreHistory: [{ at: new Date(NOW - 24 * 3_600_000).toISOString(), scores: { 'middle-east': 14 } }],
  indicatorEvaluations: [],
});

describe('daily brief content', () => {
  it('summarises RAI change, notable warnings and top stories, and states empty sections', () => {
    const events = [
      ev({ title: 'Denmark expels Russian diplomat over alleged plot to kill Ukrainian rapper', sourceId: 'aljazeera', sourceName: 'Al Jazeera — All news', regionIds: ['eastern-europe'] }),
      ev({ title: 'Denmark accuses Russia of plotting to assassinate US-Ukrainian rapper', regionIds: ['eastern-europe'] }),
      ev({ title: 'Earthquake M6.7 — Peru', sourceId: 'usgs-earthquakes', sourceClass: 'scientific', metadata: { seismicType: 'earthquake', magnitude: 6.7 } }),
      ev({ title: 'Earthquake M4.6 — Fiji', sourceId: 'usgs-earthquakes', sourceClass: 'scientific', metadata: { seismicType: 'earthquake', magnitude: 4.6 } }),
      ev({ title: 'Can Pochettino save Man United from relegation?', sourceUrl: 'https://www.aljazeera.com/sports/2026/11/21/x', sourceId: 'aljazeera' }),
      ev({ title: 'Old story', publishedAt: new Date(NOW - 40 * 3_600_000).toISOString(), regionIds: ['middle-east'] }),
    ];
    const b = buildBrief(snap(events), NOW);
    const sec = (title: string) => b.sections.find((s) => s.title.startsWith(title))!;
    expect(sec('Regional').lines[0].text).toBe('Middle East: 20 INCREASED (▲ +6 in 24 h)');
    expect(sec('Official').lines.map((l) => l.text)).toEqual(['Earthquake M6.7 — Peru']);
    expect(sec('Top stories').lines[0].text).toMatch(/^Denmark .* — 2 reports \(Al Jazeera, BBC News\)$/);
    expect(JSON.stringify(b)).not.toContain('Pochettino'); // off-topic
    expect(JSON.stringify(b)).not.toContain('Old story'); // outside 24 h
    expect(sec('Active indicators').lines).toEqual([]);
    expect(sec('Active indicators').empty).toMatch(/None/);
  });

  it('treats only real changes and attributed causes as notable', () => {
    expect(isNotableWarning(ev({ title: 'x', sourceId: 'state-travel-advisories', metadata: { change: 'reissued' } }))).toBe(false);
    expect(isNotableWarning(ev({ title: 'x', sourceId: 'state-travel-advisories', metadata: { change: 'raised' } }))).toBe(true);
    expect(isNotableWarning(ev({ title: 'x', sourceId: 'cloudflare-radar-outages', metadata: { outageCause: 'POWER_OUTAGE' } }))).toBe(false);
    expect(isNotableWarning(ev({ title: 'x', sourceId: 'cloudflare-radar-outages', metadata: { outageCause: 'GOVERNMENT_DIRECTED' } }))).toBe(true);
    expect(isNotableWarning(ev({ title: 'x', sourceId: 'usgs-earthquakes', metadata: { seismicType: 'explosion', magnitude: 4.6 } }))).toBe(true);
  });

  it('builds a Discord message within limits, with mentions and markdown neutralised', () => {
    const many = Array.from({ length: 40 }, (_, i) => ev({ title: `@everyone [x](javascript:alert(1)) story ${i} attack`, regionIds: ['middle-east'] }));
    const p = briefToDiscord(buildBrief(snap(many), NOW), 'https://watchtower-b9b2a.web.app');
    const text = JSON.stringify(p.embeds);
    expect(p.embeds.length).toBeLessThanOrEqual(10);
    expect(text.length).toBeLessThan(6000);
    expect(p.allowed_mentions).toEqual({ parse: [] });
    expect(text).not.toMatch(/@everyone/);
    expect(text).not.toContain('](javascript:');
  });
});

describe('daily brief delivery', () => {
  const ok = () => vi.fn(async () => new Response(null, { status: 204 }));

  it('sends once per day, on the first run at or after the hour', async () => {
    const store = new MemoryStore();
    const f = ok();
    const s = snap([]);
    expect(await runDailyBrief(store, s, { now: Date.parse('2026-11-21T10:30:00Z'), webhookUrl: HOOK, fetchImpl: f })).toMatchObject({ sent: false, reason: 'before 11:00 UTC' });
    expect(await runDailyBrief(store, s, { now: NOW, webhookUrl: HOOK, fetchImpl: f })).toEqual({ sent: true });
    expect(await runDailyBrief(store, s, { now: NOW + 1_800_000, webhookUrl: HOOK, fetchImpl: f })).toMatchObject({ reason: 'already sent today' });
    expect(f).toHaveBeenCalledTimes(1);
    expect(await runDailyBrief(store, s, { now: NOW + 24 * 3_600_000, webhookUrl: HOOK, fetchImpl: f })).toEqual({ sent: true });
  });

  it('retries on later runs after a failure, then gives up for the day', async () => {
    const store = new MemoryStore();
    const fail = vi.fn(async () => new Response('no', { status: 500 }));
    for (let i = 0; i < MAX_ATTEMPTS_PER_DAY; i++) {
      const r = await runDailyBrief(store, snap([]), { now: NOW + i * 1_800_000, webhookUrl: HOOK, fetchImpl: fail });
      expect(r).toMatchObject({ sent: false, reason: 'delivery failed', error: 'Discord returned HTTP 500' });
    }
    expect(await runDailyBrief(store, snap([]), { now: NOW + 3 * 1_800_000, webhookUrl: HOOK, fetchImpl: fail })).toMatchObject({ reason: /gave up/ });
    expect(fail).toHaveBeenCalledTimes(MAX_ATTEMPTS_PER_DAY);
  });

  it("a forced test send does not use up the day's scheduled brief", async () => {
    const store = new MemoryStore();
    const f = ok();
    expect(await runDailyBrief(store, snap([]), { now: Date.parse('2026-11-21T07:15:00Z'), webhookUrl: HOOK, fetchImpl: f, force: true })).toEqual({ sent: true });
    expect(await runDailyBrief(store, snap([]), { now: NOW, webhookUrl: HOOK, fetchImpl: f })).toEqual({ sent: true });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('force sends even when already sent, and nothing is sent without a webhook', async () => {
    const store = new MemoryStore();
    const f = ok();
    await runDailyBrief(store, snap([]), { now: NOW, webhookUrl: HOOK, fetchImpl: f });
    expect(await runDailyBrief(store, snap([]), { now: NOW + 60_000, webhookUrl: HOOK, fetchImpl: f, force: true })).toEqual({ sent: true });
    expect(await runDailyBrief(store, snap([]), { now: NOW, webhookUrl: null, fetchImpl: f })).toMatchObject({ reason: 'no Discord webhook configured' });
    expect(f).toHaveBeenCalledTimes(2);
  });
});
