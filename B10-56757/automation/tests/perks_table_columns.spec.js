'use strict';

/**
 * B10-56757 — Perks table management.
 * Spec 2/7 — new Type & Category columns (AC-02).
 *
 * Mirrors BrowserStack case (verbatim title):
 *   - Verify the perks table displays new Type and Category columns
 *
 * Selector provenance + live-DOM (env 502) blocker: PerksPage "B10-56757" block.
 */

const { test, expect } = require('@playwright/test');
const config    = require('../../../automation/helpers/ConfigReader');
const ApiHelper = require('../../../automation/helpers/ApiHelper');
const LoginPage = require('../../../automation/pages/LoginPage');
const PerksPage = require('../../../automation/pages/PerksPage');

// Known perk-type labels a Type cell may show (Figma canonical copy).
const KNOWN_TYPE_TOKENS = ['general', 'category', 'merchant', 'coupon', 'discount'];

test.beforeAll(async ({ request }) => {
  try {
    const token = await ApiHelper.loginAndGetToken(request);
    await ApiHelper.createGeneralCashbackPerk(request, token, [], 5, 'percentage', 1, 'B10-56757 Columns Seed');
  } catch (e) {
    console.warn(`[B10-56757] seed skipped: ${e.message}`);
  }
});

test.beforeEach(async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.fillLoginFormAndSubmit(config.getAdminUserName(), config.getAdminPassword());
});

test.describe('B10-56757 — Perks table columns', () => {
  test('Verify the perks table displays new Type and Category columns', async ({ page }) => {
    const perks = new PerksPage(page);

    await test.step('Navigate to the Perks Management page', async () => {
      await perks.goToPerksTable();
    });

    await test.step('Inspect the column headers — a Type column and a Category column are present', async () => {
      const headers = await perks.getTableColumnHeaders();
      const blob = headers.join(' | ').toLowerCase();
      expect(blob, `Headers: ${JSON.stringify(headers)}`).toContain('type');
      expect(blob, `Headers: ${JSON.stringify(headers)}`).toContain('category');
    });

    await test.step('Inspect a perk row — Type shows a valid type and Category shows a value', async () => {
      const count = await perks.getRowCount();
      test.skip(count === 0, 'No perk rows in env to assert per-row Type/Category values');
      const types = await perks.getColumnValues('Type');
      const cats  = await perks.getColumnValues('Category');

      // The first row's Type must be one of the known perk-type labels …
      const firstType = (types[0] || '').toLowerCase();
      expect(
        KNOWN_TYPE_TOKENS.some((tok) => firstType.includes(tok)),
        `Row Type cell "${types[0]}" is not a recognised perk type`
      ).toBe(true);

      // … and its Category cell must be populated (non-empty).
      expect((cats[0] || '').trim().length, 'Row Category cell must not be empty').toBeGreaterThan(0);
    });
  });
});
