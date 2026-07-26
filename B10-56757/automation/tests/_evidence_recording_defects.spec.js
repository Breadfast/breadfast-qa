'use strict';

/**
 * TEMPORARY evidence-capture spec — NOT part of the AC-mapped suite.
 * Records screen video reproducing B10-57855 and B10-57856 for Jira attachment.
 * Deleted after the recording run; not part of the maintained 7-spec suite.
 *
 * Both tests assert the CORRECT/expected behavior (per AC-03/04/11 and the
 * general error-handling expectation), which is known to currently FAIL given
 * the confirmed defects — with video: 'on' the recording is always kept
 * regardless of pass/fail, so the failure is captured on video either way.
 */

const { test, expect } = require('@playwright/test');
const config    = require('../../../automation/helpers/ConfigReader');
const LoginPage = require('../../../automation/pages/LoginPage');
const PerksPage = require('../../../automation/pages/PerksPage');

test.use({ video: 'on' });

test.beforeEach(async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.fillLoginFormAndSubmit(config.getAdminUserName(), config.getAdminPassword());
});

test('EVIDENCE B10-57855 — Perk ID column sort should reorder rows and must not falsely enable Save order', async ({ page }) => {
  const perks = new PerksPage(page);

  await test.step('Navigate to Perks table and select a Category filter', async () => {
    await perks.goToPerksTable();
    // Live DOM (confirmed via diagnostic run) uses a NATIVE <select class="form-control">
    // inside <div class="filter-field"><label>Category</label>...</div>, not an Angular
    // Material mat-select — PerksPage._filterSelect()'s mat-select/combobox locator does
    // not match it, hence the prior click timeout. Interact with it directly here.
    // .first(): "Category" substring-matches both the Category filter's own div
    // AND the Type filter's div (whose options include "Category cashback").
    const categorySelect = page.locator('div.filter-field').filter({ hasText: 'Category' }).locator('select').first();
    await expect.poll(() => categorySelect.locator('option').count(), { timeout: 10_000 }).toBeGreaterThan(1);
    const matchCount = await page.locator('div.filter-field').filter({ hasText: 'Category' }).count();
    console.log('div.filter-field matching "Category" count:', matchCount);
    const optionTexts = await categorySelect.locator('option').allTextContents();
    console.log('Category select optionTexts:', JSON.stringify(optionTexts));
    const idx = optionTexts.findIndex((t) => t.trim() === 'Breadfast');
    expect(idx, 'Breadfast option should exist in the Category filter').toBeGreaterThan(-1);
    await categorySelect.selectOption({ index: idx });
    await page.locator('button', { hasText: /search/i }).first().click();
    await perks.waitForTableSettled();
  });

  await expect.poll(async () => (await perks.getTableColumnHeaders()).length, { timeout: 10_000 }).toBeGreaterThan(0);
  const headers = await perks.getTableColumnHeaders();
  console.log('B10-57855 evidence — table headers:', JSON.stringify(headers));

  const before = await test.step('Read Perk ID column before clicking sort', async () => {
    return perks.getColumnValues('Perk ID');
  });

  await test.step('Click the Perk ID column sort control', async () => {
    await perks.clickSortColumn('Perk ID');
  });

  const after = await test.step('Read Perk ID column after clicking sort, and Save order button state', async () => {
    return perks.getColumnValues('Perk ID');
  });

  const saveOrderVisible = await perks.isSaveOrderButtonVisible();

  console.log('B10-57855 evidence — before:', before, 'after:', after, 'saveOrderVisible:', saveOrderVisible);

  // Expected: clicking the sort control reorders rows AND does not, by itself,
  // enable "Save order" (no manual reorder was performed). Known to fail per
  // B10-57855 (order unchanged; Save order appears anyway).
  expect(after, 'Perk ID column should be reordered (ascending or descending) after clicking sort').not.toEqual(before);
  expect(saveOrderVisible, '"Save order" should NOT appear from a column-sort click alone').toBe(false);
});

