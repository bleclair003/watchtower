import { useCallback, useState } from 'react';
import type { IntelligenceEvent } from '@shared/domain/types';
import type { IndicatorTransition, ScoreHistoryPoint } from '@shared/domain/indicators/types';
import type { AlertRecord } from '@shared/domain/alerts/types';
import type { Incident } from '@shared/domain/incidents/types';
import { useData } from '../state/DataContext';

export interface ArchiveData {
  events: IntelligenceEvent[];
  transitions: IndicatorTransition[];
  raiHistory: ScoreHistoryPoint[];
  alerts: AlertRecord[];
  incidents: Incident[];
  truncated: boolean;
  reads: number;
  /** 'archive' = queried from Firestore; 'dashboard' = demo mode, using what the dashboard already loaded. */
  origin: 'archive' | 'dashboard';
  sinceIso: string;
}

/**
 * Loads recorded history since a point in time. Live: bounded Firestore
 * queries. Demo: the dashboard's already-loaded fixtures (there is no archive).
 */
export function useArchive() {
  const data = useData();
  const [archive, setArchive] = useState<ArchiveData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (sinceIso: string) => {
      setLoading(true);
      setError(null);
      try {
        if (data.mode === 'demo') {
          setArchive({
            events: data.events, transitions: [], raiHistory: data.scoreHistory, alerts: [], incidents: [],
            truncated: false, reads: 0, origin: 'dashboard', sinceIso,
          });
          return;
        }
        const [svc, inc] = await Promise.all([import('./archiveService'), import('./incidentsService')]);
        const [ev, tr, rai, al, incidents] = await Promise.all([
          svc.eventsCollectedSince(sinceIso),
          svc.transitionsSince(sinceIso),
          svc.raiHistorySince(sinceIso),
          svc.alertsSince(sinceIso),
          inc.listIncidents(),
        ]);
        setArchive({
          events: ev.items,
          transitions: tr.items,
          raiHistory: rai.items,
          alerts: al.items,
          incidents,
          truncated: ev.truncated || tr.truncated || rai.truncated,
          reads: ev.reads + tr.reads + rai.reads + al.reads + Math.max(1, incidents.length),
          origin: 'archive',
          sinceIso,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [data.mode, data.events, data.scoreHistory],
  );

  return { archive, loading, error, load };
}
