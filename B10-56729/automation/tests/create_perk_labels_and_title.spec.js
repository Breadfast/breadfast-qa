'use strict';

/**
 * B10-56729 — Admin Portal Create Perk: Form Enhancements
 * Spec 1/5 — Global labels, sentence-case headings, renamed image labels, title char cap.
 * Covers: AC1 (page title "Create perk"), AC2 (sentence-case section headings/labels),
 *         AC3 (title limit reduced to 20 chars, EN+AR), AC5/AC8 (renamed Logo/Cover labels).
 *
 * Selectors captured from the live create-perk form 2026-07-14 (see PerksPage.js
 * "B10-56729" block). Inspection-only — no perk is created, so it is non-destructive.
 */

const { test, expect } = require('@playwright/test');
const config    = require('../../../automation/helpers/ConfigReader');
const LoginPage = require('../../../automation/pages/LoginPage');
const PerksPage = require('../../../automation/pages/PerksPage');

const EXPECTED_PAGE_TITLE = 'Create perk';
const EXPECTED_SECTIONS_GENERAL = [
  'Basic details', 'Value', 'Usage', 'Cashback processing', 'Duration', 'Cashback limit', 'Exclusions',
];
const EXPECTED_IMAGE_LABELS = ['Cover photo EN', 'Cover photo AR', 'Logo EN', 'Logo AR'];
const TITLE_MAX = 20; // AC3

test.beforeEach(async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.fillLoginFormAndSubmit(config.getAdminUserName(), config.getAdminPassword());
});

async function openGeneralCashbackForm(page) {
  const perks = new PerksPage(page);
  await perks.goToPerksPage();
  await perks.clickAddPerk();
  await perks.selectPerkTypeByName('General spend cashback');
  return perks;
}

test.describe('B10-56729 — Create Perk labels & title', () => {
  // BrowserStack TC1. NOTE: only General spend cashback is exercised here — TC1 steps 4-6
  // also require re-checking the title after switching to Merchant cashback / Discount-coupon,
  // which this test does not do. Flagged as a coverage gap, not silently claimed as full.
  test('Verify the Create Perk page title reads "Create perk" (sentence case) for all perk types', async ({ page }) => {
    const perks = await openGeneralCashbackForm(page);
    await expect(page.locator('h1, h4', { hasText: EXPECTED_PAGE_TITLE }).first()).toBeVisible();
    // guard against the old title-case "Create Perks"
    await expect(page.locator('text=Create Perks')).toHaveCount(0);
    expect(perks).toBeTruthy();
  });

  // BrowserStack TC2.
  test('Verify all section headings and field labels use sentence case', async ({ page }) => {
    const perks = await openGeneralCashbackForm(page);
    for (const heading of EXPECTED_SECTIONS_GENERAL) {
      await test.step(`section "${heading}" present`, async () => {
        expect(await perks.hasSectionHeader(heading), `missing/mis-cased section: ${heading}`).toBeTruthy();
      });
    }
  });

  // BrowserStack TC11.
  test('Verify logo field labels are renamed to "Logo EN" / "Logo AR"', async ({ page }) => {
    await openGeneralCashbackForm(page);
    for (const label of EXPECTED_IMAGE_LABELS) {
      await expect(page.locator('label, span', { hasText: new RegExp(`^\\s*${label}\\s*\\*?\\s*$`) }).first(),
        `missing image label: ${label}`).toBeVisible();
    }
    // old naming must be gone (AC8: was "Logo/Image EN")
    await expect(page.locator('text=/Logo\\/Image/i')).toHaveCount(0);
  });

  // BrowserStack TC3. The limit is enforced via an inline validation error ("Maximum length
  // should be 20 characters.") + invalid state that blocks save, NOT by truncating input (the
  // field accepts the extra chars but is marked invalid). Verified live 2026-07-14.
  test('Verify the perk title EN field enforces a 20-character limit', async ({ page }) => {
    const perks = await openGeneralCashbackForm(page);
    const r = await perks.checkMaxLengthValidation('input', 'title_en', TITLE_MAX);
    expect(r.errorShown, `expected a "Maximum length should be ${TITLE_MAX} characters." error on title_en`).toBeTruthy();
    expect(r.errorText).toMatch(new RegExp(`maximum length should be\\s*${TITLE_MAX}\\s*characters`, 'i'));
  });

  // BrowserStack TC4.
  test('Verify the perk title AR field enforces a 20-character limit', async ({ page }) => {
    const perks = await openGeneralCashbackForm(page);
    const r = await perks.checkMaxLengthValidation('input', 'title_ar', TITLE_MAX);
    expect(r.errorShown, `expected a "Maximum length should be ${TITLE_MAX} characters." error on title_ar`).toBeTruthy();
    expect(r.errorText).toMatch(new RegExp(`maximum length should be\\s*${TITLE_MAX}\\s*characters`, 'i'));
  });
});
