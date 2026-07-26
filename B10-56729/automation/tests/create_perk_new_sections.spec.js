'use strict';

/**
 * B10-56729 — Create Perk: Form Enhancements
 * Spec 3/5 — New content sections.
 * Covers: AC9  (Usage section — "Short usage description" EN/AR, 200 chars, required),
 *         AC10 (Branches section — "List of valid branches" EN/AR, optional, for
 *               Merchant cashback & Discount/Coupon),
 *         AC11 (Cashback processing — "Short cashback description" EN/AR, 45 chars, optional,
 *               for all cashback perk types).
 *
 * Selectors captured live 2026-07-14 (PerksPage.js "B10-56729" block). Inspection-only.
 */

const { test, expect } = require('@playwright/test');
const config    = require('../../../automation/helpers/ConfigReader');
const LoginPage = require('../../../automation/pages/LoginPage');
const PerksPage = require('../../../automation/pages/PerksPage');

test.beforeEach(async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.fillLoginFormAndSubmit(config.getAdminUserName(), config.getAdminPassword());
});

async function openForm(page, type) {
  const perks = new PerksPage(page);
  await perks.goToPerksPage();
  await perks.clickAddPerk();
  await perks.selectPerkTypeByName(type);
  return perks;
}

test.describe('B10-56729 — new sections (Usage / Branches / Cashback processing)', () => {
  // BrowserStack TC12. NOTE: only General spend cashback is checked here — TC12 also
  // requires repeating for Merchant cashback and Discount/coupon (step 5) and the
  // required-field validation error (step 3), which this test does not cover.
  test('Verify the required Usage section appears after Value with a 200-character description for all perk types', async ({ page }) => {
    const perks = await openForm(page, 'General spend cashback');
    expect(await perks.hasSectionHeader('Usage')).toBeTruthy();
    await expect(page.locator('textarea[formcontrolname="usage_description_en"]')).toBeVisible();
    await expect(page.locator('textarea[formcontrolname="usage_description_ar"]')).toBeVisible();
  });

  // BrowserStack TC13 (step 1/3 — Discount/coupon).
  test('Verify the optional Branches section appears after Usage only for Merchant cashback and Discount/coupon types', async ({ page }) => {
    const perks = await openForm(page, 'Discount/Coupon');
    expect(await perks.hasSectionHeader('Branches')).toBeTruthy();
    await expect(page.locator('textarea[formcontrolname="branches_description_en"]')).toBeVisible();
    await expect(page.locator('textarea[formcontrolname="branches_description_ar"]')).toBeVisible();
  });

  // BrowserStack TC13 (step 4 — General spend cashback must NOT show Branches).
  test('Verify the optional Branches section appears after Usage only for Merchant cashback and Discount/coupon types — absent for General spend cashback', async ({ page }) => {
    const perks = await openForm(page, 'General spend cashback');
    expect(await perks.hasSectionHeader('Branches'),
      'Branches must not appear for General spend cashback').toBeFalsy();
  });

  // BrowserStack TC14 (presence). NOTE: only General spend cashback is checked here — TC14
  // step 5 also requires re-locating the section for General specifically (done) plus the
  // optional-field submit-success case (step 4), which this test does not cover.
  test('Verify the optional Cashback processing section with a 45-character description for cashback perk types', async ({ page }) => {
    const perks = await openForm(page, 'General spend cashback');
    expect(await perks.hasSectionHeader('Cashback processing')).toBeTruthy();
    await expect(page.locator('textarea[formcontrolname="cashback_processing_description_en"]')).toBeVisible();
    await expect(page.locator('textarea[formcontrolname="cashback_processing_description_ar"]')).toBeVisible();
  });

  // BrowserStack TC12 (step 4 — 200-char cap). Enforced via a per-field validation error
  // ("Maximum length should be 200 characters.") + invalid state over the limit (not
  // truncation). Verified live 2026-07-14.
  test('Verify the required Usage section appears after Value with a 200-character description for all perk types — 200-char cap (EN)', async ({ page }) => {
    const perks = await openForm(page, 'General spend cashback');
    const usage = await perks.checkMaxLengthValidation('textarea', 'usage_description_en', 200);
    expect(usage.errorShown, 'expected "Maximum length should be 200 characters." on usage_description_en').toBeTruthy();
  });

  // BrowserStack TC14 (step 3 — 45-char cap). Same enforcement mechanism as above.
  test('Verify the optional Cashback processing section with a 45-character description for cashback perk types — 45-char cap (EN)', async ({ page }) => {
    const perks = await openForm(page, 'General spend cashback');
    const cb = await perks.checkMaxLengthValidation('textarea', 'cashback_processing_description_en', 45);
    expect(cb.errorShown, 'expected "Maximum length should be 45 characters." on cashback_processing_description_en').toBeTruthy();
  });
});
