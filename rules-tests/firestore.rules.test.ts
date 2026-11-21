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
import { doc, getDoc, setDoc, deleteDoc, updateDoc, collection, getDocs } from 'firebase/firestore';

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
    await setDoc(doc(db, 'indicatorHistory/t1'), { to: 'TRIGGERED' });
    await setDoc(doc(db, 'raiHistory/p1'), { at: '2026-11-20T00:00:00Z', scores: {} });
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
    await assertSucceeds(getDoc(doc(owner(), 'indicatorHistory/t1')));
    await assertSucceeds(getDoc(doc(owner(), 'raiHistory/p1')));
  });

  it('unauthenticated, non-owner and spoofed-claim users cannot read anything', async () => {
    for (const db of [anon(), stranger(), fakeOwner()]) {
      await assertFails(getDoc(doc(db, 'snapshots/dashboard')));
      await assertFails(getDoc(doc(db, 'events/abc')));
      await assertFails(getDocs(collection(db, 'events')));
      await assertFails(getDoc(doc(db, 'indicatorHistory/t1')));
      await assertFails(getDoc(doc(db, 'raiHistory/p1')));
    }
  });

  it('no client — not even the owner — can write or delete collected data', async () => {
    await assertFails(setDoc(doc(owner(), 'events/new'), { title: 'forged' }));
    await assertFails(setDoc(doc(owner(), 'snapshots/dashboard'), { events: [] }));
    await assertFails(deleteDoc(doc(owner(), 'events/abc')));
    await assertFails(setDoc(doc(owner(), 'sourceStatus/cisa-kev'), { health: 'ONLINE' }));
    await assertFails(setDoc(doc(owner(), 'collectionRuns/r2'), {}));
    await assertFails(setDoc(doc(owner(), 'indicatorHistory/forged'), { to: 'NORMAL' }));
    await assertFails(setDoc(doc(owner(), 'raiHistory/forged'), { scores: {} }));
  });

  it('collector-internal source state is never readable by clients', async () => {
    await assertFails(getDoc(doc(owner(), 'sourceState/cisa-kev')));
  });
});

describe('alert rules and alerts', () => {
  const validRule = (id = 'r1') => ({
    id, name: 'Red Sea', enabled: true, severity: 'WARNING',
    trigger: { kind: 'event', match: { field: 'regionIds', op: 'contains', value: 'red-sea' } },
    notify: { discord: true }, cooldownMinutes: 60, version: 1,
    createdAt: '2026-11-20T00:00:00Z', updatedAt: '2026-11-20T00:00:00Z',
  });

  it('owner can create, update, read and delete well-formed rules', async () => {
    await assertSucceeds(setDoc(doc(owner(), 'alertRules/r1'), validRule()));
    await assertSucceeds(setDoc(doc(owner(), 'alertRules/r1'), { ...validRule(), enabled: false, version: 2 }));
    await assertSucceeds(getDoc(doc(owner(), 'alertRules/r1')));
    await assertSucceeds(deleteDoc(doc(owner(), 'alertRules/r1')));
  });

  it('rejects malformed rules and non-owners', async () => {
    await assertFails(setDoc(doc(owner(), 'alertRules/r1'), { ...validRule(), severity: 'PANIC' }));
    await assertFails(setDoc(doc(owner(), 'alertRules/r1'), { ...validRule(), trigger: { kind: 'script' } }));
    await assertFails(setDoc(doc(owner(), 'alertRules/r1'), { ...validRule(), cooldownMinutes: -1 }));
    await assertFails(setDoc(doc(owner(), 'alertRules/r1'), { ...validRule(), extra: 'x' }));
    await assertFails(setDoc(doc(owner(), 'alertRules/r1'), { ...validRule(), name: 'x'.repeat(81) }));
    await assertFails(setDoc(doc(owner(), 'alertRules/other'), validRule('r1'))); // id must match path
    await assertFails(setDoc(doc(owner(), 'alertRules/r1'), { ...validRule(), notify: { discord: true, webhook: 'https://x' } }));
    await assertFails(setDoc(doc(stranger(), 'alertRules/r1'), validRule()));
    await assertFails(getDoc(doc(fakeOwner(), 'alertRules/r1')));
  });

  it('alerts: owner may only acknowledge or dismiss; nobody may create or delete', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'alerts/a1'), {
        title: 'x', severity: 'WARNING', acknowledged: false, acknowledgedAt: null, dismissed: false, dismissedAt: null, delivery: { discord: 'sent' },
      });
    });
    await assertSucceeds(getDoc(doc(owner(), 'alerts/a1')));
    await assertSucceeds(updateDoc(doc(owner(), 'alerts/a1'), { acknowledged: true, acknowledgedAt: '2026-11-20T01:00:00Z' }));
    await assertSucceeds(updateDoc(doc(owner(), 'alerts/a1'), { dismissed: true, dismissedAt: '2026-11-20T01:00:00Z' }));
    await assertFails(updateDoc(doc(owner(), 'alerts/a1'), { severity: 'INFORMATION' }));
    await assertFails(updateDoc(doc(owner(), 'alerts/a1'), { acknowledged: 'yes' }));
    await assertFails(setDoc(doc(owner(), 'alerts/forged'), { title: 'forged' }));
    await assertFails(deleteDoc(doc(owner(), 'alerts/a1')));
    await assertFails(getDoc(doc(stranger(), 'alerts/a1')));
    await assertFails(getDoc(doc(owner(), 'collectorState/alerting')));
  });
});

