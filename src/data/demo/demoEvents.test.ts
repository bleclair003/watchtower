import { describe, expect, it } from 'vitest';
import { WATCH_REGIONS } from '@shared/domain/regions';
import { buildDemoEvents } from './demoEvents';
import { DemoRepository } from '../repository';

const NOW = Date.parse('2026-11-20T12:00:00Z');

/** Guards the "no fabricated data presented as real" requirement. */
describe('demo dataset integrity', () => {
  const events = buildDemoEvents(NOW);

  it('marks every record as demo, with a [SIMULATED] title and DEMO source name', () => {
    for (const e of events) {
      expect(e.dataOrigin).toBe('demo');
      expect(e.title.startsWith('[SIMULATED] ')).toBe(true);
      expect(e.sourceName.startsWith('DEMO')).toBe(true);
      expect(e.sourceUrl).toBe('');
    }
  });

  it('never attaches coordinates to country/region/none precision records', () => {
    for (const e of events) {
      if (e.locationPrecision === 'exact' || e.locationPrecision === 'city') {
        expect(typeof e.latitude).toBe('number');
      } else {
        expect(e.latitude).toBeUndefined();
        expect(e.longitude).toBeUndefined();
      }
    }
  });

  it('has unique ids, valid regions, and collection never before publication', () => {
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
    const ids = new Set(WATCH_REGIONS.map((r) => r.id));
    for (const e of events) {
      e.regionIds.forEach((r) => expect(ids.has(r)).toBe(true));
      expect(Date.parse(e.collectedAt)).toBeGreaterThanOrEqual(Date.parse(e.publishedAt!));
      expect(Date.parse(e.collectedAt)).toBeLessThanOrEqual(NOW);
    }
  });
});

describe('DemoRepository', () => {
  it('returns only demo events and reports every source as NOT_CONFIGURED with no collector run', async () => {
    const repo = new DemoRepository(NOW);
    const d = await repo.loadDashboard();
    expect(d.events.length).toBeGreaterThan(0);
    expect(d.events.every((e) => e.dataOrigin === 'demo')).toBe(true);
    expect(d.sourceStatus.every((s) => s.health === 'NOT_CONFIGURED' && s.lastSuccessAt === null)).toBe(true);
    expect(d).toMatchObject({ lastRun: null, generatedAt: null });
    expect(repo.readsThisSession()).toBeNull();
  });
});
