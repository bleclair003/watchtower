import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_FILTERS, type DashboardFilters } from '../lib/filters';

/**
 * Shared dashboard state: filters, selected event, and map view requests.
 * Lives above the router so the command console (in the top bar) can drive it
 * from any page.
 */
interface DashboardState {
  filters: DashboardFilters;
  setFilters: (patch: Partial<DashboardFilters>) => void;
  resetFilters: () => void;
  selectedEventId: string | null;
  selectEvent: (id: string | null) => void;
  /** Incremented to ask the map to return to the global view. */
  globalViewNonce: number;
  requestGlobalView: () => void;
}

const DashboardContext = createContext<DashboardState | null>(null);

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [filters, setFiltersState] = useState<DashboardFilters>(DEFAULT_FILTERS);
  const [selectedEventId, selectEvent] = useState<string | null>(null);
  const [globalViewNonce, setNonce] = useState(0);

  const setFilters = useCallback((patch: Partial<DashboardFilters>) => {
    setFiltersState((f) => ({ ...f, ...patch }));
  }, []);
  const resetFilters = useCallback(() => setFiltersState(DEFAULT_FILTERS), []);
  const requestGlobalView = useCallback(() => {
    setFiltersState((f) => ({ ...f, regionId: null }));
    setNonce((n) => n + 1);
  }, []);

  const value = useMemo(
    () => ({ filters, setFilters, resetFilters, selectedEventId, selectEvent, globalViewNonce, requestGlobalView }),
    [filters, setFilters, resetFilters, selectedEventId, globalViewNonce, requestGlobalView],
  );
  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export function useDashboard(): DashboardState {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error('useDashboard must be used inside <DashboardProvider>');
  return ctx;
}
