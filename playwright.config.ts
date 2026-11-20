import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against a production build in demo mode (`--mode e2e`, fixture data, no
 * database), served by `vite preview` with the same security headers as Firebase Hosting.
 * Locally they use the installed Microsoft Edge; CI installs Playwright's Chromium.
 */
const PORT = 4319;
const useEdge = !process.env.CI && process.platform === 'win32';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], ...(useEdge ? { channel: 'msedge' } : {}) } },
    { name: 'mobile', use: { ...devices['Pixel 7'], ...(useEdge ? { channel: 'msedge' } : {}) }, testMatch: /smoke/ },
  ],
  webServer: {
    command: `npx vite build --mode e2e --outDir dist-e2e && npx vite preview --mode e2e --outDir dist-e2e --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
