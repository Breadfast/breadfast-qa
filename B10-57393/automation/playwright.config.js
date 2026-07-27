'use strict';

/**
 * B10-57393 — Playwright config for the story's own specs.
 *
 * The specs live in the story folder (CLAUDE.md: "a legacy story's automation/tests/ holds its
 * specs") while the shared page objects live once at D:\breadfast-qa\automation\. Playwright only
 * discovers files under `testDir`, so pointing a config at the story's tests is what lets the specs
 * run in place instead of being copied into the runnable framework and having their requires rewritten.
 *
 * Run from the repo root:
 *   npx playwright test --config=B10-57393/automation/playwright.config.js
 */

const { defineConfig, devices } = require('@playwright/test');
const config = require('../../automation/helpers/ConfigReader');

module.exports = defineConfig({
  testDir: './tests',
  // A single test builds a COMPLETE perk form (4 image uploads through a dialog, a nested merchant
  // menu, a readonly date picker) before it can even open the modal, so the per-test budget is high.
  timeout: 420_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  // 0, to match how the Java suite ACTUALLY runs. RetryAnalyzer looks like it applies — but
  // RetryListener is declared only in b10-57393-tests.xml, and the pom hardcodes its own
  // <suiteXmlFiles>, so surefire never reads the story suite and `mvn test -Dtest=...` (the
  // documented command) loads none of its listeners. Measured on the 2026-07-28 run: 4 failures,
  // 0 retries, 43 config methods for 21 tests = 21 setups + 21 teardowns, i.e. no second attempt
  // anywhere. Giving Playwright a retry the other stack does not get would flatter it.
  retries: 0,
  reporter: [
    ['list'],
    ['json', { outputFile: '../execution-reports/playwright-results.json' }],
    ['html', { open: 'never', outputFolder: '../execution-reports/playwright-report' }],
  ],
  outputDir: '../execution-reports/playwright-artifacts',

  use: {
    baseURL: config.getCardServicesAdminPanelBaseURL(),
    headless: true,
    viewport: { width: 1600, height: 1000 },
    screenshot: 'on',                 // evidence for every test, passed or failed
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
