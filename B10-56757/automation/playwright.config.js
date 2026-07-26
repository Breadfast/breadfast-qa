'use strict';

/**
 * B10-56757 — self-contained Playwright project (Perks table management).
 *
 * Architecture (per "each story owns its architecture"):
 *   - This story runs on its OWN config + ./tests.
 *   - Shared assets live ONCE under D:\breadfast-qa\automation and are imported
 *     by relative path: page objects/helpers via ../../../automation/{pages,helpers}
 *     from a spec, and config below via ../../automation/helpers/ConfigReader.
 *   - Dependencies (@playwright/test, mysql2, …) are installed ONCE at the repo
 *     root D:\breadfast-qa\node_modules; Node resolves them by walking up the tree.
 *
 * Run:  cd D:\breadfast-qa\B10-56757\automation  &&  npx playwright test
 */

const { defineConfig, devices } = require('@playwright/test');
const config = require('../../automation/helpers/ConfigReader');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],

  use: {
    baseURL: config.getCardServicesAdminPanelBaseURL(),
    headless: false,
    viewport: { width: 1400, height: 900 },
    screenshot: 'on',
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
