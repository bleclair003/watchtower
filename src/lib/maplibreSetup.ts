import { setWorkerUrl } from 'maplibre-gl';
// MapLibre v6 locates its worker relative to its own module URL, which breaks
// under Vite's dependency pre-bundling and production chunking. Let Vite bundle
// the worker (with its shared imports) into one file and pass the URL in.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

setWorkerUrl(workerUrl);
