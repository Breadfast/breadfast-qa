'use strict';

/**
 * B10-56729 — Create Perk: Form Enhancements
 * Spec 4/5 — Section restructuring + coupon type.
 * Covers: AC12 ("Usage Frequency"/"other" description removed),
 *         AC13 ("Cash Back Limit" → "Cashback limit"),
 *         AC14 ("Other" → "Exclusions" for General Spend Cashback),
 *         AC15 ("Funding Type" inline → "Funding" section header),
 *         AC16 (Coupon type Online/Physical appears on coupon-code entry),
 *         AC17 (final section order for cashback perk types).
 *
 * Selectors captured live 2026-07-14 (PerksPage.js "B10-56729" block). Inspection-only.
 */

const { test, expect } = require('@playwright/test');
const config    = require('../helpers/ConfigReader');
const LoginPage = require('../pages/LoginPage');
const PerksPage = require('../pages/PerksPage');

// AC17 — expected order for Discount/Coupon (a cashback-family type with Branches + Funding).
const EXPECTED_ORDER_COUPON = ['Basic details', 'Value', 'Usage', 'Branches', 'Cashback processing', 'Duration', 'Funding'];

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

test.describe('B10-56729 — restructuring & coupon type', () => {
  test('AC13: "Cashback limit" section header (renamed from "Cash Back Limit")', async ({ page }) => {
    const perks = await openForm(page, 'General spend cashback');
    expect(await perks.hasSectionHeader('Cashback limit')).toBeTruthy();
    await expect(page.locator('h4', { hasText: /Cash Back Limit/i })).toHaveCount(0);
  });

  test('AC14: "Exclusions" section header (renamed from "Other") for General Spend Cashback', async ({ page }) => {
    const perks = await openForm(page, 'General spend cashback');
    expect(await perks.hasSectionHeader('Exclusions')).toBeTruthy();
  });

  test('AC15: "Funding" section header (was inline "Funding Type")', async ({ page }) => {
    const perks = await openForm(page, 'Discount/Coupon');
    expect(await perks.hasSectionHeader('Funding')).toBeTruthy();
    await expect(page.locator('mat-select[formcontrolname="funding_types"]')).toBeVisible();
  });

  test('AC12: "Usage Frequency" is removed from the form', async ({ page }) => {
    await openForm(page, 'General spend cashback');
    await expect(page.locator('text=/Usage Frequency/i')).toHaveCount(0);
  });

  test('AC16: Coupon type (Online/Physical) appears after a coupon code is entered', async ({ page }) => {
    const perks = await openForm(page, 'Discount/Coupon');
    expect(await perks.isCouponTypeVisible(), 'Coupon type should be hidden before a code is entered').toBeFalsy();
    await perks.fillCouponCode('SAVE20');
    expect(await perks.isCouponTypeVisible(), 'Coupon type should appear after entering a code').toBeTruthy();
    await expect(page.locator('mat-radio-button', { hasText: 'Online' })).toBeVisible();
    await expect(page.locator('mat-radio-button', { hasText: 'Physical' })).toBeVisible();
    await perks.selectCouponType('Physical'); // exercise the toggle
  });

  test('AC17: section order for Discount/Coupon matches the spec', async ({ page }) => {
    const perks = await openForm(page, 'Discount/Coupon');
    const order = (await perks.getSectionOrder()).filter((h) => EXPECTED_ORDER_COUPON.includes(h));
    expect(order).toEqual(EXPECTED_ORDER_COUPON);
  });
});
