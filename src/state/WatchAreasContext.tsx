import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { validateWatchArea, WATCH_AREA_LIMITS, type WatchArea } from '@shared/domain/watchAreas';
import { readStorage, writeStorage } from '../lib/storage';
import { useAuth } from './AuthContext';
import { useData } from './DataContext';

const DEMO_KEY = 'watchtower.watchAreas.demo';

interface WatchAreasState {
  areas: WatchArea[];
  /** 'local' in demo mode (this browser only); 'cloud' in Firestore, shared with every member. */
  storage: 'local' | 'cloud' | 'unavailable';
  canEdit: boolean;
  loading: boolean;
  error: string | null;
  /** Creates or updates (the caller bumps `version`). */
  save: (a: WatchArea) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

const Ctx = createContext<WatchAreasState | null>(null);

/** Watch areas (v0.74.0): Firestore when live, this browser's storage in demo mode. */
export function WatchAreasProvider({ children }: { children: ReactNode }) {
  const { mode } = useData();
  const { user, can } = useAuth();
  const storage: WatchAreasState['storage'] = mode === 'demo' ? 'local' : user ? 'cloud' : 'unavailable';
  const canEdit = storage === 'local' || (storage === 'cloud' && can('editIncidents'));
  const [areas, setAreas] = useState<WatchArea[]>([]);
  const [loading, setLoading] = useState(storage === 'cloud');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    if (storage === 'local') {
      setAreas(readStorage<WatchArea[]>(DEMO_KEY, []).filter((a) => validateWatchArea(a).length === 0));
      setLoading(false);
    } else if (storage === 'cloud') {
      setLoading(true);
      import('../data/watchAreasService')
        .then((svc) => svc.listWatchAreas())
        .then((list) => live && setAreas(list))
        .catch((e: Error) => live && setError(`Watch areas not loaded: ${e.message}`))
        .finally(() => live && setLoading(false));
    }
    return () => {
      live = false;
    };
  }, [storage]);

  const save = useCallback(
    async (a: WatchArea) => {
      const problems = validateWatchArea(a);
      if (problems.length) throw new Error(problems.join(' '));
      if (!areas.some((x) => x.id === a.id) && areas.length >= WATCH_AREA_LIMITS.areas) throw new Error(`At most ${WATCH_AREA_LIMITS.areas} areas.`);
      setError(null);
      const next = [...areas.filter((x) => x.id !== a.id), a].sort((x, y) => x.name.localeCompare(y.name));
      if (storage === 'local') writeStorage(DEMO_KEY, next);
      else if (storage === 'cloud') {
        const svc = await import('../data/watchAreasService');
        await svc.saveWatchArea(a);
      } else throw new Error('Sign in to keep watch areas.');
      setAreas(next);
    },
    [areas, storage],
  );

  const remove = useCallback(
    async (id: string) => {
      const next = areas.filter((x) => x.id !== id);
      if (storage === 'local') writeStorage(DEMO_KEY, next);
      else if (storage === 'cloud') {
        const svc = await import('../data/watchAreasService');
        await svc.deleteWatchArea(id);
      }
      setAreas(next);
    },
    [areas, storage],
  );

  const value = useMemo(() => ({ areas, storage, canEdit, loading, error, save, remove }), [areas, storage, canEdit, loading, error, save, remove]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWatchAreas(): WatchAreasState {
  return (
    useContext(Ctx) ?? { areas: [], storage: 'unavailable', canEdit: false, loading: false, error: null, save: async () => {}, remove: async () => {} }
  );
}
