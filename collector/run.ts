/**
 * WATCHTOWER collector CLI.
 *
 *   node collector/run.ts                      # write to Firestore (ADC credentials)
 *   node collector/run.ts --dry-run            # fetch + process, print results, write nothing
 *   node collector/run.ts --sources cisa-kev   # subset of sources
 *
 * Environment:
 *   WATCHTOWER_PROJECT_ID     Firebase project id (required unless --dry-run)
 *   FIRESTORE_EMULATOR_HOST   e.g. 127.0.0.1:8080 to target the local emulator
 *   COLLECTOR_TRIGGER         schedule | manual | local (default: local)
 *
 * Exit codes: 0 = all sources OK · 2 = completed but ≥1 source failed · 1 = fatal error.
 */
import { parseArgs } from 'node:util';
import { ADAPTERS } from './adapters/index.ts';
import { runCollection } from './pipeline.ts';
import { MemoryStore } from './store/memory.ts';
import type { CollectorStore } from './store/types.ts';
import type { CollectionRun } from '../shared/domain/types.ts';

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      sources: { type: 'string' },
    },
  });

  const wanted = values.sources?.split(',').map((s) => s.trim()).filter(Boolean);
  const adapters = wanted ? ADAPTERS.filter((a) => wanted.includes(a.sourceId)) : ADAPTERS;
  if (wanted && adapters.length !== wanted.length) {
    const known = ADAPTERS.map((a) => a.sourceId).join(', ');
    console.error(`Unknown source in --sources. Available: ${known}`);
    return 1;
  }

  let store: CollectorStore;
  if (values['dry-run']) {
    store = new MemoryStore();
  } else {
    const projectId = process.env.WATCHTOWER_PROJECT_ID?.trim();
    if (!projectId) {
      console.error('WATCHTOWER_PROJECT_ID is not set (use --dry-run to test without a database).');
      return 1;
    }
    const { FirestoreStore } = await import('./store/firestore.ts');
    store = new FirestoreStore(projectId);
    console.log(`Target: ${process.env.FIRESTORE_EMULATOR_HOST ? `emulator ${process.env.FIRESTORE_EMULATOR_HOST}` : 'Firestore'} · project ${projectId}`);
  }

  const trigger = (process.env.COLLECTOR_TRIGGER ?? 'local') as CollectionRun['trigger'];
  console.log(`WATCHTOWER collection run · trigger=${trigger} · ${adapters.length} source(s)${values['dry-run'] ? ' · DRY RUN' : ''}`);

  const { run, reports, snapshot } = await runCollection(adapters, store, { trigger, log: (m) => console.log(m) });

  console.log(
    `Run ${run.id}: fetched ${run.recordsFetched} · imported ${run.recordsImported} · duplicates ${run.duplicatesSuppressed} · rejected ${run.recordsRejected} · errors ${run.errors.length}`,
  );
  console.log(`Snapshot: ${snapshot.events.length} events, ${Buffer.byteLength(JSON.stringify(snapshot))} bytes`);
  if (values['dry-run']) {
    for (const e of snapshot.events.slice(0, 12)) console.log(`  · [${e.sourceId}] ${e.publishedAt?.slice(0, 10) ?? '----------'} ${e.title}`);
  }
  return reports.every((r) => r.ok) ? 0 : 2;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error('FATAL:', err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
