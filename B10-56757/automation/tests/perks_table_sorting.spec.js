'use strict';

/**
 * B10-56757 — Perks table management.
 * Spec 3/7 — category-scoped sorting visibility (AC-03 / AC-04).
 *
 * Mirrors BrowserStack cases (verbatim titles):
 *   - Verify column sorting is hidden when no category filter is selected
 *   - Verify column sorting becomes available when a category filter is selected
 *
 * DESIGN NOTE: the Figma design realizes AC-03/04 "sorting" as category-scoped
 * drag-and-drop ROW reordering (6-dot handles), not column-header sort arrows
 * (figma-analysis "Gaps vs spec"). isSortingAvailable() detects that affordance.
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

test.describe('B10-56757 — Perks table sorting', () => {
  test('Verify column sorting is hidden when no category filter is selected', async ({ page }) => {
    const perks = new PerksPage(page);

    await test.step('Navigate to the Perks Management page without a Category filter', async () => {
      await perks.goToPerksTable();
    });

    await test.step('No sorting/reorder affordance is shown across the table', async () => {
      expect(
        await perks.isSortingAvailable(),
        'Sorting/reorder must be hidden in the all-perks view (no category filter)'
      ).toBe(false);
    });
  });

  test('Verify column sorting becomes available when a category filter is selected', async ({ page }) => {
    const perks = new PerksPage(page);
    await perks.goToPerksTable();

    let chosen = '';
    await test.step('Select an existing category and apply it', async () => {
      chosen = await perks.selectCategoryFilter('');
      await perks.applyFilters();
    });

    await test.step('Sorting/reorder becomes available in the category view', async () => {
      const count = await perks.getRowCount();
      test.skip(count === 0, `No perks in category "${chosen}" to enable sorting`);
      expect(
        await perks.isSortingAvailable(),
        'Sorting/reorder must be available once a category filter is applied'
      ).toBe(true);
    });

    await test.step('Reordering stays scoped to the selected category', async () => {
      const count = await perks.getRowCount();
      test.skip(count < 2, 'Need at least two perks in the category to verify scoped reorder');
      const before = await perks.readColumnOrder('Title');
      await perks.reorderRow(0, 1);
      const after = await perks.readColumnOrder('Title');
      // Order changed within the view, and every visible row is still the same category.
      expect(after).not.toEqual(before);
      const cats = await perks.getColumnValues('Category');
      for (const c of cats) expect(c.toLowerCase()).toContain(chosen.toLowerCase().trim());
    });
  });
});
