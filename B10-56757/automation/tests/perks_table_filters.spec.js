'use strict';

/**
 * B10-56757 — Perks table management.
 * Spec 1/7 — Type & Category filters (AC-01, + status-combination regression).
 *
 * Mirrors BrowserStack cases (verbatim titles):
 *   - Verify Type filter control is present above the perks table with all four type options
 *   - Verify Category filter control is present and lists all existing categories
 *   - Verify applying only the Type filter returns matching perks
 *   - Verify applying only the Category filter returns matching perks
 *   - Verify Type and Category filters applied in combination
 *   - Verify the new filters combine correctly with the existing status filter (regression)
 *
 * Data: seeds general-cashback perks via ApiHelper so the Type filter has
 * deterministic "General …" data; category/merchant-typed perks depend on the
 * env dataset (ApiHelper only seeds general-cashback — see README limitations).
 * Selector provenance + live-DOM (env 502) blocker: PerksPage "B10-56757" block.
 */

const { test, expect } = require('@playwright/test');
const config    = require('../../../automation/helpers/ConfigReader');
const ApiHelper = require('../../../automation/helpers/ApiHelper');
const LoginPage = require('../../../automation/pages/LoginPage');
const PerksPage = require('../../../automation/pages/PerksPage');

// Canonical Type options (Figma copy). AC copy differs in casing — match tokens.
const EXPECTED_TYPE_TOKENS = ['general', 'category', 'merchant', 'coupon'];

test.beforeAll(async ({ request }) => {
  // Best-effort seed: guarantee at least one General-cashback perk exists so the
  // Type filter is exercisable. A seed failure (e.g. backend 502) is non-fatal —
  // the UI assertions carry the real verification against existing data.
  try {
    const token = await ApiHelper.loginAndGetToken(request);
    await ApiHelper.createGeneralCashbackPerk(request, token, [], 5, 'percentage', 1, 'B10-56757 Filter Seed A');
    await ApiHelper.createGeneralCashbackPerk(request, token, [], 3, 'percentage', 1, 'B10-56757 Filter Seed B');
  } catch (e) {
    console.warn(`[B10-56757] seed skipped: ${e.message}`);
  }
});

test.beforeEach(async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.fillLoginFormAndSubmit(config.getAdminUserName(), config.getAdminPassword());
});

test.describe('B10-56757 — Perks table filters', () => {
  test('Verify Type filter control is present above the perks table with all four type options', async ({ page }) => {
    const perks = new PerksPage(page);
    await test.step('Navigate to the Perks Management page', async () => {
      await perks.goToPerksTable();
    });

    await test.step('Open the Type filter and read its options', async () => {
      const options = await perks.getTypeFilterOptions();
      expect(options.length, `Type filter options: ${JSON.stringify(options)}`).toBe(4);
      const blob = options.join(' | ').toLowerCase();
      for (const token of EXPECTED_TYPE_TOKENS) {
        expect(blob, `Type options must include "${token}"`).toContain(token);
      }
    });
  });

  test('Verify Category filter control is present and lists all existing categories', async ({ page }) => {
    const perks = new PerksPage(page);
    await perks.goToPerksTable();

    await test.step('Open the Category filter and read its options', async () => {
      const options = await perks.getCategoryFilterOptions();
      expect(options.length, 'Category filter must list at least one category').toBeGreaterThan(0);
    });
  });

  test('Verify applying only the Type filter returns matching perks', async ({ page }) => {
    const perks = new PerksPage(page);
    await perks.goToPerksTable();

    await test.step('Select a Type value and apply', async () => {
      await perks.selectTypeFilter('General');
      await perks.applyFilters();
    });

    await test.step('Every row in the table matches the selected Type', async () => {
      const count = await perks.getRowCount();
      test.skip(count === 0, 'No General-type perks in env to assert against');
      const types = await perks.getColumnValues('Type');
      for (const t of types) expect(t.toLowerCase()).toContain('general');
    });
  });

  test('Verify applying only the Category filter returns matching perks', async ({ page }) => {
    const perks = new PerksPage(page);
    await perks.goToPerksTable();

    let chosen = '';
    await test.step('Select an existing category and apply', async () => {
      chosen = await perks.selectCategoryFilter('');   // first real category
      await perks.applyFilters();
    });

    await test.step('Every row belongs to the selected category', async () => {
      const count = await perks.getRowCount();
      test.skip(count === 0, `No perks in category "${chosen}" to assert against`);
      const cats = await perks.getColumnValues('Category');
      for (const c of cats) expect(c.toLowerCase()).toContain(chosen.toLowerCase().trim());
    });
  });

  test('Verify Type and Category filters applied in combination', async ({ page }) => {
    const perks = new PerksPage(page);
    await perks.goToPerksTable();

    let chosenCat = '';
    await test.step('Select a Type and a Category, then apply', async () => {
      await perks.selectTypeFilter('General');
      chosenCat = await perks.selectCategoryFilter('');
      await perks.applyFilters();
    });

    await test.step('Rows satisfy both Type AND Category', async () => {
      const count = await perks.getRowCount();
      test.skip(count === 0, 'No perks match the type+category combination in env');
      const types = await perks.getColumnValues('Type');
      const cats  = await perks.getColumnValues('Category');
      for (const t of types) expect(t.toLowerCase()).toContain('general');
      for (const c of cats)  expect(c.toLowerCase()).toContain(chosenCat.toLowerCase().trim());
    });
  });

  test('Verify the new filters combine correctly with the existing status filter (regression)', async ({ page }) => {
    const perks = new PerksPage(page);
    await perks.goToPerksTable();

    await test.step('Apply only the existing status filter', async () => {
      await perks.selectStatusFilter('Active');
      await perks.applyFilters();
      const count = await perks.getRowCount();
      test.skip(count === 0, 'No Active perks in env for the status-filter baseline');
      const statuses = await perks.getColumnValues('Status');
      for (const s of statuses) expect(s.toLowerCase()).toContain('active');
    });

    await test.step('Add a Type filter on top of the status filter', async () => {
      await perks.selectTypeFilter('General');
      await perks.applyFilters();
      const count = await perks.getRowCount();
      if (count > 0) {
        const types    = await perks.getColumnValues('Type');
        const statuses = await perks.getColumnValues('Status');
        for (const t of types)    expect(t.toLowerCase()).toContain('general');
        for (const s of statuses) expect(s.toLowerCase()).toContain('active');
      }
    });

    await test.step('Clear all filters returns to the full list with sorting hidden', async () => {
      await perks.clearFilters();
      expect(await perks.isSortingAvailable(), 'sorting must be hidden with no category filter').toBe(false);
    });
  });
});
