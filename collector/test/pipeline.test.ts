// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import type { SourceAdapter } from '../adapters/types.ts';
import { runCollection } from '../pipeline.ts';
import { MemoryStore } from '../store/memory.ts';
import { SNAPSHOT_MAX_EVENTS } from '../../shared/domain/snapshot.ts';
import { contentHash } from '../lib/hash.ts';
import { INDICATOR_CATALOG } from '../../shared/domain/indicators/catalog.ts';

const NOW = Date.parse('2026-11-20T12:00:00Z');

function ev(n: number, patch: Partial<IntelligenceEvent> = {}): IntelligenceEvent {
  const id = contentHash('test', n);
  return {
    id, contentHash: id, dataOrigin: 'live', sourceId: 'cisa-kev', sourceName: 'Test', sourceClass: 'official',
    sourceUrl: `https://example.gov/${n}`, title: `Item ${n}`, category: 'cyber', regionIds: ['global-cyber'],
    countryCodes: [], publishedAt: new Date(NOW - n * 60_000).toISOString(), collectedAt: new Date(NOW).toISOString(),
    credibility: 'official', verificationStatus: 'unreviewed', locationPrecision: 'none', ...patch,
  };
}

function adapter(sourceId: string, produce: () => IntelligenceEvent[] | Promise<IntelligenceEvent[]>): SourceAdapter<never> {
  return {
    sourceId,
    async collect() {
      const events = await produce();
      return { events, rejected: [], itemsSeen: events.length, notModified: false, state: { ok: true } as never };
    },
  };
}

const failing = (sourceId: string): SourceAdapter<never> => ({
  sourceId,
  async collect() {
    throw new Error('HTTP 503 from https://example.gov/feed?token=SECRET123');
  },
});

