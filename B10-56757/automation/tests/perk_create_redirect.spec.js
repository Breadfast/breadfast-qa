'use strict';

/**
 * B10-56757 — Perks table management.
 * Spec 7/7 — post-create redirect to the category-filtered, sort-enabled table (AC-05).
 *
 * Mirrors BrowserStack case (verbatim title):
 *   - Verify redirect to category-filtered, sort-enabled table after creating a perk
 *
 * Reuses the existing PerksPage create flow. Creating a perk is DESTRUCTIVE —
 * gated behind RUN_PERK_CREATE=1 (same convention as B10-56729 preview spec).
 * Requires the exact-spec image assets (PerksPage.PHOTOS) to be present.
 * Selector provenance + live-DOM (env 502) blocker: PerksPage "B10-56757" block.
 */

const { test, expect } = require('@playwright/test');
const config    = require('../../../automation/helpers/ConfigReader');
const LoginPage = require('../../../automation/pages/LoginPage');
const PerksPage = require('../../../automation/pages/PerksPage');

test.beforeEach(async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.fillLoginFormAndSubmit(config.getAdminUserName(), config.getAdminPassword());
});

test.describe('B10-56757 — Post-create redirect', () => {
  test('Verify redirect to category-filtered, sort-enabled table after creating a perk', async ({ page }) => {
    test.skip(process.env.RUN_PERK_CREATE !== '1', 'Destructive — set RUN_PERK_CREATE=1 to run');
    const perks = new PerksPage(page);

    await test.step('Create a new perk and submit the creation form', async () => {
      await perks.goToPerksPage();
      await perks.clickAddPerk();
      await perks.selectPerkTypeByName('General spend cashback');
      await perks.fillGeneralCashbackMandatory({
        titleEn: 'B10-56757 Redirect',
        titleAr: 'إعادة توجيه',
      });
      await perks.submitPerkExpectSuccess();   // asserts 200 + navigation to /#/perks
    });

    await test.step('The admin lands on the perks table', async () => {
      await expect(page).toHaveURL(/#\/perks$/, { timeout: 30_000 });
    });

    await test.step('The Category filter is auto-set to the new perk\'s category', async () => {
      const activeCategory = await perks.getActiveCategoryFilterValue();
      expect(activeCategory.length, 'Category filter should be auto-populated after create').toBeGreaterThan(0);
    });

    await test.step('Sorting is enabled in this category-filtered view', async () => {
      expect(await perks.isSortingAvailable()).toBe(true);
    });
  });
});
