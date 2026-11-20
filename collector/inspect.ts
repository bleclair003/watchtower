/**
 * Developer tool: prints how each adapter classifies live items (category, regions, matched terms).
 * Writes nothing.  Usage: node collector/inspect.ts bbc-world aljazeera
 */
import { ADAPTERS } from './adapters/index.ts';
import { politeFetch } from './lib/http.ts';

const wanted = process.argv.slice(2);
for (const a of ADAPTERS.filter((x) => !wanted.length || wanted.includes(x.sourceId))) {
  const res = await a.collect({ now: Date.now(), state: null, fetch: (url, v) => politeFetch(url, { validators: v }) });
  console.log(`\n== ${a.sourceId}: ${res.events.length} events`);
  for (const e of res.events) {
    const m = e.metadata ?? {};
    console.log(
      `${e.category.padEnd(10)} ${(e.regionIds.join(',') || '-').padEnd(28)} ${(e.countryCodes.join(',') || '-').padEnd(10)} ${e.title.slice(0, 90)}` +
        `  [geo:${JSON.stringify(m.geoTerms ?? [])} topic:${String(m.topicTerm ?? '')}]`,
    );
  }
}
