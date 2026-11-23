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
import type { AlertFeedback, AlertRecord, AlertRule } from '@shared/domain/alerts/types';
import type { MissedIncident } from '@shared/domain/alerts/scorecard';
import type { CollectionRun } from '@shared/domain/types';
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

/** Set or clear (null) the feedback on an alert. Feedback does not acknowledge the alert. */
export async function setAlertFeedback(id: string, feedback: AlertFeedback | null): Promise<void> {
  const { db } = getFirebase();
  await updateDoc(doc(db, COLLECTIONS.alerts, id), { feedback });
  notify();
}

/** Scorecard window cap: alerts beyond this many in the window are not loaded (the scorecard says so). */
export const SCORECARD_ALERT_CAP = 1000;

/** Alerts created since `sinceIso`, newest first, up to the cap. */
export async function listAlertsSince(sinceIso: string): Promise<{ alerts: AlertRecord[]; capped: boolean }> {
  const { db } = getFirebase();
  const snap = await getDocs(
    query(collection(db, COLLECTIONS.alerts), where('createdAt', '>=', sinceIso), orderBy('createdAt', 'desc'), limit(SCORECARD_ALERT_CAP)),
  );
  return { alerts: snap.docs.map((d) => ({ ...(d.data() as AlertRecord), id: d.id })), capped: snap.size >= SCORECARD_ALERT_CAP };
}

/** Collection runs since `sinceIso` (an hourly schedule: about 24 reads a day). */
export async function listRunsSince(sinceIso: string): Promise<CollectionRun[]> {
  const { db } = getFirebase();
  const snap = await getDocs(query(collection(db, COLLECTIONS.collectionRuns), where('startedAt', '>=', sinceIso), orderBy('startedAt', 'desc'), limit(400)));
  return snap.docs.map((d) => ({ ...(d.data() as CollectionRun), id: d.id }));
}

export async function listMissed(): Promise<MissedIncident[]> {
  const { db } = getFirebase();
  const snap = await getDocs(query(collection(db, COLLECTIONS.missedIncidents), orderBy('occurredAt', 'desc'), limit(500)));
  return snap.docs.map((d) => ({ ...(d.data() as MissedIncident), id: d.id }));
}

export async function saveMissed(m: MissedIncident): Promise<void> {
  const { db } = getFirebase();
  await setDoc(doc(db, COLLECTIONS.missedIncidents, m.id), m);
  notify();
}

export async function deleteMissed(id: string): Promise<void> {
  const { db } = getFirebase();
  await deleteDoc(doc(db, COLLECTIONS.missedIncidents, id));
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
