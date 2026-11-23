import { useEffect, useState } from 'react';
import { RADIO_GUIDE_DOC_ID, COLLECTIONS } from '@shared/domain/snapshot';
import type { RadioGuide } from '@shared/domain/shortwave';
import { useOptionalData } from '../state/DataContext';
import { backendMode } from '../config/firebase';

let cached: Promise<RadioGuide | null> | null = null;

async function loadLive(): Promise<RadioGuide | null> {
  const [{ doc, getDoc }, { getFirebase }] = await Promise.all([import('firebase/firestore'), import('./firebaseClient')]);
  const { db } = getFirebase();
  const snap = await getDoc(doc(db, COLLECTIONS.snapshots, RADIO_GUIDE_DOC_ID));
  return snap.exists() ? (snap.data() as RadioGuide) : null;
}

/**
 * Phase 29: the radio guide (shortwave schedules, local stations) lives in its own document, read once per
 * visit and only by the radio panels and LISTEN links. Demo mode uses invented, SIMULATED data.
 */
export function useRadioGuide(enabled = true): { guide: RadioGuide | null; loading: boolean; error: string | null } {
  const mode = useOptionalData()?.mode ?? backendMode;
  const [guide, setGuide] = useState<RadioGuide | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    cached ??= mode === 'demo' ? import('./demo/demoPhase25').then((m) => m.buildDemoRadioGuide(Date.now())) : loadLive();
    cached.then(
      (g) => {
        if (!live) return;
        setGuide(g);
        setLoading(false);
      },
      (e: Error) => {
        cached = null;
        if (!live) return;
        setError(`Radio guide unavailable: ${e.message}`);
        setLoading(false);
      },
    );
    return () => {
      live = false;
    };
  }, [enabled, mode]);
  return { guide, loading, error };
}
