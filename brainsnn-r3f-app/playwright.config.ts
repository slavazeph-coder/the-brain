import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // 30s was the outlier, not the exceptions: 20 of the 34 specs already opted
  // into 60s or 90s, and the ones that had not were passing at 26s — inside the
  // limit alone, over it under parallel load. That produces failures that
  // reproduce nowhere and say nothing about the product. Individual
  // setTimeout calls above this value are kept; they mark the genuinely heavy
  // specs and still apply.
  timeout: 60_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4180',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Sandboxes and CI images often ship a Chromium whose build number does not
    // match this Playwright version, and downloading another one is not always
    // allowed. Point at the installed binary instead of failing to launch.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'PORT=4180 npm run dev',
        url: 'http://127.0.0.1:4180/healthz',
        reuseExistingServer: false,
        timeout: 30_000,
      },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { ...devices['Pixel 5'], viewport: { width: 390, height: 844 } } },
  ],
});
