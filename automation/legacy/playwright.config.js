'use strict';

/**
 * Legacy Playwright suite — the specs that used to live ONLY in the external, un-versioned
 * `D:\Playwright\b55168_pom\tests\` (card-service KYC, MID exclusion, cashback, replacement fee).
 *
 * They were imported into the repo on 2026-08-10 so the workflow is self-contained: a colleague
 * who clones breadfast-qa can run them without any folder outside the repo existing on their
 * machine. Their `../helpers` / `../pages` requires were rewritten to `../../helpers` /
 * `../../pages` (the shared objects live once at automation/), and the machine-absolute evidence
 * paths were rewritten repo-relative.
 *
 * This config is the direct replacement for the pom's root playwright.config.js. Per-story specs
 * keep their own config under `B10-<key>/automation/playwright.config.js` — that pattern is
 * unchanged.
 *
 * Run from the repo root:
 *   npx playwright test --config=automation/legacy/playwright.config.js
 *   npx playwright test --config=automation/legacy/playwright.config.js tests/kyc_file_number.spec.js
 */

const { defineConfig, devices } = require('@playwright/test');
const config = require('../helpers/ConfigReader');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: './playwright-report' }],
  ],
  outputDir: './test-results',

  use: {
    baseURL: config.getCardServicesAdminPanelBaseURL(),
    headless: false,
    viewport: { width: 1400, height: 900 },
    screenshot: 'on',          // evidence for EVERY test (passed + failed) — release-validation.md §2.1
    video: 'retain-on-failure',
    trace: 'on',
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
