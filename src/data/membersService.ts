import { collection, deleteDoc, doc, getDoc, getDocs, limit, onSnapshot, query, setDoc, updateDoc } from 'firebase/firestore';
import { COLLECTIONS } from '@shared/domain/snapshot';
import type { Member, MemberRole } from '@shared/domain/members';
import { getFirebase } from './firebaseClient';

/**
 * People (v0.60.0): each signed-in person's members/{uid} document. Loaded via dynamic import, so demo
 * mode never pulls in the Firebase SDK. Security rules allow a person to create only their own document
 * (role "pending") and to refresh only its contact fields; roles are set by the owner.
 */

/** Refreshes lastSeenAt at most this often, to keep writes rare. */
const SEEN_EVERY_MS = 12 * 3_600_000;

export async function ensureMember(u: { uid: string; email: string | null; displayName: string | null }, ownerAccount: boolean): Promise<void> {
  const { db } = getFirebase();
  const ref = doc(db, COLLECTIONS.members, u.uid);
  const snap = await getDoc(ref);
  const now = new Date().toISOString();
  const email = u.email?.slice(0, 320) ?? null;
  const displayName = u.displayName?.slice(0, 200) ?? null;
  if (!snap.exists()) {
    const m: Member = { uid: u.uid, email, displayName, role: 'pending', ownerAccount, createdAt: now, lastSeenAt: now };
    await setDoc(ref, m);
    return;
  }
  const cur = snap.data() as Member;
  const stale = Date.now() - Date.parse(cur.lastSeenAt) > SEEN_EVERY_MS;
  if (stale || cur.email !== email || cur.displayName !== displayName || cur.ownerAccount !== ownerAccount) {
    await updateDoc(ref, { email, displayName, ownerAccount, lastSeenAt: now });
  }
}

/** Live view of one person's own document (so a new role takes effect without reloading). */
export function watchMember(uid: string, cb: (m: Member | null) => void, onError: (e: Error) => void): () => void {
  const { db } = getFirebase();
  return onSnapshot(
    doc(db, COLLECTIONS.members, uid),
    (s) => cb(s.exists() ? (s.data() as Member) : null),
    onError,
  );
}

/** Owner only. */
export async function listMembers(): Promise<Member[]> {
  const { db } = getFirebase();
  const snap = await getDocs(query(collection(db, COLLECTIONS.members), limit(500)));
  return snap.docs.map((d) => d.data() as Member);
}

/** Owner only. */
export async function setMemberRole(uid: string, role: MemberRole): Promise<void> {
  const { db } = getFirebase();
  await updateDoc(doc(db, COLLECTIONS.members, uid), { role, roleSetAt: new Date().toISOString() });
}

/** Owner only. Deleting lets the person ask again on their next sign-in (as pending); block to keep them out. */
export async function deleteMember(uid: string): Promise<void> {
  const { db } = getFirebase();
  await deleteDoc(doc(db, COLLECTIONS.members, uid));
}
