import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { IntelligenceEvent } from '@shared/domain/types';
import { EMPTY_WATCHLIST, compileWatchlist, type WatchHit, type WatchItem, type Watchlist } from '@shared/domain/watchlist';
import { readStorage, writeStorage } from '../lib/storage';
import { useAuth } from './AuthContext';
import { useData } from './DataContext';

const DEMO_KEY = 'watchtower.watchlist.demo';

interface WatchlistState {
  list: Watchlist;
  /** 'local' in demo mode (this browser only); 'cloud' when stored in Firestore for the signed-in owner. */
  storage: 'local' | 'cloud' | 'unavailable';
  loading: boolean;
  error: string | null;
  /** Replaces the items; resolves once saved. */
  save: (items: WatchItem[]) => Promise<void>;
  match: (e: IntelligenceEvent) => WatchHit[];
}

const WatchlistContext = createContext<WatchlistState | null>(null);

export function WatchlistProvider({ children }: { children: ReactNode }) {
  const { mode } = useData();
  const { user } = useAuth();
  const storage: WatchlistState['storage'] = mode === 'demo' ? 'local' : user ? 'cloud' : 'unavailable';
  const [list, setList] = useState<Watchlist>(EMPTY_WATCHLIST);
  const [loading, setLoading] = useState(storage === 'cloud');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    if (storage === 'local') {
      setList(readStorage<Watchlist>(DEMO_KEY, EMPTY_WATCHLIST));
      setLoading(false);
    } else if (storage === 'cloud' && user) {
      setLoading(true);
      import('../data/watchlistService')
        .then((svc) => svc.loadWatchlist(user.uid))
        .then((w) => live && setList(w ?? EMPTY_WATCHLIST))
        .catch((e: Error) => live && setError(`Watchlist not loaded: ${e.message}`))
        .finally(() => live && setLoading(false));
    }
    return () => {
      live = false;
    };
  }, [storage, user]);

  const save = useCallback(
    async (items: WatchItem[]) => {
      const next: Watchlist = { items, updatedAt: new Date().toISOString(), version: list.version + 1 };
      setError(null);
      if (storage === 'local') {
        writeStorage(DEMO_KEY, next);
      } else if (storage === 'cloud' && user) {
        const svc = await import('../data/watchlistService');
        try {
          await svc.saveWatchlist(user.uid, next);
        } catch (e) {
          setError((e as Error).message);
          throw e;
        }
      } else {
        throw new Error('Sign in to keep a watchlist.');
      }
      setList(next);
    },
    [list.version, storage, user],
  );

  const match = useMemo(() => compileWatchlist(list.items), [list.items]);
  const value = useMemo(() => ({ list, storage, loading, error, save, match }), [list, storage, loading, error, save, match]);
  return <WatchlistContext.Provider value={value}>{children}</WatchlistContext.Provider>;
}

export function useWatchlist(): WatchlistState | null {
  return useContext(WatchlistContext);
}

/** Watchlist hits for one record ([] without a provider, e.g. in isolated component tests). */
export function useWatchHits(e: IntelligenceEvent): WatchHit[] {
  const ctx = useContext(WatchlistContext);
  return useMemo(() => (ctx ? ctx.match(e) : []), [ctx, e]);
}