describe('runCollection', () => {
  it('is idempotent: a second run over the same items imports nothing', async () => {
    const store = new MemoryStore();
    const a = adapter('cisa-kev', () => [ev(1), ev(2), ev(3)]);
    const r1 = await runCollection([a], store, { trigger: 'local', now: () => NOW });
    const r2 = await runCollection([a], store, { trigger: 'local', now: () => NOW + 3_600_000 });
    expect(r1.run.recordsImported).toBe(3);
    expect(r2.run.recordsImported).toBe(0);
    expect(r2.run.duplicatesSuppressed).toBe(3);
    expect(store.events.size).toBe(3);
    expect(store.runs).toHaveLength(2);
  });

  it('suppresses duplicates within a single batch', async () => {
    const store = new MemoryStore();
    const r = await runCollection([adapter('cisa-kev', () => [ev(1), ev(1)])], store, { trigger: 'local', now: () => NOW });
    expect(r.reports[0]).toMatchObject({ imported: 1, duplicates: 1 });
  });

  it('rejects invalid events instead of writing them', async () => {
    const store = new MemoryStore();
    const bad = [
      ev(10, { sourceUrl: 'javascript:alert(1)' }),
      ev(11, { dataOrigin: 'demo' }),
      ev(12, { locationPrecision: 'country', latitude: 10, longitude: 10 }),
      ev(13, { regionIds: ['atlantis'] }),
      ev(14, { countryCodes: ['RS-'] }),
    ];
    const r = await runCollection([adapter('cisa-kev', () => [...bad, ev(15)])], store, { trigger: 'local', now: () => NOW });
    expect(r.reports[0]).toMatchObject({ imported: 1, rejected: 5 });
    expect([...store.events.keys()]).toEqual([ev(15).id]);
  });

  it('isolates failures, escalates health, and redacts secrets from stored errors', async () => {
    const store = new MemoryStore();
    const adapters = [failing('state-travel-advisories'), adapter('cisa-kev', () => [ev(1)])];
    for (let i = 0; i < 3; i++) await runCollection(adapters, store, { trigger: 'schedule', now: () => NOW + i * 3_600_000 });

    const broken = store.sourceStatus.get('state-travel-advisories')!;
    expect(broken.health).toBe('OFFLINE');
    expect(broken.consecutiveFailures).toBe(3);
    expect(broken.lastSuccessAt).toBeNull();
    expect(broken.lastError).not.toContain('SECRET123');
    expect(store.sourceStatus.get('cisa-kev')!.health).toBe('ONLINE');
    expect(store.runs[0].errors).toHaveLength(1);
  });

  it('recovers health after a success', async () => {
    const store = new MemoryStore();
    let fail = true;
    const flaky: SourceAdapter<never> = {
      sourceId: 'cisa-kev',
      async collect() {
        if (fail) throw new Error('boom');
        return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: {} as never };
      },
    };
    await runCollection([flaky], store, { trigger: 'local', now: () => NOW });
    expect(store.sourceStatus.get('cisa-kev')!.health).toBe('DEGRADED');
    fail = false;
    await runCollection([flaky], store, { trigger: 'local', now: () => NOW + 1000 });
    expect(store.sourceStatus.get('cisa-kev')).toMatchObject({ health: 'ONLINE', consecutiveFailures: 0, lastError: null });
  });

  it('builds a snapshot that is newest-first and fits the document size limit', async () => {
    const store = new MemoryStore();
    const big = Array.from({ length: 600 }, (_, i) => ev(i, { summary: 'x'.repeat(590) }));
    const r = await runCollection([adapter('cisa-kev', () => big)], store, { trigger: 'local', now: () => NOW });
    const bytes = Buffer.byteLength(JSON.stringify(r.snapshot));
    expect(bytes).toBeLessThanOrEqual(900_000);
    expect(r.snapshot.events.length).toBeLessThanOrEqual(SNAPSHOT_MAX_EVENTS);
    expect(r.snapshot.events[0].id).toBe(ev(0).id);
    expect(r.snapshot.totalEventsStored).toBe(600);
    expect(r.snapshot.lastRun?.recordsImported).toBe(600);
    expect(r.snapshot.sourceStatus.map((s) => s.sourceId)).toEqual(['cisa-kev']);
  });

  it('evaluates indicators, scores regions and logs transitions only on change', async () => {
    const store = new MemoryStore();
    const kev = (i: number) => ev(100 + i, { sourceId: 'cisa-kev', metadata: { knownRansomwareUse: true } });
    const a = adapter('cisa-kev', () => [kev(1), kev(2), kev(3)]);
    const r1 = await runCollection([a], store, { trigger: 'local', now: () => NOW });
    const ransomware = r1.snapshot.indicatorEvaluations!.find((e) => e.indicatorId === 'global-cyber.kev-ransomware')!;
    expect(ransomware.state).toBe('TRIGGERED');
    expect(ransomware.evidenceEventIds).toHaveLength(3);
    // State Dept was never collected in this store → its indicators are DATA_UNAVAILABLE, not NORMAL.
    expect(r1.snapshot.indicatorEvaluations!.find((e) => e.indicatorId === 'red-sea.advisory-raised')!.state).toBe('DATA_UNAVAILABLE');
    const cyber = r1.snapshot.regionScores!.find((s) => s.regionId === 'global-cyber')!;
    expect(cyber.score).toBeGreaterThan(0);
    expect(r1.snapshot.regionScores!.find((s) => s.regionId === 'red-sea')!.score).toBeNull();
    expect(r1.snapshot.scoreHistory).toHaveLength(1);
    const firstTransitions = store.transitions.length;
    expect(firstTransitions).toBeGreaterThan(0);

    await runCollection([a], store, { trigger: 'local', now: () => NOW + 3_600_000 });
    expect(store.transitions.length).toBe(firstTransitions); // unchanged states → no new log entries
    expect(store.snapshot!.scoreHistory).toHaveLength(2);
    expect(store.raiPoints).toHaveLength(2); // long-term RAI history, one point per run
  });

  it('records firstSuccessAt once and keeps it', async () => {
    const store = new MemoryStore();
    const a = adapter('cisa-kev', () => []);
    await runCollection([a], store, { trigger: 'local', now: () => NOW });
    await runCollection([a], store, { trigger: 'local', now: () => NOW + 7_200_000 });
    expect(store.sourceStatus.get('cisa-kev')!.firstSuccessAt).toBe(new Date(NOW).toISOString());
  });

  it('isolates an indicator-engine failure: snapshot still written, error recorded, prior states kept', async () => {
    const store = new MemoryStore();
    const a = adapter('cisa-kev', () => [ev(1)]);
    await runCollection([a], store, { trigger: 'local', now: () => NOW });
    const before = store.snapshot!.indicatorEvaluations!;
    // A KEV indicator (source is healthy here) so evaluation reaches the malformed condition.
    const broken = [{ ...INDICATOR_CATALOG.find((d) => d.id === 'global-cyber.kev-surge')!, match: null as never }];
    const r = await runCollection([adapter('cisa-kev', () => [ev(2)])], store, { trigger: 'local', now: () => NOW + 1000, catalog: broken });
    expect(r.run.errors).toEqual([expect.objectContaining({ sourceId: 'indicator-engine' })]);
    expect(r.snapshot.events.map((e) => e.id)).toContain(ev(2).id);
    expect(r.snapshot.indicatorEvaluations).toEqual(before);
  });

  it('evaluate-only mode fetches nothing but still reports tracked source status', async () => {
    const store = new MemoryStore();
    await runCollection([adapter('cisa-kev', () => [ev(1)])], store, { trigger: 'local', now: () => NOW });
    const r = await runCollection([], store, { trigger: 'manual', mode: 'evaluate-only', trackedSourceIds: ['cisa-kev'], now: () => NOW + 1000 });
    expect(r.run).toMatchObject({ mode: 'evaluate-only', recordsFetched: 0 });
    expect(r.snapshot.sourceStatus.map((s) => s.sourceId)).toEqual(['cisa-kev']);
    expect(r.snapshot.events).toHaveLength(1);
  });
});

