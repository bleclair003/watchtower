import {
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { COLLECTIONS } from '@shared/domain/snapshot';
import type { AlertRecord, AlertRule } from '@shared/domain/alerts/types';
import { getFirebase } from './firebaseClient';

/**
 * Browser access to alerts and alert rules (live / emulator modes only).
 * Loaded via dynamic import so demo mode never pulls in the Firebase SDK.
 * Security rules restrict writes to rule documents of a validated shape and to
 * the acknowledged/dismissed fields of alerts.
 */
export const ALERT_PAGE_SIZE = 100;
/** Fired after any change so other components (e.g. the top-bar counter) refresh. */
export const ALERTS_CHANGED_EVENT = 'wt:alerts-changed';
const notify = () => window.dispatchEvent(new Event(ALERTS_CHANGED_EVENT));

export async function listAlerts(): Promise<AlertRecord[]> {
  const { db } = getFirebase();
  const snap = await getDocs(query(collection(db, COLLECTIONS.alerts), orderBy('createdAt', 'desc'), limit(ALERT_PAGE_SIZE)));
  return snap.docs.map((d) => ({ ...(d.data() as AlertRecord), id: d.id }));
}

/** Unacknowledged alerts. An aggregation query: billed as 1 read per 1,000 matches. */
export async function countOpenAlerts(): Promise<number> {
  const { db } = getFirebase();
  const agg = await getCountFromServer(query(collection(db, COLLECTIONS.alerts), where('acknowledged', '==', false)));
  return agg.data().count;
}

export async function acknowledgeAlert(id: string): Promise<void> {
  const { db } = getFirebase();
  await updateDoc(doc(db, COLLECTIONS.alerts, id), { acknowledged: true, acknowledgedAt: new Date().toISOString() });
  notify();
}

/** Dismissing also acknowledges, so dismissed alerts never count as open. */
export async function dismissAlert(id: string): Promise<void> {
  const { db } = getFirebase();
  const at = new Date().toISOString();
  await updateDoc(doc(db, COLLECTIONS.alerts, id), { dismissed: true, dismissedAt: at, acknowledged: true, acknowledgedAt: at });
  notify();
}

export async function listRules(): Promise<AlertRule[]> {
  const { db } = getFirebase();
  const snap = await getDocs(query(collection(db, COLLECTIONS.alertRules), limit(200)));
  return snap.docs.map((d) => ({ ...(d.data() as AlertRule), id: d.id })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveRule(rule: AlertRule): Promise<void> {
  const { db } = getFirebase();
  await setDoc(doc(db, COLLECTIONS.alertRules, rule.id), rule);
  notify();
}

export async function deleteRule(id: string): Promise<void> {
  const { db } = getFirebase();
  await deleteDoc(doc(db, COLLECTIONS.alertRules, id));
  notify();
}
