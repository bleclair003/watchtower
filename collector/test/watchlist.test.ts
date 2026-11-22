// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { compileWatchlist, validateWatchlist, watchItemId, type WatchItem, type Watchlist } from '../../shared/domain/watchlist.ts';
import { runAlerting } from '../alerts/alerting.ts';
import { MemoryStore } from '../store/memory.ts';

const NOW = Date.parse('2026-11-21T14:00:00Z');
const iso = (t: number) => new Date(t).toISOString();
let n = 0;
const ev = (title: string, p: Partial<IntelligenceEvent> = {}): IntelligenceEvent => {
  const id = `e${++n}`;
  return {
    id, contentHash: id, dataOrigin: 'live', sourceId: 'bbc-world', sourceName: 'BBC', sourceClass: 'media', sourceUrl: `https://example.test/${id}`,
    title, category: 'military', regionIds: ['eastern-europe'], countryCodes: [], publishedAt: iso(NOW - 600_000), occurredAt: null, collectedAt: iso(NOW - 60_000),
    credibility: 'single-source', verificationStatus: 'unreviewed', locationPrecision: 'none', ...p,
  };
};
const item = (term: string, p: Partial<WatchItem> = {}): WatchItem => ({ id: watchItemId(term), term, kind: 'term', aliases: [], alert: false, severity: 'ADVISORY', createdAt: iso(NOW - 86_400_000), ...p });
const list = (items: WatchItem[]): Watchlist => ({ items, updatedAt: iso(NOW), version: 1 });

describe('watchlist matching', () => {
  it('whole words in any case, other spellings, and capitals-only acronyms', () => {
    const m = compileWatchlist([item('Wagner', { kind: 'unit', aliases: ['Africa Corps'] }), item('PLA'), item('Kadena', { kind: 'base' })]);
    const terms = (t: string, summary?: string) => m(ev(t, { summary })).map((h) => `${h.item.term}=${h.matched}`);
    expect(terms('WAGNER fighters seen in Mali')).toEqual(['Wagner=Wagner']);
    expect(terms('Russia’s Africa Corps expands', 'More troops')).toEqual(['Wagner=Africa Corps']);
    expect(terms('Wagnerian opera season opens')).toEqual([]); // whole words only
    expect(terms('PLA drills near Taiwan')).toEqual(['PLA=PLA']);
    expect(terms('Explain the plan')).toEqual([]); // "pla" in lower case never counts
    expect(terms('Jets leave base', 'Kadena squadron departs')).toEqual(['Kadena=Kadena']);
  });

  it('validates terms, ids, duplicates, sizes and version', () => {
    expect(validateWatchlist(list([item('Wagner')]))).toEqual([]);
    expect(validateWatchlist(list([item('ab')])).join()).toMatch(/term must be 3–80/);
    expect(validateWatchlist(list([{ ...item('Wagner'), id: 'other' }])).join()).toMatch(/id does not match/);
    expect(validateWatchlist(list([item('Wagner'), item('wagner')])).join()).toMatch(/duplicate/);
    expect(validateWatchlist(list(Array.from({ length: 101 }, (_, i) => item(`Term ${i}`)))).join()).toMatch(/at most 100/);
    expect(validateWatchlist({ ...list([]), version: 0 }).join()).toMatch(/version/);
    expect(validateWatchlist(list([{ ...item('Wagner'), severity: 'LOUD' as never }])).join()).toMatch(/severity/);
  });
});

