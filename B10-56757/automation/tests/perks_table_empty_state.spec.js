'use strict';

/**
 * B10-56757 — Perks table management.
 * Spec 6/7 — filtered empty state (AC-10).
 *
 * Mirrors BrowserStack case (verbatim title):
 *   - Verify empty state is shown when a filter combination returns no results
 *
 * Precondition: a Type+Category combination that matches no perk in the env.
 * Selector provenance + live-DOM (env 502) blocker: PerksPage "B10-56757" block.
 */

const { test, expect } = require('@playwright/test');
const config    = require('../../../automation/helpers/ConfigReader');
const LoginPage = require('../../../automation/pages/LoginPage');
const PerksPage = require('../../../automation/pages/PerksPage');

// Figma "Perks table - Empty state": centred ✕, "No results found",
// subtext "Clear filters or try another search".
const EXPECTED_EMPTY_STATE = 'No results found';

test.beforeEach(async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.fillLoginFormAndSubmit(config.getAdminUserName(), config.getAdminPassword());
});

test.describe('B10-56757 — Perks table empty state', () => {
  test('Verify empty state is shown when a filter combination returns no results', async ({ page }) => {
    const perks = new PerksPage(page);
    await perks.goToPerksTable();

    await test.step('Apply a Type + Category combination that matches no perks', async () => {
      // Pick the LAST category paired with Discount/coupon — the combination least
      // likely to have data. (If the env happens to hold a matching perk, adjust
      // the precondition — see README.)
      const cats = await perks.getCategoryFilterOptions();
      test.skip(cats.length === 0, 'No categories in env to build an empty combination');
      await perks.selectTypeFilter('coupon');
      await perks.selectCategoryFilter(cats[cats.length - 1]);
      await perks.applyFilters();
    });

    await test.step('An in-table empty state is shown and no rows are rendered', async () => {
      expect(await perks.getRowCount()).toBe(0);
      expect(await perks.getEmptyStateText()).toContain(EXPECTED_EMPTY_STATE);
    });
  });
});