describe('incidents', () => {
  const incident = (p: Record<string, unknown> = {}) => ({
    id: 'i1', title: 'Red Sea shipping attacks', summary: '', status: 'developing', category: 'maritime', regionIds: ['red-sea'],
    evidence: [], notes: [], linkedIncidentIds: [], indicatorIds: [], createdAt: '2026-11-20T00:00:00Z', updatedAt: '2026-11-20T00:00:00Z', version: 1, ...p,
  });

  it('owner can create, update with version +1, read and delete', async () => {
    await assertSucceeds(setDoc(doc(owner(), 'incidents/i1'), incident()));
    await assertSucceeds(setDoc(doc(owner(), 'incidents/i1'), incident({ version: 2, status: 'stable', updatedAt: '2026-11-20T01:00:00Z' })));
    await assertSucceeds(getDoc(doc(owner(), 'incidents/i1')));
    await assertSucceeds(deleteDoc(doc(owner(), 'incidents/i1')));
  });

  it('rejects stale or skipped versions, changed createdAt, and malformed dossiers', async () => {
    await assertSucceeds(setDoc(doc(owner(), 'incidents/i1'), incident()));
    await assertFails(setDoc(doc(owner(), 'incidents/i1'), incident({ version: 1, title: 'stale overwrite' })));
    await assertFails(setDoc(doc(owner(), 'incidents/i1'), incident({ version: 3 })));
    await assertFails(setDoc(doc(owner(), 'incidents/i1'), incident({ version: 2, createdAt: '2020-01-01T00:00:00Z' })));
    await assertFails(setDoc(doc(owner(), 'incidents/i2'), incident({ id: 'i2', version: 2 })));
    await assertFails(setDoc(doc(owner(), 'incidents/i3'), incident({ id: 'i3', status: 'panic' })));
    await assertFails(setDoc(doc(owner(), 'incidents/i4'), incident({ id: 'i4', title: '' })));
    await assertFails(setDoc(doc(owner(), 'incidents/i5'), incident({ id: 'i5', linkedIncidentIds: ['i5'] })));
    await assertFails(setDoc(doc(owner(), 'incidents/i6'), incident({ id: 'i6', extra: true })));
    await assertFails(setDoc(doc(owner(), 'incidents/other'), incident()));
    await assertFails(setDoc(doc(stranger(), 'incidents/i7'), incident({ id: 'i7' })));
    await assertFails(getDoc(doc(fakeOwner(), 'incidents/i1')));
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

describe('watchlists', () => {
  const item = { id: 'wagner', term: 'Wagner', kind: 'unit', aliases: ['Africa Corps'], alert: true, severity: 'ADVISORY', createdAt: '2026-11-21T00:00:00Z' };
  const list = (version: number, items: unknown[] = [item]) => ({ items, updatedAt: '2026-11-21T00:00:00Z', version });

  it('owner can create, update with version +1, read and delete their own list', async () => {
    await assertSucceeds(setDoc(doc(owner(), 'watchlists/owner-uid'), list(1)));
    await assertSucceeds(setDoc(doc(owner(), 'watchlists/owner-uid'), list(2, [])));
    await assertSucceeds(getDoc(doc(owner(), 'watchlists/owner-uid')));
    await assertSucceeds(deleteDoc(doc(owner(), 'watchlists/owner-uid')));
  });

  it("rejects other users' lists, stale versions, extra fields and oversized lists", async () => {
    await assertFails(setDoc(doc(owner(), 'watchlists/other-uid'), list(1)));
    await assertFails(setDoc(doc(stranger(), 'watchlists/other-uid'), list(1)));
    await assertFails(setDoc(doc(owner(), 'watchlists/owner-uid'), list(2))); // create must be version 1
    await assertSucceeds(setDoc(doc(owner(), 'watchlists/owner-uid'), list(1)));
    await assertFails(setDoc(doc(owner(), 'watchlists/owner-uid'), list(1))); // not bumped
    await assertFails(setDoc(doc(owner(), 'watchlists/owner-uid'), list(3))); // skipped
    await assertFails(setDoc(doc(owner(), 'watchlists/owner-uid'), { ...list(2), extra: true }));
    await assertFails(setDoc(doc(owner(), 'watchlists/owner-uid'), list(2, Array.from({ length: 101 }, () => item))));
    await assertFails(getDoc(doc(stranger(), 'watchlists/owner-uid')));
  });
});

describe('default deny', () => {
  it('unknown collections are closed', async () => {
    await assertFails(getDoc(doc(owner(), 'anything/else')));
    await assertFails(setDoc(doc(owner(), 'alertRules/x'), { name: 'not yet' }));
  });
});
