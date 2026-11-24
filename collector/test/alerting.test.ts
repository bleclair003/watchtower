// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import type { AlertRule } from '../../shared/domain/alerts/types.ts';
import type { SourceAdapter } from '../adapters/types.ts';
import { runCollection } from '../pipeline.ts';
import { MemoryStore } from '../store/memory.ts';
import { contentHash } from '../lib/hash.ts';
import { buildDiscordPayload, escapeDiscord, isDiscordWebhookUrl, sendDiscord } from '../alerts/discord.ts';

const NOW = Date.parse('2026-12-20T12:00:00Z');
const HOOK = 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_ABCDEFG-123';

function ev(n: number, p: Partial<IntelligenceEvent> = {}): IntelligenceEvent {
  const id = contentHash('alert-test', n);
  return {
    id, contentHash: id, dataOrigin: 'live', sourceId: 'state-travel-advisories', sourceName: 'State', sourceClass: 'official',
    sourceUrl: `https://travel.state.gov/${n}`, title: `Yemen advisory ${n} @everyone`, summary: 'Summary', category: 'diplomatic',
    regionIds: ['red-sea'], countryCodes: ['YE'], publishedAt: new Date(NOW - 60_000).toISOString(), collectedAt: new Date(NOW).toISOString(),
    credibility: 'official', verificationStatus: 'unreviewed', locationPrecision: 'country', ...p,
  };
}

const adapter = (events: () => IntelligenceEvent[]): SourceAdapter<never> => ({
  sourceId: 'state-travel-advisories',
  async collect() {
    const e = events();
    return { events: e, rejected: [], itemsSeen: e.length, notModified: false, state: {} as never };
  },
});

const rule = (p: Partial<AlertRule> = {}): AlertRule => ({
  id: 'redsea', name: 'Red Sea advisories', enabled: true, severity: 'WARNING',
  trigger: { kind: 'event', match: { field: 'regionIds', op: 'contains', value: 'red-sea' } },
  notify: { discord: true }, cooldownMinutes: 60, version: 1,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...p,
});

const okFetch = () => vi.fn(async () => new Response(null, { status: 204 }));

async function run(store: MemoryStore, events: IntelligenceEvent[], at: number, fetchImpl?: typeof fetch, webhook: string | null = HOOK) {
  return runCollection([adapter(() => events)], store, { trigger: 'local', now: () => at, discordWebhookUrl: webhook, alertFetch: fetchImpl });
}

