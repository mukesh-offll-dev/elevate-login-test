import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

const channel = process.env.BROWSER_CHANNEL || 'chrome';
const videoOff = (process.env.VIDEO || 'off').toLowerCase() === 'off';

/**
 * Tracing is configured here ONCE ('retain-on-failure').
 * Specs must never call context.tracing.start() - that would throw
 * "Tracing has been already started".
 */
export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // The signup page pulls in a large amount of third-party marketing script.
  // Capping workers keeps local runs from starving each other and producing
  // load-induced timeouts that look like real failures.
  workers: process.env.CI ? 2 : 4,
  timeout: 120_000,
  expect: { timeout: 15_000 },

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['junit', { outputFile: 'artifacts/junit-results.xml' }],
  ],

  use: {
    // Use the installed system Chrome; no Chromium download required.
    channel,
    headless: !process.env.HEADED,
    viewport: { width: 1536, height: 864 },
    actionTimeout: 30_000,
    navigationTimeout: 45_000,
    ignoreHTTPSErrors: false,
    screenshot: 'only-on-failure',
    // 'off' avoids the FFmpeg dependency entirely.
    video: videoOff ? 'off' : 'retain-on-failure',
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chrome',
      use: { ...devices['Desktop Chrome'], channel },
    },
  ],
});
