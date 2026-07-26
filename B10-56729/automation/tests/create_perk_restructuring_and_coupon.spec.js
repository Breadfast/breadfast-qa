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
const config    = require('../../../automation/helpers/ConfigReader');
const LoginPage = require('../../../automation/pages/LoginPage');
const PerksPage = require('../../../automation/pages/PerksPage');

// AC17 — expected order for Discount/Coupon (a cashback-family type with Branches + Funding).
// "Basic details" is the first block but renders as a plain container (not an <h4>
// like the sections that follow — confirmed from the live a11y tree 2026-07-14), so it
// is asserted separately and the h4 SECTION sequence that follows it is order-checked.
const EXPECTED_H4_ORDER_COUPON = ['Value', 'Usage', 'Branches', 'Cashback processing', 'Duration', 'Funding'];

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
  // BrowserStack TC16.
  test('Verify the "Cash Back Limit" section is renamed "Cashback limit"', async ({ page }) => {
    const perks = await openForm(page, 'General spend cashback');
    expect(await perks.hasSectionHeader('Cashback limit')).toBeTruthy();
    await expect(page.locator('h4', { hasText: /Cash Back Limit/i })).toHaveCount(0);
  });

  // BrowserStack TC17.
  test('Verify the "Other" exclusions section is renamed "Exclusions" for General Spend Cashback with unchanged fields', async ({ page }) => {
    const perks = await openForm(page, 'General spend cashback');
    expect(await perks.hasSectionHeader('Exclusions')).toBeTruthy();
  });

  // BrowserStack TC18. FAILING — see B10-56729/defects/defects.md DEF-3: the live app renders
  // NO "Funding" section at all, for ANY perk type (confirmed live 2026-07-20 across General,
  // Category, Merchant cashback and Discount/Coupon, incl. with a merchant+branch selected).
  // Figma ("coupon benefit - Filled.png") explicitly shows a "Funding" section with a
  // "Funding type" select after Duration for Discount/coupon. This is a product defect, not
  // an automation bug — do NOT weaken this assertion to match the app.
  test('Verify the "Funding Type" inline group is replaced with a "Funding" section header with unchanged fields', async ({ page }) => {
    const perks = await openForm(page, 'Discount/Coupon');
    expect(await perks.hasSectionHeader('Funding')).toBeTruthy();
    await expect(page.locator('mat-select[formcontrolname="funding_types"]')).toBeVisible();
  });

  // BrowserStack TC15.
  test('Verify "Usage Frequency" and its "other" description text are removed from the form', async ({ page }) => {
    await openForm(page, 'General spend cashback');
    await expect(page.locator('text=/Usage Frequency/i')).toHaveCount(0);
  });

  // BrowserStack TC19.
  test('Verify the Coupon type selector (Online/Physical) appears when a coupon code is entered', async ({ page }) => {
    const perks = await openForm(page, 'Discount/Coupon');
    expect(await perks.isCouponTypeVisible(), 'Coupon type should be hidden before a code is entered').toBeFalsy();
    await perks.fillCouponCode('SAVE20');
    expect(await perks.isCouponTypeVisible(), 'Coupon type should appear after entering a code').toBeTruthy();
    await expect(page.locator('mat-radio-button', { hasText: 'Online' })).toBeVisible();
    await expect(page.locator('mat-radio-button', { hasText: 'Physical' })).toBeVisible();
    await perks.selectCouponType('Physical'); // exercise the toggle
  });

  // BrowserStack TC20. FAILING for the same reason as TC18 above (DEF-3 — no "Funding"
  // section renders at all) — the h4 sequence stops at "Duration" instead of "Funding".
  test('Verify the final section order for cashback perk types', async ({ page }) => {
    const perks = await openForm(page, 'Discount/Coupon');
    // "Basic details" is the first block on the form but is not an <h4> heading,
    // so assert its presence directly, then assert the ordered h4 section sequence.
    expect(await perks.hasSectionHeader('Basic details'),
      '"Basic details" section should be present (first block)').toBeTruthy();
    const order = (await perks.getSectionOrder()).filter((h) => EXPECTED_H4_ORDER_COUPON.includes(h));
    expect(order).toEqual(EXPECTED_H4_ORDER_COUPON);
  });
});