describe('alerting pipeline', () => {
  it('creates one alert per new matching event and notifies Discord once; unchanged input never re-alerts', async () => {
    const store = new MemoryStore();
    store.alertRules.set('redsea', rule());
    const fetchImpl = okFetch();
    const r1 = await run(store, [ev(1), ev(2, { regionIds: ['korean-peninsula'] })], NOW, fetchImpl);
    expect(r1.run).toMatchObject({ alertsCreated: 1, notificationsSent: 1 });
    expect([...store.alerts.values()][0]).toMatchObject({ severity: 'WARNING', url: 'https://travel.state.gov/1', delivery: { discord: 'sent' } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // Same feed again: the event is a duplicate, so nothing new can alert.
    const r2 = await run(store, [ev(1)], NOW + 7_200_000, fetchImpl);
    expect(r2.run.alertsCreated).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(store.alerts.size).toBe(1);
  });

  it('batches a run into one message per rule and neutralizes mentions', async () => {
    const store = new MemoryStore();
    store.alertRules.set('redsea', rule());
    const fetchImpl = okFetch();
    await run(store, [ev(1), ev(2), ev(3)], NOW, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(body.embeds).toHaveLength(3);
    expect(body.embeds[0].title).not.toContain('@everyone');
    expect(body.embeds[0].footer.text).toMatch(/not an official warning/);
  });

  it('records but does not notify during the cooldown', async () => {
    const store = new MemoryStore();
    store.alertRules.set('redsea', rule({ cooldownMinutes: 120 }));
    const fetchImpl = okFetch();
    await run(store, [ev(1)], NOW, fetchImpl);
    const r = await run(store, [ev(2)], NOW + 30 * 60_000, fetchImpl);
    expect(r.run).toMatchObject({ alertsCreated: 1, notificationsSent: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(store.alerts.get(contentHash('alert', 'redsea', `event:${ev(2).contentHash}`))!.delivery.discord).toBe('suppressed-cooldown');
    // After the cooldown, notifications resume.
    await run(store, [ev(3)], NOW + 3 * 3_600_000, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('marks delivery not-configured without a webhook, and not-requested when the rule opts out', async () => {
    const store = new MemoryStore();
    store.alertRules.set('redsea', rule());
    store.alertRules.set('quiet', rule({ id: 'quiet', name: 'Quiet', notify: { discord: false } }));
    const r = await run(store, [ev(1)], NOW, undefined, null);
    expect(r.snapshot.discordConfigured).toBe(false);
    const statuses = [...store.alerts.values()].map((a) => `${a.ruleId}:${a.delivery.discord}`).sort();
    expect(statuses).toEqual(['quiet:not-requested', 'redsea:not-configured']);
  });

  it('reports invalid rules instead of evaluating them, and ignores disabled ones', async () => {
    const store = new MemoryStore();
    store.alertRules.set('bad', { ...rule({ id: 'bad', name: 'Bad rule' }), trigger: { kind: 'event', match: { field: 'nope', op: 'eq', value: 1 } } });
    store.alertRules.set('off', rule({ id: 'off', enabled: false }));
    const r = await run(store, [ev(1)], NOW, okFetch());
    expect(r.snapshot.alertRuleProblems).toEqual([expect.objectContaining({ ruleId: 'bad', ruleName: 'Bad rule' })]);
    expect(r.snapshot.activeAlertRules).toBe(0);
    expect(store.alerts.size).toBe(0);
  });

  it('keeps the alert, marks delivery failed, and reports the error without leaking the webhook', async () => {
    const store = new MemoryStore();
    store.alertRules.set('redsea', rule());
    const failing = vi.fn(async () => new Response('nope', { status: 401 }));
    const r = await run(store, [ev(1)], NOW, failing);
    expect(store.alerts.size).toBe(1);
    expect([...store.alerts.values()][0].delivery).toMatchObject({ discord: 'failed', error: 'Discord returned HTTP 401' });
    expect(r.run.errors).toEqual([expect.objectContaining({ sourceId: 'alert-delivery' })]);
    expect(JSON.stringify(r.run) + JSON.stringify([...store.alerts.values()])).not.toContain('abcdefghijklmnop');
  });

  it('fires indicator rules on state transitions, once per state entry', async () => {
    const store = new MemoryStore();
    store.alertRules.set('ind', rule({ id: 'ind', trigger: { kind: 'indicator', indicatorIds: ['red-sea.advisory-raised'], states: ['TRIGGERED'] } }));
    await run(store, [], NOW - 3_600_000, okFetch()); // baseline evaluation: indicator NORMAL
    const raised = ev(1, { metadata: { change: 'raised' } });
    const r = await run(store, [raised], NOW, okFetch());
    expect(r.run.alertsCreated).toBe(1);
    expect([...store.alerts.values()][0].title).toBe('REDSEA travel advisory raised: NORMAL → TRIGGERED');
    // Still TRIGGERED next hour: no new alert.
    const again = await run(store, [], NOW + 3_600_000, okFetch());
    expect(again.run.alertsCreated).toBe(0);
  });

  it('a rule created while its indicator is already TRIGGERED alerts once, then stays quiet', async () => {
    const store = new MemoryStore();
    await run(store, [ev(1, { metadata: { change: 'raised' } })], NOW, okFetch()); // indicator TRIGGERED, no rules yet
    store.alertRules.set(
      'late',
      rule({ id: 'late', createdAt: new Date(NOW + 60_000).toISOString(), trigger: { kind: 'indicator', indicatorIds: ['red-sea.advisory-raised'], states: ['TRIGGERED'] } }),
    );
    const first = await run(store, [], NOW + 3_600_000, okFetch());
    expect(first.run.alertsCreated).toBe(1);
    expect([...store.alerts.values()][0].title).toBe('REDSEA travel advisory raised: TRIGGERED');
    const second = await run(store, [], NOW + 7_200_000, okFetch());
    expect(second.run.alertsCreated).toBe(0);
  });
});

describe('discord helpers', () => {
  it('accepts only genuine Discord webhook URLs', () => {
    expect(isDiscordWebhookUrl(HOOK)).toBe(true);
    expect(isDiscordWebhookUrl('https://canary.discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz')).toBe(true);
    expect(isDiscordWebhookUrl('http://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz')).toBe(false);
    expect(isDiscordWebhookUrl('https://evil.example/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz')).toBe(false);
    expect(isDiscordWebhookUrl('https://discord.com.evil.example/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz')).toBe(false);
  });

  it('escapes markdown and mentions', () => {
    expect(escapeDiscord('**bold** @here <@123> [x](y)')).not.toMatch(/(^|[^\\])\*\*|@here|<@/);
  });

  it('summarizes more than 10 alerts in one message', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({
      id: String(i), ruleId: 'r', ruleName: 'R', ruleVersion: 1, severity: 'ADVISORY' as const, title: `T${i}`, body: '', regionIds: [],
      url: '', evidenceEventIds: [], dedupeKey: String(i), createdAt: new Date(NOW).toISOString(), acknowledged: false,
      acknowledgedAt: null, dismissed: false, dismissedAt: null, delivery: { discord: 'pending' as const, at: null, error: null },
    }));
    const p = buildDiscordPayload({ name: 'R', severity: 'ADVISORY' }, many, 'https://watchtower.example');
    expect(p.embeds).toHaveLength(10);
    expect(p.embeds[9].title).toBe('+5 more alert(s) from this rule');
  });

  it('retries once after a 429 using retry_after', async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ retry_after: 1.5 }), { status: 429 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await sendDiscord(HOOK, buildDiscordPayload({ name: 'R', severity: 'INFORMATION' }, []), { fetchImpl, sleep });
    expect(sleep).toHaveBeenCalledWith(1500);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('refuses to send to a non-Discord URL', async () => {
    await expect(sendDiscord('https://example.com/hook', buildDiscordPayload({ name: 'R', severity: 'INFORMATION' }, []))).rejects.toThrow(/not a Discord webhook/);
  });
});

describe('corroboration (v0.72.0)', () => {
  // Invented headlines. Both feeds are story sources (media).
  const news = (sourceId: string, n: number, title: string, at: number, summary = ''): IntelligenceEvent => {
    const id = contentHash('cor-test', sourceId, n);
    return {
      id, contentHash: id, dataOrigin: 'live', sourceId, sourceName: `${sourceId} — feed`, sourceClass: 'media', sourceUrl: `https://example.test/${id}`,
      title, summary, category: 'maritime', regionIds: ['middle-east'], countryCodes: [], publishedAt: new Date(at - 60_000).toISOString(),
      collectedAt: new Date(at).toISOString(), credibility: 'single-source', verificationStatus: 'unreviewed', locationPrecision: 'none',
    };
  };
  const feed = (sourceId: string, items: () => IntelligenceEvent[]): SourceAdapter<never> => ({
    sourceId,
    async collect() {
      const e = items().filter((x) => x.sourceId === sourceId);
      return { events: e, rejected: [], itemsSeen: e.length, notModified: false, state: {} as never };
    },
  });
  const tankerRule = rule({ id: 'tankers', name: 'Tankers', trigger: { kind: 'event', match: { field: 'title', op: 'contains', value: 'tanker' } } });
  const H = 3_600_000;
  const go = (store: MemoryStore, items: IntelligenceEvent[], at: number, fetchImpl: typeof fetch) =>
    runCollection([feed('bbc-world', () => items), feed('aljazeera', () => items)], store, { trigger: 'local', now: () => at, discordWebhookUrl: HOOK, alertFetch: fetchImpl });

  it('raises one follow-up a level higher when an independent outlet reports it, and notes it on the original', async () => {
    const store = new MemoryStore();
    store.alertRules.set('tankers', tankerRule);
    const fetchImpl = okFetch();
    const a = news('bbc-world', 1, 'Testland navy seizes tanker near Testport strait', NOW);
    await go(store, [a], NOW, fetchImpl);
    const first = [...store.alerts.values()][0];
    expect(first.severity).toBe('WARNING');
    expect((await store.getAlertingState())?.watching).toHaveLength(1);

    const b = news('aljazeera', 2, 'Testland navy seizes oil tanker in Testport strait', NOW + 2 * H);
    const r = await go(store, [a, b], NOW + 2 * H, fetchImpl);
    const all = [...store.alerts.values()];
    const follow = all.filter((x) => x.corroboration?.upgradeOf);
    expect(follow).toHaveLength(1);
    expect(follow[0]).toMatchObject({ severity: 'CRITICAL', title: 'Corroborated: Testland navy seizes tanker near Testport strait', delivery: { discord: 'sent' } });
    expect(follow[0].body).toMatch(/2 independent origins/);
    expect(store.alerts.get(first.id)?.corroboration).toMatchObject({ status: 'corroborated', upgradeId: follow[0].id });
    expect(r.run.alertsCreated).toBe(2); // the second outlet's own alert, and the follow-up
    expect((await store.getAlertingState())?.watching ?? []).toHaveLength(0);
  });

  it('does not count a second outlet carrying the same agency copy, and marks the alert unconfirmed after 72 hours', async () => {
    const store = new MemoryStore();
    store.alertRules.set('tankers', tankerRule);
    const fetchImpl = okFetch();
    const a = news('bbc-world', 3, 'Testland navy seizes tanker near Testport strait', NOW, 'The navy boarded it, Reuters reported.');
    const b = news('aljazeera', 4, 'Testland navy seizes oil tanker in Testport strait', NOW + H, 'According to Reuters, it was escorted to port.');
    await go(store, [a], NOW, fetchImpl);
    await go(store, [a, b], NOW + H, fetchImpl);
    expect([...store.alerts.values()].some((x) => x.corroboration?.upgradeOf)).toBe(false);
    await go(store, [a, b], NOW + 73 * H, fetchImpl);
    const original = [...store.alerts.values()].find((x) => x.evidenceEventIds[0] === a.id)!;
    expect(original.corroboration).toMatchObject({ status: 'unconfirmed', sharedOrigins: ['Reuters'] });
  });

  it('does not watch alerts resting on official or structured records', async () => {
    const store = new MemoryStore();
    store.alertRules.set('redsea', rule());
    await run(store, [ev(90)], NOW, okFetch());
    expect((await store.getAlertingState())?.watching ?? []).toHaveLength(0);
  });
});
