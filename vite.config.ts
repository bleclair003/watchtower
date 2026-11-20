import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

/** The site-wide headers from firebase.json, so `vite preview` (and the E2E tests) enforce the same CSP. */
function hostingHeaders(): Record<string, string> {
  const cfg = JSON.parse(readFileSync(new URL('./firebase.json', import.meta.url), 'utf8')) as {
    hosting: { headers: { source: string; headers: { key: string; value: string }[] }[] };
  };
  const all = cfg.hosting.headers.find((h) => h.source === '**')?.headers ?? [];
  // HSTS and upgrade-insecure-requests would break plain-http localhost.
  return Object.fromEntries(
    all
      .filter((h) => h.key !== 'Strict-Transport-Security')
      .map((h) => [h.key, h.key === 'Content-Security-Policy' ? h.value.replace(/;\s*upgrade-insecure-requests/, '') : h.value]),
  );
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  preview: { headers: hostingHeaders() },
  build: {
    rollupOptions: {
      output: {
        // Keep the ~800 KB MapLibre bundle in its own long-cacheable chunk.
        manualChunks: (id) => (id.includes('maplibre-gl') ? 'maplibre' : undefined),
      },
    },
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Security-rules tests need the emulator: run them with `npm run test:rules`.
    exclude: ['**/node_modules/**', 'rules-tests/**', 'e2e/**'],
  },
});
