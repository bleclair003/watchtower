/**
 * One-off correction (2026-11-21): aircraft records stored by v0.16.0–v0.17.0 were assigned to
 * watch regions by the watch-area box only, so an aircraft over Austria counted as Eastern
 * Europe. This recomputes regions with the v0.17.1 rule (over a watch country, or over open
 * water inside the box) and rewrites changed records in place, day buckets included.
 * Nothing is deleted; each corrected record keeps a note saying what changed and when.
 *
 *   node scripts/retag-aircraft.ts            # dry run: prints the changes
 *   node scripts/retag-aircraft.ts --apply    # writes them
 */
import { parseArgs } from 'node:util';
import { getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS } from '../shared/domain/snapshot.ts';
import { WATCH_REGIONS } from '../shared/domain/regions.ts';
import type { IntelligenceEvent } from '../shared/domain/types.ts';
import { regionsForSeaOrWatchCountry } from '../collector/geo/countries.ts';
import { AIRCRAFT_SOURCE_ID } from '../collector/adapters/militaryAircraft.ts';
import { FirestoreStore } from '../collector/store/firestore.ts';

const { values } = parseArgs({ options: { apply: { type: 'boolean', default: false } } });
const projectId = process.env.WATCHTOWER_PROJECT_ID?.trim();
if (!projectId) throw new Error('WATCHTOWER_PROJECT_ID is not set');
process.env.GOOGLE_CLOUD_PROJECT ??= projectId;
const store = new FirestoreStore(projectId); // initializes the admin app
const db = getFirestore();

const snap = await db.collection(COLLECTIONS.events).where('sourceId', '==', AIRCRAFT_SOURCE_ID).get();
const now = new Date().toISOString();
const updates: IntelligenceEvent[] = [];
for (const doc of snap.docs) {
  const e = doc.data() as IntelligenceEvent;
  if (e.metadata?.correctedAt || e.latitude == null || e.longitude == null) continue;
  const where = regionsForSeaOrWatchCountry(e.latitude, e.longitude);
  // Each record was created for one region; keep it only if the new rule still gives that region.
  const keep = e.regionIds.filter((r) => where.regionIds.includes(r));
  if (keep.length === e.regionIds.length) continue;
  const was = e.regionIds.map((r) => WATCH_REGIONS.find((w) => w.id === r)?.shortCode ?? r).join('/');
  const title = e.title.replace(/ — [A-Z]+ watch area$/, ` — outside watch areas (${where.basis === 'other-country' ? `over ${where.country}` : 'not over a watch country'})`);
  console.log(`${doc.id}  ${e.latitude},${e.longitude}  ${JSON.stringify(e.regionIds)} → ${JSON.stringify(keep)}  ${where.basis} ${where.country ?? ''}  | ${title}`);
  updates.push({
    ...e,
    title,
    regionIds: keep,
    countryCodes: where.basis === 'watch-country' && where.country ? [where.country] : [],
    metadata: {
      ...e.metadata,
      regionBasis: where.basis,
      correctedAt: now,
      correctionNote: `Region corrected ${now}: was ${was} (watch-area box only); now none, because the position is over ${where.basis === 'other-country' ? `a non-watch country (${where.country})` : 'no watch country'}.`,
    },
  });
}
if (values.apply && updates.length) await store.replaceEvents(updates);
console.log(`${snap.size} aircraft records, ${updates.length} ${values.apply ? 'updated' : 'would be updated (dry run)'}`);
