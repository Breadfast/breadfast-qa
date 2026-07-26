'use strict';

/**
 * B10-56729 — Create Perk: Form Enhancements
 * Spec 2/5 — Basic details new fields.
 * Covers: AC6 (required "Section" dropdown for all perk types),
 *         AC7 (Perk subheader EN/AR, 30 chars — always shown for General cashback,
 *              shown for coupon/merchant perks only when "Breadfast" is the merchant).
 *
 * Selectors captured live 2026-07-14 (PerksPage.js "B10-56729" block). Inspection-only.
 */

const { test, expect } = require('@playwright/test');
const config    = require('../../../automation/helpers/ConfigReader');
const LoginPage = require('../../../automation/pages/LoginPage');
const PerksPage = require('../../../automation/pages/PerksPage');

const SUBHEADER_MAX = 30; // AC7
const PERK_TYPES = ['General spend cashback', 'Category cashback', 'Merchant cashback', 'Discount/Coupon'];

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

test.describe('B10-56729 — Basic details section', () => {
  // BrowserStack TC7 (parameterized across all 4 perk types — step 3's required-field
  // validation-error sub-case is NOT covered here, only dropdown presence per type).
  for (const type of PERK_TYPES) {
    test(`Verify the required Section dropdown is present in Basic details for all perk types — ${type}`, async ({ page }) => {
      await openForm(page, type);
      await expect(page.locator('mat-select[formcontrolname="section_id"]'),
        `Section dropdown missing for ${type}`).toBeVisible();
    });
  }

  // BrowserStack TC7 (step 2 — dropdown expands and lists options).
  test('Verify the required Section dropdown is present in Basic details for all perk types — options exposed', async ({ page }) => {
    const perks = await openForm(page, 'General spend cashback');
    const options = await perks.getSectionOptions();
    expect(options.length, 'Section dropdown has no options').toBeGreaterThan(0);
  });

  // BrowserStack TC9.
  test('Verify Perk subheader EN/AR always appears by default for General cashback', async ({ page }) => {
    const perks = await openForm(page, 'General spend cashback');
    expect(await perks.isSubheaderVisible(), 'subheader should always show for General cashback').toBeTruthy();
    await expect(page.locator('app-bf-input[controlname="subheader_ar"] input')).toBeVisible();
  });

  // BrowserStack TC10. Enforced via a "Maximum length should be 30 characters." validation
  // error + invalid state over the limit (not truncation). Verified live 2026-07-14.
  // NOTE: only subheader EN is checked here — TC10 step 4 also requires AR (30 chars, then a
  // 31st) which this test does not cover; flagged as a coverage gap.
  test('Verify Perk subheader EN/AR enforce a 30-character limit', async ({ page }) => {
    const perks = await openForm(page, 'General spend cashback');
    const r = await perks.checkMaxLengthValidation('input', 'subheader_en', SUBHEADER_MAX);
    expect(r.errorShown, `expected a "Maximum length should be ${SUBHEADER_MAX} characters." error on subheader_en`).toBeTruthy();
    expect(r.errorText).toMatch(new RegExp(`maximum length should be\\s*${SUBHEADER_MAX}\\s*characters`, 'i'));
  });
});
