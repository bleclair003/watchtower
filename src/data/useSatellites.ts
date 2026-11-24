import { useEffect, useState } from 'react';
import { COLLECTIONS } from '@shared/domain/snapshot';
import { SATELLITES_DOC_ID, type SatellitesSnapshot } from '@shared/domain/satellites';
import { useOptionalData } from '../state/DataContext';
import { backendMode } from '../config/firebase';

let cached: Promise<SatellitesSnapshot | null> | null = null;
let cachedAt = 0;
const REFRESH_MS = 60 * 60_000;

async function loadLive(): Promise<SatellitesSnapshot | null> {
  const [{ doc, getDoc }, { getFirebase }] = await Promise.all([import('firebase/firestore'), import('./firebaseClient')]);
  const { db } = getFirebase();
  const snap = await getDoc(doc(db, COLLECTIONS.snapshots, SATELLITES_DOC_ID));
  return snap.exists() ? (snap.data() as SatellitesSnapshot) : null;
}

/** v0.84.1: satellite elements, their own document, read only while needed (1 read, refreshed hourly). */
export function useSatellites(enabled: boolean): { data: SatellitesSnapshot | null; error: string | null } {
  const mode = useOptionalData()?.mode ?? backendMode;
  const [data, setData] = useState<SatellitesSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    if (!cached || Date.now() - cachedAt > REFRESH_MS) {
      cachedAt = Date.now();
      cached = mode === 'demo' ? import('./demo/demoSatellites').then((m) => m.buildDemoSatellites(Date.now())) : loadLive();
    }
    cached.then(
      (d) => {
        if (!live) return;
        setData(d);
        if (!d) setError('No satellite elements yet: they appear after the first successful CelesTrak read.');
      },
      (e: Error) => {
        cached = null;
        if (live) setError(`Satellite elements unavailable: ${e.message}`);
      },
    );
    return () => {
      live = false;
    };
  }, [enabled, mode]);
  return { data, error };
}
