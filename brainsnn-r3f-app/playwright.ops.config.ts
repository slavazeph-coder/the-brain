import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e', testMatch: 'ops.spec.ts', workers: 1,
  timeout: 30000, expect: { timeout: 8000 },
  reporter: [['list']],
  outputDir: 'test-results/ops',
  use: { baseURL: 'http://127.0.0.1:4186', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'node scripts/ops-test-server.mjs', url: 'http://127.0.0.1:4186/healthz', reuseExistingServer: false, timeout: 20000 },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { ...devices['Pixel 5'], viewport: { width: 390, height: 844 } } },
  ],
});