describe('watchlist alerts in the collector', () => {
  it('one alert per new matching record for items set to alert, with Discord delivery and dedupe', async () => {
    const store = new MemoryStore();
    store.watchlists.set('owner-uid', list([item('Wagner', { alert: true, severity: 'WARNING' }), item('Kadena')]));
    const events = [ev('Wagner convoy crosses border'), ev('Kadena squadron departs'), ev('Unrelated headline')];
    const sent: string[] = [];
    const fetchImpl = (async (_u: string, init?: { body?: string }) => {
      sent.push(String(init?.body));
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const opts = { now: NOW, newEvents: events, transitions: [], previousScores: [], currentScores: [], currentEvaluations: [], previousEvaluatedAt: iso(NOW - 3_600_000), discordWebhookUrl: 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz0123456789ABCD', fetchImpl, sleep: async () => {} };
    const r = await runAlerting(store, opts);
    expect(r).toMatchObject({ activeRules: 1, created: 1, notificationsSent: 1, errors: [] });
    const alerts = [...store.alerts.values()];
    expect(alerts.map((a) => [a.ruleId, a.ruleName, a.severity, a.title])).toEqual([['watch-wagner', 'Watchlist: Wagner', 'WARNING', 'Wagner convoy crosses border']]);
    expect(alerts[0].body).toMatch(/^Watchlist term "Wagner" named as "Wagner"/);
    expect(sent.length).toBe(1);
    // The same record never alerts twice.
    expect((await runAlerting(store, opts)).created).toBe(0);
  });

  it('records from before the item was added never alert; an invalid list is reported, not used', async () => {
    const store = new MemoryStore();
    store.watchlists.set('owner-uid', list([item('Wagner', { alert: true, createdAt: iso(NOW) })]));
    const base = { now: NOW, transitions: [], previousScores: [], currentScores: [], currentEvaluations: [], previousEvaluatedAt: null, discordWebhookUrl: null };
    expect((await runAlerting(store, { ...base, newEvents: [ev('Wagner convoy')] })).created).toBe(0);
    store.watchlists.set('owner-uid', { items: [{ term: 'x' }], updatedAt: iso(NOW), version: 1 });
    const r = await runAlerting(store, { ...base, newEvents: [ev('Wagner convoy')] });
    expect(r.problems[0]).toMatchObject({ ruleId: 'watchlist' });
    expect(r.created).toBe(0);
  });
});

describe('watchlist alerts by role (v0.60.0)', () => {
  const base = { now: NOW, transitions: [], previousScores: [], currentScores: [], currentEvaluations: [], previousEvaluatedAt: null, discordWebhookUrl: null };
  const member = (uid: string, role: string, ownerAccount = false) => ({ uid, email: null, displayName: null, role, ownerAccount, createdAt: iso(NOW), lastSeenAt: iso(NOW) });
  const setup = () => {
    const store = new MemoryStore();
    store.watchlists.set('owner-uid', list([item('Wagner', { alert: true })]));
    store.watchlists.set('editor-uid', list([item('Kadena', { alert: true })]));
    store.watchlists.set('viewer-uid', list([item('Ramstein', { alert: true })]));
    store.watchlists.set('gone-uid', list([item('Incirlik', { alert: true })]));
    return store;
  };
  const events = [ev('Wagner convoy'), ev('Kadena squadron'), ev('Ramstein airlift'), ev('Incirlik flights')];
  const titles = (store: MemoryStore) => [...store.alerts.values()].map((a) => a.title).sort();

  it("only the owner's and editors' lists alert; viewers', blocked and forgotten people's do not", async () => {
    const store = setup();
    store.members.set('owner-uid', member('owner-uid', 'pending', true));
    store.members.set('editor-uid', member('editor-uid', 'editor'));
    store.members.set('viewer-uid', member('viewer-uid', 'viewer'));
    await runAlerting(store, { ...base, newEvents: events });
    expect(titles(store)).toEqual(['Kadena squadron', 'Wagner convoy']);
  });

  it('before the owner has signed in since the upgrade, a list without a member document is the owner’s', async () => {
    const store = setup();
    store.members.set('editor-uid', member('editor-uid', 'editor'));
    store.members.set('viewer-uid', member('viewer-uid', 'viewer'));
    await runAlerting(store, { ...base, newEvents: events });
    expect(titles(store)).toEqual(['Incirlik flights', 'Kadena squadron', 'Wagner convoy']);
  });
});

describe('public run logs', () => {
  it('never contain watchlist terms or rule names', async () => {
    const store = new MemoryStore();
    store.watchlists.set('owner-uid', list([item('Wagner', { alert: true })]));
    store.watchlists.set('other', { items: [{ term: 'Secret Person' }], updatedAt: iso(NOW), version: 1 });
    const lines: string[] = [];
    await runAlerting(store, { now: NOW, newEvents: [ev('Wagner convoy crosses border')], transitions: [], previousScores: [], currentScores: [], currentEvaluations: [], previousEvaluatedAt: null, discordWebhookUrl: null, log: (m) => lines.push(m) });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toMatch(/Wagner|Secret Person/i);
    expect(lines[0]).toMatch(/^ALRT watchlist item [0-9a-f]{6}: 1 new alert/);
  });
});
