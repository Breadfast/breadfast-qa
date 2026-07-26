'use strict';

/**
 * B10-56757 — Perks table management.
 * Spec 5/7 — reorder + batched "Save order" (AC-11 / AC-12, Rasha/Farah comment).
 *
 * Mirrors BrowserStack cases (verbatim titles):
 *   - Verify 'Save order' button appears only after the perk order is changed
 *   - Verify 'Save order' button is not shown when no order change is made
 *   - Verify the new perk order is persisted upon clicking 'Save order'
 *   - Verify reordering without saving does not persist the new order
 *
 * Persisting the order is DESTRUCTIVE — gated behind RUN_SAVE_ORDER=1.
 * Selector provenance + live-DOM (env 502) blocker: PerksPage "B10-56757" block.
 */

const { test, expect } = require('@playwright/test');
const config    = require('../../../automation/helpers/ConfigReader');
const LoginPage = require('../../../automation/pages/LoginPage');
const PerksPage = require('../../../automation/pages/PerksPage');

/** Apply the first category with ≥2 perks; skip the test when none exists. */
async function enterReorderableCategory(perks) {
  const chosen = await perks.selectCategoryFilter('');
  await perks.applyFilters();
  const count = await perks.getRowCount();
  test.skip(count < 2, `Category "${chosen}" needs ≥2 perks to reorder (has ${count})`);
  return chosen;
}

test.beforeEach(async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.fillLoginFormAndSubmit(config.getAdminUserName(), config.getAdminPassword());
});

test.describe('B10-56757 — Perks table reorder / Save order', () => {
  test("Verify 'Save order' button is not shown when no order change is made", async ({ page }) => {
    const perks = new PerksPage(page);
    await perks.goToPerksTable();
    await enterReorderableCategory(perks);

    await test.step('Without reordering, no Save order button is visible', async () => {
      expect(await perks.isSaveOrderButtonVisible()).toBe(false);
    });
  });

  test("Verify 'Save order' button appears only after the perk order is changed", async ({ page }) => {
    const perks = new PerksPage(page);
    await perks.goToPerksTable();
    await enterReorderableCategory(perks);

    await test.step('Save order hidden before any reorder', async () => {
      expect(await perks.isSaveOrderButtonVisible()).toBe(false);
    });

    await test.step('Reorder a row → Save order button appears', async () => {
      await perks.reorderRow(0, 1);
      expect(await perks.isSaveOrderButtonVisible()).toBe(true);
    });
  });

  test('Verify reordering without saving does not persist the new order', async ({ page }) => {
    const perks = new PerksPage(page);
    await perks.goToPerksTable();
    const chosen = await enterReorderableCategory(perks);

    const original = await perks.readColumnOrder('Title');
    await test.step('Reorder without clicking Save order', async () => {
      await perks.reorderRow(0, 1);
      expect(await perks.readColumnOrder('Title')).not.toEqual(original);
    });

    await test.step('Reload and re-apply the category — original order is retained', async () => {
      await perks.goToPerksTable();
      await perks.selectCategoryFilter(chosen);
      await perks.applyFilters();
      expect(await perks.readColumnOrder('Title')).toEqual(original);
    });
  });

  test("Verify the new perk order is persisted upon clicking 'Save order'", async ({ page, request }) => {
    test.skip(process.env.RUN_SAVE_ORDER !== '1', 'Destructive — set RUN_SAVE_ORDER=1 to run');
    const perks = new PerksPage(page);
    await perks.goToPerksTable();
    const chosen = await enterReorderableCategory(perks);

    const original = await perks.readColumnOrder('Title');
    let saveResult;
    await test.step('Reorder and click Save order (capture the single batched request)', async () => {
      await perks.reorderRow(0, 1);
      const reordered = await perks.readColumnOrder('Title');
      expect(reordered).not.toEqual(original);
      expect(await perks.isSaveOrderButtonVisible()).toBe(true);
      saveResult = await perks.clickSaveOrderAndCapture();
    });

    await test.step('The batched save call succeeded', async () => {
      expect(saveResult.status, `save-order body: ${saveResult.body.slice(0, 200)}`).not.toBeNull();
      expect(saveResult.status).toBeLessThan(400);
    });

    await test.step('Reload + re-apply the category — the saved order persists', async () => {
      await perks.goToPerksTable();
      await perks.selectCategoryFilter(chosen);
      await perks.applyFilters();
      const persisted = await perks.readColumnOrder('Title');
      expect(persisted).not.toEqual(original);
    });
  });
});
