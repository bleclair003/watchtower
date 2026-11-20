/**
 * One-off correction (2026-11-20): FIRMS clusters stored by v0.9.0 were assigned to watch
 * regions by rectangle only, so fires in north-east China were tagged KOREA. This recomputes
 * country and regions with the v0.9.1 point-in-country check and updates records in place.
 * Nothing is deleted; each corrected record keeps a note saying what changed and when.
 *
 *   node scripts/retag-firms.ts            # dry run: prints the changes
 *   node scripts/retag-firms.ts --apply    # writes them
 */
import { parseArgs } from 'node:util';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS } from '../shared/domain/snapshot.ts';
import { WATCH_REGIONS, regionsForCountry, regionsForPoint } from '../shared/domain/regions.ts';
import { isCrimea, watchCountryAt } from '../collector/geo/countries.ts';

const { values } = parseArgs({ options: { apply: { type: 'boolean', default: false } } });
const projectId = process.env.WATCHTOWER_PROJECT_ID?.trim();
if (!projectId) throw new Error('WATCHTOWER_PROJECT_ID is not set');
process.env.GOOGLE_CLOUD_PROJECT ??= projectId;
initializeApp({ projectId, credential: applicationDefault() });
const db = getFirestore();

const snap = await db.collection(COLLECTIONS.events).where('sourceId', '==', 'nasa-firms').get();
const now = new Date().toISOString();
let changed = 0;
for (const doc of snap.docs) {
  const e = doc.data();
  if (e.metadata?.correctedAt) continue;
  const country = watchCountryAt(e.latitude, e.longitude);
  const inBox = regionsForPoint(e.latitude, e.longitude);
  const regionIds = country ? regionsForCountry(country).filter((r) => inBox.includes(r)) : [];
  const n = e.metadata?.detections ?? '?';
  const label = regionIds.map((r) => WATCH_REGIONS.find((w) => w.id === r)?.shortCode ?? r).join('/');
  const title = country && regionIds.length
    ? `New thermal-anomaly cluster: ${n} satellite fire detections — ${country} (${label})`
    : `New thermal-anomaly cluster: ${n} satellite fire detections — outside watch-region countries`;
  const note = `Region corrected ${now}: was ${JSON.stringify(e.regionIds)} (rectangle only); now by point-in-country check.`;
  console.log(`${doc.id}  ${e.latitude},${e.longitude}  ${JSON.stringify(e.regionIds)} → ${JSON.stringify(regionIds)} ${country ?? '(none)'}`);
  changed++;
  if (values.apply) {
    await doc.ref.update({
      regionIds,
      countryCodes: country && regionIds.length ? [country] : [],
      title,
      'metadata.correctedAt': now,
      'metadata.correctionNote': note,
      'metadata.countryBasis': country
        ? isCrimea(e.latitude, e.longitude) ? 'Natural Earth 1:50m borders; Crimea assigned to UA (internationally recognised)' : 'Natural Earth 1:50m borders'
        : 'outside all watch-region countries (Natural Earth 1:50m)',
    });
  }
}
console.log(`${snap.size} FIRMS records, ${changed} ${values.apply ? 'updated' : 'would be updated (dry run)'}`);
