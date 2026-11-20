import { defineConfig } from 'vitest/config';

/** Security-rules tests: run inside `firebase emulators:exec` (see `npm run test:rules`). */
export default defineConfig({
  test: {
    include: ['rules-tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
