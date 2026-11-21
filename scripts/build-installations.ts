/**
 * Builds public/data/installations-us.json from the DoD's authoritative installation points.
 *
 * Source: "Military Installations, Ranges, and Training Areas (MIRTA) – Points", a National
 * Geospatial Data Asset from the Department of Defense (OUSW A&S), published on ArcGIS Online by
 * Esri's federal data team (item 8acd7277c2d04bc294c927fc7149c626). Licence: CC BY 4.0, credit the
 * Department of Defense. Data currency per the item: 2024. Coverage: US states and territories.
 *
 * Coordinates are copied from the source (rounded to 5 decimals, ~1 m). Nothing is geocoded or
 * typed in by hand. Re-run when the source updates (it is checked annually):
 *
 *   node scripts/build-installations.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const ITEM = 'https://www.arcgis.com/home/item.html?id=8acd7277c2d04bc294c927fc7149c626';
const QUERY =
  'https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/MIRTA_Points_A_view/FeatureServer/0/query?where=1%3D1&outFields=siteName,siteReportingComponent,siteOperationalStatus,stateNameCode,countryName,isJointBase&resultRecordCount=2000&f=geojson';

interface Feature {
  geometry: { type: string; coordinates: [number, number] } | null;
  properties: Record<string, string | null>;
}

const res = await fetch(QUERY, { headers: { 'User-Agent': 'WATCHTOWER-OSINT/0.14 (personal research; one-off download)' } });
if (!res.ok) throw new Error(`MIRTA query failed: HTTP ${res.status}`);
const doc = (await res.json()) as { features?: Feature[]; properties?: { exceededTransferLimit?: boolean } };
if (doc.properties?.exceededTransferLimit) throw new Error('Transfer limit exceeded: page the query');
const features = doc.features ?? [];
if (features.length < 500) throw new Error(`Suspiciously few features (${features.length}); refusing to overwrite`);

const r5 = (n: number) => Math.round(n * 1e5) / 1e5;
const installations = features
  .filter((f) => f.geometry?.type === 'Point' && f.properties.siteName)
  .map((f) => ({
    name: String(f.properties.siteName).trim(),
    component: String(f.properties.siteReportingComponent ?? 'other'),
    status: String(f.properties.siteOperationalStatus ?? ''),
    state: String(f.properties.stateNameCode ?? ''),
    country: String(f.properties.countryName ?? 'USA'),
    joint: f.properties.isJointBase === 'Yes',
    lon: r5(f.geometry!.coordinates[0]),
    lat: r5(f.geometry!.coordinates[1]),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

const out = {
  source: 'Military Installations, Ranges, and Training Areas (MIRTA) – Points, U.S. Department of Defense (NGDA)',
  sourceUrl: ITEM,
  licence: 'CC BY 4.0 — credit: Department of Defense (DOD)',
  dataCurrency: '2024',
  coverage: 'United States and territories',
  retrievedAt: new Date().toISOString(),
  count: installations.length,
  installations,
};
mkdirSync(new URL('../public/data/', import.meta.url), { recursive: true });
writeFileSync(new URL('../public/data/installations-us.json', import.meta.url), JSON.stringify(out));
console.log(`Wrote ${installations.length} installations (${Buffer.byteLength(JSON.stringify(out))} bytes)`);
