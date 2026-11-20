import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { IntelligenceEvent, SourceStatus } from '@shared/domain/types';
import { createRepository, type DataMode, type IntelRepository } from '../data/repository';
import { readStorage, writeStorage } from '../lib/storage';

/** Max events loaded into the dashboard at once (bounded query). */
export const DASHBOARD_EVENT_LIMIT = 500;
/** Lookback for the dashboard's working set. */
const DASHBOARD_LOOKBACK_DAYS = 14;
const LAST_SESSION_KEY = 'wt.lastSessionAt';

interface DataState {
  mode: DataMode;
  events: IntelligenceEvent[];
  sourceStatus: SourceStatus[];
  loading: boolean;
  error: string | null;
  /** When the dashboard last successfully loaded data from the repository. */
  loadedAt: string | null;
  /** When the operator's previous session started (for "new since last session"). */
  previousSessionAt: string | null;
  refresh: () => Promise<void>;
}

const DataContext = createContext<DataState | null>(null);

export function DataProvider({ children, repository }: { children: ReactNode; repository?: IntelRepository }) {
  const [repo] = useState<IntelRepository>(() => repository ?? createRepository());
  const [events, setEvents] = useState<IntelligenceEvent[]>([]);
  const [sourceStatus, setSourceStatus] = useState<SourceStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [previousSessionAt] = useState<string | null>(() => {
    const prev = readStorage<string | null>(LAST_SESSION_KEY, null);
    writeStorage(LAST_SESSION_KEY, new Date().toISOString());
    return prev;
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const since = new Date(Date.now() - DASHBOARD_LOOKBACK_DAYS * 86_400_000).toISOString();
      const [ev, st] = await Promise.all([
        repo.listEvents({ since, limit: DASHBOARD_EVENT_LIMIT }),
        repo.listSourceStatus(),
      ]);
      setEvents(ev);
      setSourceStatus(st);
      setLoadedAt(new Date().toISOString());
      setError(null);
    } catch (err) {
      // Never fail silently: surface the error in the status bar and diagnostics.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [repo]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<DataState>(
    () => ({
      mode: repo.mode,
      events,
      sourceStatus,
      loading,
      error,
      loadedAt,
      previousSessionAt,
      refresh,
    }),
    [repo, events, sourceStatus, loading, error, loadedAt, previousSessionAt, refresh],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataState {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used inside <DataProvider>');
  return ctx;
}
