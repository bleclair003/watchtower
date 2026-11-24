import { useEffect, useMemo, useState } from 'react';
import type { InstallationDataset, WorldDataset } from '@shared/domain/installations';
import type { InfraDataset } from '@shared/domain/infrastructure';
import type { UnderseaDataset } from '@shared/domain/undersea';
import type { DisputedDataset } from '@shared/domain/disputed';
import type { LanesDataset } from '@shared/domain/shipTraffic';
import type { SelectedSite } from '../components/map/InstallationCard';

const cache = new Map<string, Promise<unknown>>();

/** Loads a static same-origin data file once per session. */
function useStatic<T>(path: string, enabled: boolean, label = 'Installations layer'): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    if (!cache.has(path)) {
      cache.set(
        path,
        fetch(path).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        }),
      );
    }
    (cache.get(path) as Promise<T>).then(
      (d) => live && setData(d),
      (e: Error) => {
        cache.delete(path);
        if (live) setError(`${label} unavailable: ${e.message}`);
      },
    );
    return () => {
      live = false;
    };
  }, [path, enabled]);
  return { data, error };
}

/** Critical infrastructure in watch-region countries (WRI + Wikidata, ~30 KB compressed). */
export const useInfrastructure = (enabled: boolean) => useStatic<InfraDataset>('/data/infrastructure.json', enabled, 'Infrastructure layer');

/** Undersea cables and pipelines in the watch-region seas (OpenStreetMap, v0.71.0). */
export const useUndersea = (enabled: boolean) => useStatic<UnderseaDataset>('/data/undersea.json', enabled, 'Undersea layer');
/** Shipping lanes, major / middle / minor (Benden 2022, v0.75.0). */
export const useLanes = (enabled: boolean) => useStatic<LanesDataset>('/data/lanes.json', enabled, 'Lanes layer');
/** Disputed and breakaway areas worldwide (Natural Earth, v0.71.0). */
export const useDisputed = (enabled: boolean) => useStatic<DisputedDataset>('/data/disputed.json', enabled, 'Disputed areas layer');

/** US sites (DoD MIRTA, ~30 KB compressed). */
export const useInstallations = (enabled: boolean) => useStatic<InstallationDataset>('/data/installations-us.json', enabled);
/** Sites outside the US (Wikidata, ~105 KB compressed). */
export const useWorldInstallations = (enabled: boolean) => useStatic<WorldDataset>('/data/installations-world.json', enabled);

/** Both layers plus the selected site, resolved from a selection key (`dod:<name>` or `wd:<id>`). */
export function useBases(enabledUs: boolean, enabledWorld: boolean, selectedKey: string | null) {
  const us = useInstallations(enabledUs);
  const world = useWorldInstallations(enabledWorld);
  const selected = useMemo<SelectedSite | null>(() => {
    if (!selectedKey) return null;
    if (selectedKey.startsWith('dod:') && us.data) {
      const site = us.data.installations.find((i) => `dod:${i.name}` === selectedKey);
      return site ? { kind: 'dod', site, dataset: us.data } : null;
    }
    if (selectedKey.startsWith('wd:') && world.data) {
      const site = world.data.installations.find((w) => `wd:${w.q}` === selectedKey);
      return site ? { kind: 'world', site, dataset: world.data } : null;
    }
    return null;
  }, [selectedKey, us.data, world.data]);
  return { us, world, selected, error: us.error ?? world.error, count: (us.data?.count ?? 0) + (world.data?.count ?? 0) };
}
