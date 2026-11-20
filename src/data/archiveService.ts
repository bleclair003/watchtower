import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { COLLECTIONS } from '@shared/domain/snapshot';
import type { IntelligenceEvent } from '@shared/domain/types';
import type { IndicatorTransition, ScoreHistoryPoint } from '@shared/domain/indicators/types';
import type { AlertRecord } from '@shared/domain/alerts/types';
import { getFirebase } from './firebaseClient';

/**
 * Bounded historical queries for SITREP, Replay and Signal Lab (live / emulator
 * only; dynamically imported). Every query has a hard cap; results report
 * whether the cap was hit so the UI can say the data may be incomplete.
 * Each returned document is one Firestore read.
 */
export const ARCHIVE_EVENT_LIMIT = 2000;
const HISTORY_LIMIT = 2000;

export interface Bounded<T> {
  items: T[];
  truncated: boolean;
  reads: number;
}

async function run<T>(q: ReturnType<typeof query>, cap: number): Promise<Bounded<T>> {
  const snap = await getDocs(q);
  return { items: snap.docs.map((d) => d.data() as T), truncated: snap.size >= cap, reads: Math.max(1, snap.size) };
}

/** Events collected at or after `sinceIso` (newest first). */
export function eventsCollectedSince(sinceIso: string, cap = ARCHIVE_EVENT_LIMIT): Promise<Bounded<IntelligenceEvent>> {
  const { db } = getFirebase();
  return run(query(collection(db, COLLECTIONS.events), where('collectedAt', '>=', sinceIso), orderBy('collectedAt', 'desc'), limit(cap)), cap);
}

export function transitionsSince(sinceIso: string): Promise<Bounded<IndicatorTransition>> {
  const { db } = getFirebase();
  return run(query(collection(db, COLLECTIONS.indicatorHistory), where('at', '>=', sinceIso), orderBy('at', 'desc'), limit(HISTORY_LIMIT)), HISTORY_LIMIT);
}

export function raiHistorySince(sinceIso: string): Promise<Bounded<ScoreHistoryPoint>> {
  const { db } = getFirebase();
  return run(query(collection(db, COLLECTIONS.raiHistory), where('at', '>=', sinceIso), orderBy('at', 'asc'), limit(HISTORY_LIMIT)), HISTORY_LIMIT);
}

export function alertsSince(sinceIso: string): Promise<Bounded<AlertRecord>> {
  const { db } = getFirebase();
  return run(query(collection(db, COLLECTIONS.alerts), where('createdAt', '>=', sinceIso), orderBy('createdAt', 'desc'), limit(500)), 500);
}
