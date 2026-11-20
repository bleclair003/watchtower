// @vitest-environment node
/**
 * Firestore security-rules tests. Require the Firestore emulator:
 *   npm run test:rules
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-watchtower-rules',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'snapshots/dashboard'), { generatedAt: '2026-11-20T00:00:00Z', events: [] });
    await setDoc(doc(db, 'events/abc'), { title: 'x' });
    await setDoc(doc(db, 'sourceStatus/cisa-kev'), { health: 'ONLINE' });
    await setDoc(doc(db, 'collectionRuns/r1'), { recordsImported: 1 });
    await setDoc(doc(db, 'sourceState/cisa-kev'), { state: { etag: 'x' } });
  });
});

const owner = () => env.authenticatedContext('owner-uid', { owner: true, email: 'owner@example.com' }).firestore();
const stranger = () => env.authenticatedContext('other-uid', { email: 'someone@example.com' }).firestore();
const fakeOwner = () => env.authenticatedContext('sneaky', { owner: 'true' }).firestore(); // string, not boolean
const anon = () => env.unauthenticatedContext().firestore();

describe('collected data', () => {
  it('owner can read snapshot, events, status and runs', async () => {
    await assertSucceeds(getDoc(doc(owner(), 'snapshots/dashboard')));
    await assertSucceeds(getDoc(doc(owner(), 'events/abc')));
    await assertSucceeds(getDocs(collection(owner(), 'events')));
    await assertSucceeds(getDoc(doc(owner(), 'sourceStatus/cisa-kev')));
    await assertSucceeds(getDoc(doc(owner(), 'collectionRuns/r1')));
  });

  it('unauthenticated, non-owner and spoofed-claim users cannot read anything', async () => {
    for (const db of [anon(), stranger(), fakeOwner()]) {
      await assertFails(getDoc(doc(db, 'snapshots/dashboard')));
      await assertFails(getDoc(doc(db, 'events/abc')));
      await assertFails(getDocs(collection(db, 'events')));
    }
  });

  it('no client — not even the owner — can write or delete collected data', async () => {
    await assertFails(setDoc(doc(owner(), 'events/new'), { title: 'forged' }));
    await assertFails(setDoc(doc(owner(), 'snapshots/dashboard'), { events: [] }));
    await assertFails(deleteDoc(doc(owner(), 'events/abc')));
    await assertFails(setDoc(doc(owner(), 'sourceStatus/cisa-kev'), { health: 'ONLINE' }));
    await assertFails(setDoc(doc(owner(), 'collectionRuns/r2'), {}));
  });

  it('collector-internal source state is never readable by clients', async () => {
    await assertFails(getDoc(doc(owner(), 'sourceState/cisa-kev')));
  });
});

describe('user settings', () => {
  it('owner can manage only their own settings document', async () => {
    await assertSucceeds(setDoc(doc(owner(), 'userSettings/owner-uid'), { scanlines: true }));
    await assertSucceeds(getDoc(doc(owner(), 'userSettings/owner-uid')));
    await assertFails(setDoc(doc(owner(), 'userSettings/other-uid'), { scanlines: true }));
    await assertFails(setDoc(doc(stranger(), 'userSettings/other-uid'), { scanlines: true }));
  });
});

describe('default deny', () => {
  it('unknown collections are closed', async () => {
    await assertFails(getDoc(doc(owner(), 'anything/else')));
    await assertFails(setDoc(doc(owner(), 'alertRules/x'), { name: 'not yet' }));
  });
});
