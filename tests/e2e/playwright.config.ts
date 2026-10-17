import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3100);
const API_PORT = Number(process.env.E2E_API_PORT ?? 4100);
const baseURL = `http://localhost:${WEB_PORT}`;
const webDir = path.resolve(import.meta.dirname, '../../apps/web');

export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  workers: 1, // one shared database; the specs run in order (setup first)
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  globalTeardown: './server/teardown.ts',
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure', ...devices['Desktop Chrome'] },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } }, testIgnore: /mobile\.spec\.ts/ },
    { name: 'mobile-360', use: { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true }, dependencies: ['desktop'], testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: [
    {
      command: 'node --import tsx server/backend.ts',
      url: `http://127.0.0.1:${API_PORT}/api/v1/health/live`,
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      env: { E2E_API_PORT: String(API_PORT), E2E_WEB_URL: baseURL },
    },
    {
      command: `pnpm exec next start --port ${WEB_PORT}`,
      cwd: webDir,
      url: `${baseURL}/healthz`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: { API_INTERNAL_URL: `http://127.0.0.1:${API_PORT}`, PORT: String(WEB_PORT) },
    },
  ],
});