test('DIAGNOSTIC — dump Category filter DOM', async ({ page }) => {
  const perks = new PerksPage(page);
  await perks.goToPerksTable();
  console.log('current URL:', page.url());
  await page.waitForTimeout(2000);
  console.log('current URL after wait:', page.url());
  await page.screenshot({ path: 'diag_perks_page.png', fullPage: true }).catch(() => {});
  const bodyText = await page.locator('body').innerText().catch((e) => `(fail: ${e.message})`);
  console.log('body innerText (first 800 chars):', bodyText.slice(0, 800));

  const labelEl = page.getByText('Category', { exact: true }).first();
  const labelCount = await labelEl.count().catch(() => 0);
  console.log('labelCount for exact "Category" text:', labelCount);
  if (labelCount > 0) {
    const html = await labelEl.evaluate((el) => el.closest('div,form,section')?.outerHTML?.slice(0, 2000)).catch((e) => `(fail: ${e.message})`);
    console.log('CATEGORY label ancestor HTML (truncated):\n', html);
  }

  const selectLikeCount = await page.locator('select, mat-select, [role="combobox"], [role="listbox"]').count().catch(() => 0);
  console.log('select-like element count on page:', selectLikeCount);
  const all = page.locator('select, mat-select, [role="combobox"], [role="listbox"]');
  const n = await all.count();
  for (let i = 0; i < Math.min(n, 10); i++) {
    const outer = await all.nth(i).evaluate((el) => el.outerHTML.slice(0, 300)).catch((e) => `(fail: ${e.message})`);
    console.log(`select-like[${i}]:`, outer);
  }
});

test('EVIDENCE B10-57856 — perks table should show an error state, not hang, when the perks-list request fails', async ({ page }) => {
  const perks = new PerksPage(page);

  await test.step('Intercept the perks-list API call and force a 502 response', async () => {
    await page.route(/\/card\/perks\/list/i, (route) =>
      route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Bad Gateway (simulated for defect evidence)' }),
      })
    );
  });

  await test.step('Navigate to the Perks table with the failure active', async () => {
    await perks.goToPerksTable();
    await page.waitForTimeout(5_000);
  });

  const { tableVisible, spinnerVisible, bannerVisible } = await test.step('Check whether the page recovered (table or an explicit error banner) or is stuck', async () => {
    const tableVisible_ = await page.locator('table tbody tr, mat-row, [role="row"]')
      .first().isVisible({ timeout: 1_000 }).catch(() => false);
    const spinnerVisible_ = await page.locator('mat-spinner, .mat-progress-spinner, [class*="spinner" i], [class*="loading" i]')
      .first().isVisible({ timeout: 1_000 }).catch(() => false);
    // Scoped to a plausible content/banner element (not the sidebar nav) so a
    // stray "List System Errors" nav-link match can't produce a false pass.
    const bannerVisible_ = await page.locator('.toast, .alert, .banner, .error-banner, .snackbar, mat-card, [role="alert"]')
      .filter({ hasText: /error|failed|wrong|retry|try again/i })
      .first().isVisible({ timeout: 1_000 }).catch(() => false);
    return { tableVisible: tableVisible_, spinnerVisible: spinnerVisible_, bannerVisible: bannerVisible_ };
  });

  console.log('B10-57856 evidence — tableVisible:', tableVisible, 'spinnerVisible:', spinnerVisible, 'bannerVisible:', bannerVisible);
  await page.screenshot({ path: 'evidence_57856_at_assertion_time.png', fullPage: true }).catch(() => {});

  // Expected: the page recovers — either shows the table (if the interception
  // missed a retry) or an explicit error banner. Known to fail per B10-57856:
  // neither appears; only the spinner remains stuck (or the page goes blank).
  expect(tableVisible || bannerVisible, 'Page should recover: show data or an explicit error banner, not remain stuck on the spinner').toBe(true);
});
