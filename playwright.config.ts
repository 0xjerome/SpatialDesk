import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against the Vite dev server (HTTPS with a local
 * certificate, IWER emulator injected on localhost) and the Node API server.
 * The emulator lets the XR journeys run in CI; it does not stand in for a
 * physical headset.
 */
const APP_PORT = 8081;
const API_PORT = 8787;
export const PROD_PORT = 8790;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `https://localhost:${APP_PORT}`,
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'node server/index.js',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      env: { PORT: String(API_PORT), ANTHROPIC_API_KEY: '' },
      timeout: 30_000,
    },
    {
      // Production artefact: built client served by the Node server over HTTP.
      command: 'npm run build && node server/index.js',
      url: `http://127.0.0.1:${PROD_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      env: { PORT: String(PROD_PORT), ANTHROPIC_API_KEY: '' },
      timeout: 180_000,
    },
    {
      command: 'npx vite --port 8081 --strictPort',
      url: `https://localhost:${APP_PORT}/`,
      ignoreHTTPSErrors: true,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
