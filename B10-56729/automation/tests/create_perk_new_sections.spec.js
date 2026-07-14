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
const config    = require('../helpers/ConfigReader');
const LoginPage = require('../pages/LoginPage');
const PerksPage = require('../pages/PerksPage');

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
  test('AC9: Usage section with "Short usage description" EN/AR is present for General cashback', async ({ page }) => {
    const perks = await openForm(page, 'General spend cashback');
    expect(await perks.hasSectionHeader('Usage')).toBeTruthy();
    await expect(page.locator('textarea[formcontrolname="usage_description_en"]')).toBeVisible();
    await expect(page.locator('textarea[formcontrolname="usage_description_ar"]')).toBeVisible();
  });

  test('AC10: Branches section appears for Discount/Coupon', async ({ page }) => {
    const perks = await openForm(page, 'Discount/Coupon');
    expect(await perks.hasSectionHeader('Branches')).toBeTruthy();
    await expect(page.locator('textarea[formcontrolname="branches_description_en"]')).toBeVisible();
    await expect(page.locator('textarea[formcontrolname="branches_description_ar"]')).toBeVisible();
  });

  test('AC10: Branches section is NOT shown for General spend cashback', async ({ page }) => {
    const perks = await openForm(page, 'General spend cashback');
    expect(await perks.hasSectionHeader('Branches'),
      'Branches must not appear for General spend cashback').toBeFalsy();
  });

  test('AC11: Cashback processing "Short cashback description" EN/AR present for cashback perks', async ({ page }) => {
    const perks = await openForm(page, 'General spend cashback');
    expect(await perks.hasSectionHeader('Cashback processing')).toBeTruthy();
    await expect(page.locator('textarea[formcontrolname="cashback_processing_description_en"]')).toBeVisible();
    await expect(page.locator('textarea[formcontrolname="cashback_processing_description_ar"]')).toBeVisible();
  });

  test('AC9/AC11: char caps — usage 200, cashback processing 45 (EN)', async ({ page }) => {
    const perks = await openForm(page, 'General spend cashback');
    await perks.fillUsage('U'.repeat(210), 'ن'.repeat(210));
    const usageLen = (await page.locator('textarea[formcontrolname="usage_description_en"]').inputValue()).length;
    expect(usageLen, `usage EN accepted ${usageLen}, expected ≤ 200`).toBeLessThanOrEqual(200);

    await perks.fillCashbackProcessing('C'.repeat(60), 'ن'.repeat(60));
    const cbLen = (await page.locator('textarea[formcontrolname="cashback_processing_description_en"]').inputValue()).length;
    expect(cbLen, `cashback processing EN accepted ${cbLen}, expected ≤ 45`).toBeLessThanOrEqual(45);
  });
});
