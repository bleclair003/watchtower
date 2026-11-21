import type { IntelligenceEvent } from '@shared/domain/types';
import type { DashboardData } from '../repository';
import { computeMeters } from '@shared/domain/meters/index';
import type { MetersSnapshot } from '@shared/domain/meters/types';

/**
 * Demo meters: the real meter engine run over the demo fixtures (flagged `simulated`). Demo
 * records are not real collected sources, so most meters read quiet or building.
 */
export function buildDemoMeters(now: number, events: IntelligenceEvent[], data: Omit<DashboardData, 'meters'>): MetersSnapshot {
  const historyStart = events.reduce((m, e) => Math.min(m, Date.parse(e.collectedAt)), Infinity);
  const m = computeMeters({
    now,
    events,
    historyStart: Number.isFinite(historyStart) ? historyStart : null,
    sourceStatus: data.sourceStatus,
    regionScores: data.regionScores,
    scoreHistory: data.scoreHistory,
    aircraft: data.aircraft,
    fleet: data.fleet,
    chokepoints: data.chokepoints,
    powerOutages: data.powerOutages,
    tfrs: data.tfrs,
    airportStatus: data.airportStatus,
    airspaceNotices: data.airspaceNotices,
    sanctionedShips: data.sanctionedShips,
    displacement: data.displacement,
    predictionMarkets: data.predictionMarkets,
    infrastructure: data.infrastructure,
    actors: data.actors,
    upcomingLaunches: [
      { name: '[SIMULATED] Demo launcher | Classified payload', net: new Date(now + 3 * 86_400_000).toISOString(), provider: 'Demo Space Force', country: null, status: 'Go for Launch', url: null },
    ],
  });
  return { ...m, simulated: true };
}
