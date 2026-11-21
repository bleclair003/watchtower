import type { InfrastructureSnapshot } from '@shared/domain/infrastructure';

/** SIMULATED infrastructure flag for demo mode and tests (flagged `simulated`). An invented site and records. */
export function buildDemoInfrastructure(now: number): InfrastructureSnapshot {
  const at = (h: number) => new Date(now - h * 3_600_000).toISOString();
  return {
    computedAt: at(0),
    windowHours: 72,
    sitesChecked: 941,
    simulated: true,
    flagged: [
      {
        id: 'demo:nuclear-1',
        name: '[SIMULATED] Demo Nuclear Power Plant',
        type: 'nuclear',
        country: 'UA',
        lat: 47.4,
        lon: 34.4,
        regionIds: ['eastern-europe'],
        near: 1,
        named: 1,
        latestAt: at(3),
        matches: [
          { title: '[SIMULATED] New thermal-anomaly cluster near the demo plant', url: 'https://example.invalid/demo-fire', at: at(3), how: 'near', km: 6.2, kind: 'fire' },
          { title: '[SIMULATED] Drone strike reported near Demo nuclear plant', url: 'https://example.invalid/demo-news', at: at(5), how: 'named', kind: 'strike' },
        ],
      },
    ],
  };
}
