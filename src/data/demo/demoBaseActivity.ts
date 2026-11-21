import type { BaseActivitySnapshot } from '@shared/domain/baseActivity';

/** SIMULATED base activity for demo mode and tests (flagged `simulated`). Real installation keys, invented counts. */
export function buildDemoBaseActivity(now: number): BaseActivitySnapshot {
  const iso = (h: number) => new Date(now - h * 3_600_000).toISOString();
  return {
    computedAt: iso(0),
    historyStart: iso(35 * 24),
    historyDays: 35,
    baselineWeeks: 4,
    flagsActive: true,
    simulated: true,
    items: [
      { key: 'dod:Naval Station Norfolk', name: 'Naval Station Norfolk', week: 7, named: 6, nearby: 1, sources: 4, usualPerWeek: 1.5, unusual: true, latestAt: iso(3) },
      { key: 'dod:Fort Knox', name: 'Fort Knox', week: 2, named: 2, nearby: 0, sources: 2, usualPerWeek: 1.8, unusual: false, latestAt: iso(20) },
    ],
  };
}
