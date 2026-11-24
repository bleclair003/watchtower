import { useEffect, useState } from 'react';
import { COLLECTIONS } from '@shared/domain/snapshot';
import { SHIPS_DOC_ID, type ShipTrafficDoc } from '@shared/domain/shipTraffic';
import { useOptionalData } from '../state/DataContext';
import { backendMode } from '../config/firebase';

let cached: Promise<ShipTrafficDoc | null> | null = null;
let cachedAt = 0;
const REFRESH_MS = 10 * 60_000;

async function loadLive(): Promise<ShipTrafficDoc | null> {
  const [{ doc, getDoc }, { getFirebase }] = await Promise.all([import('firebase/firestore'), import('./firebaseClient')]);
  const { db } = getFirebase();
  const snap = await getDoc(doc(db, COLLECTIONS.snapshots, SHIPS_DOC_ID));
  return snap.exists() ? (snap.data() as ShipTrafficDoc) : null;
}

/** v0.75.0: tanker and cargo traffic, its own document, read only while the SHIPS layer is on (1 read, refreshed every 10 min). */
export function useShipTraffic(enabled: boolean): { data: ShipTrafficDoc | null; error: string | null } {
  const mode = useOptionalData()?.mode ?? backendMode;
  const [data, setData] = useState<ShipTrafficDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    if (!cached || Date.now() - cachedAt > REFRESH_MS) {
      cachedAt = Date.now();
      cached = mode === 'demo' ? import('./demo/demoShipTraffic').then((m) => m.buildDemoShipTraffic(Date.now())) : loadLive();
    }
    cached.then(
      (d) => {
        if (!live) return;
        setData(d);
        if (!d) setError('No tanker or cargo traffic collected yet: it appears after the first successful AIS listen.');
      },
      (e: Error) => {
        cached = null;
        if (live) setError(`Ship traffic unavailable: ${e.message}`);
      },
    );
    return () => {
      live = false;
    };
  }, [enabled, mode]);
  return { data, error };
}
