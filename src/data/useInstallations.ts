import { useEffect, useState } from 'react';
import type { InstallationDataset } from '@shared/domain/installations';

let cache: Promise<InstallationDataset> | null = null;

/** Loads the static installations file once per session (same-origin, ~30 KB compressed). */
export function useInstallations(enabled: boolean): { data: InstallationDataset | null; error: string | null } {
  const [data, setData] = useState<InstallationDataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    cache ??= fetch('/data/installations-us.json').then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<InstallationDataset>;
    });
    cache.then(
      (d) => live && setData(d),
      (e: Error) => {
        cache = null;
        if (live) setError(`Installations layer unavailable: ${e.message}`);
      },
    );
    return () => {
      live = false;
    };
  }, [enabled]);
  return { data, error };
}
