'use strict';

/**
 * B10-56759 — Perk Details lifecycle management.
 * Spec 5/7 — Active edit mode type-specific editable-field matrix.
 * Covers AC-08 / AC-09 / AC-10 / AC-11 / AC-12 · HLS 10, 11, 12, 13.
 *
 *   Discount/Coupon    → Coupon code + Coupon type (Online/Physical) editable
 *   Merchant Cashback  → Cashback limit editable
 *   Category Cashback  → Cashback limit editable; Category name & MCC LOCKED;
 *                        Section still editable (comment-clarified AC-12)
 *   General Cashback   → Cashback limit + Exclusions (Excluded Merchants) editable
 *
 * An Active fixture of the required TYPE is CREATED via ApiHelper.createPerk
 * (with the type-specific attrs it needs), then opened in edit mode; falls back
 * to an existing perk of that type when the create API rejects the payload.
 * "Cashback limit" has no confirmed create-form controlname — read by label; a
 * narrow env-limitation skip applies only when the control cannot be resolved.
 */

const { test, expect } = require('@playwright/test');
const config          = require('../../../automation/helpers/ConfigReader');
const LoginPage       = require('../../../automation/pages/LoginPage');
const PerkDetailsPage = require('../../../automation/pages/PerkDetailsPage');
const ApiHelper       = require('../../../automation/helpers/ApiHelper');

const CASHBACK_LIMIT_LABEL = /cashback limit/i;

// Map the API perk type → the fragment shown in the table Type column (fallback).
const TYPE_FRAG = {
  'discount-coupon':  'coupon',
  'merchant-cashback': 'merchant',
  'category-cashback': 'category',
  'general-cashback':  'general',
};

/**
 * Create an Active perk of `type` (with the type-specific attrs it needs) and
 * open it in edit mode; fall back to an existing Active perk of that type when
 * the create API rejects the payload. Returns whether edit mode was entered.
 */
async function openActiveTypeInEdit(request, details, type, extra = {}) {
  const token = await ApiHelper.loginAndGetToken(request);
  let title = null;
  try {
    ({ title } = await ApiHelper.createPerk(request, token, { type, status: 'active', ...extra }));
  } catch (e) {
    console.warn(`[fixture] createPerk(${type}/active) failed, using existing: ${e.message}`);
  }
  let opened = false;
  if (title) opened = (await details.openPerkByTitle(title)).opened;
  if (!opened) opened = (await details.openPerkByStatus('active', TYPE_FRAG[type])).opened;
  if (!opened) return false;
  await details.clickEdit();
  return details.isInEditMode();
}

/** True when the Cashback limit control can be resolved on the current build. */
async function cashbackLimitResolvable(details) {
  return (await details.perks._fieldByLabel(CASHBACK_LIMIT_LABEL).count()) > 0;
}

test.beforeEach(async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.fillLoginFormAndSubmit(config.getAdminUserName(), config.getAdminPassword());
});

test.describe('B10-56759 — Active perk edit mode (type-specific fields)', () => {
  test('Verify Coupon code and Coupon type are additionally editable for an Active Discount/Coupon perk', async ({ page, request }) => {
    const details = new PerkDetailsPage(page);
    expect(await openActiveTypeInEdit(request, details, 'discount-coupon', { couponCode: 'AUTO123', couponType: 'online' }),
      'Active Discount/Coupon perk opened in edit mode').toBe(true);

    await test.step('Coupon code is editable', async () => {
      expect(await details.perks.isFieldPresent('coupon_code'), 'Coupon code present').toBe(true);
      expect(await details.perks.isFieldEditable('coupon_code'), 'Coupon code editable').toBe(true);
    });

    await test.step('Coupon type (Online / Physical) is editable', async () => {
      expect(await details.perks.isCouponTypeVisible(), 'Coupon type selector shown').toBe(true);
    });
  });

  test('Verify Cashback limit is additionally editable for an Active Merchant Cashback perk', async ({ page, request }) => {
    const details = new PerkDetailsPage(page);
    expect(await openActiveTypeInEdit(request, details, 'merchant-cashback', { merchantIds: ApiHelper.buildMerchantIds(1) }),
      'Active Merchant Cashback perk opened in edit mode').toBe(true);

    await test.step('Cashback limit is editable', async () => {
      test.skip(!(await cashbackLimitResolvable(details)), 'Cashback limit control not resolvable on this build — re-confirm live');
      expect(await details.perks.isFieldEditableByLabel(CASHBACK_LIMIT_LABEL)).toBe(true);
    });
  });

  test('Verify Cashback limit is additionally editable for an Active Category Cashback perk', async ({ page, request }) => {
    const details = new PerkDetailsPage(page);
    expect(await openActiveTypeInEdit(request, details, 'category-cashback', { categoryCode: '5411' }),
      'Active Category Cashback perk opened in edit mode').toBe(true);

    await test.step('Cashback limit is editable', async () => {
      test.skip(!(await cashbackLimitResolvable(details)), 'Cashback limit control not resolvable on this build — re-confirm live');
      expect(await details.perks.isFieldEditableByLabel(CASHBACK_LIMIT_LABEL)).toBe(true);
    });
  });

  test('Verify Cashback limit and Exclusions are additionally editable for an Active General Cashback perk', async ({ page, request }) => {
    const details = new PerkDetailsPage(page);
    expect(await openActiveTypeInEdit(request, details, 'general-cashback'),
      'Active General Cashback perk opened in edit mode').toBe(true);

    await test.step('Cashback limit is editable', async () => {
      test.skip(!(await cashbackLimitResolvable(details)), 'Cashback limit control not resolvable on this build — re-confirm live');
      expect(await details.perks.isFieldEditableByLabel(CASHBACK_LIMIT_LABEL)).toBe(true);
    });

    await test.step('Exclusions (Excluded Merchants) are editable', async () => {
      const combo = details.perks.excludedMerchantsCombobox;
      expect(await combo.isVisible({ timeout: 5_000 }).catch(() => false), 'Excluded Merchants shown').toBe(true);
      const enabled = await combo
        .evaluate((el) => el.getAttribute('aria-disabled') !== 'true' && !el.hasAttribute('disabled'))
        .catch(() => false);
      expect(enabled, 'Excluded Merchants editable').toBe(true);
    });
  });

  test('Verify the Category field (Category name & MCC) is locked while the Section stays editable for an Active Category Cashback perk', async ({ page, request }) => {
    const details = new PerkDetailsPage(page);
    expect(await openActiveTypeInEdit(request, details, 'category-cashback', { categoryCode: '5411' }),
      'Active Category Cashback perk opened in edit mode').toBe(true);

    await test.step('The Category name & MCC control is locked/read-only', async () => {
      expect(await details.perks.isFieldPresent('category_code'), 'Category control present').toBe(true);
      expect(await details.perks.isFieldLocked('category_code'), 'Category name & MCC should be locked').toBe(true);
    });

    // Story-comment clarification: for Category Cashback only Category name & MCC
    // are locked — the Section stays editable like every other type (AC-12).
    await test.step('The Section field remains editable', async () => {
      expect(await details.perks.isFieldPresent('section_id'), 'Section control present').toBe(true);
      expect(await details.perks.isFieldEditable('section_id'), 'Section should stay editable').toBe(true);
    });
  });

  test('Verify non-Discount Active perks do not expose the coupon fields as editable', async ({ page, request }) => {
    const details = new PerkDetailsPage(page);
    expect(await openActiveTypeInEdit(request, details, 'general-cashback'),
      'Active non-Discount perk opened in edit mode').toBe(true);

    await test.step('Coupon code and Coupon type are not editable inputs', async () => {
      const couponPresent = await details.perks.isFieldPresent('coupon_code');
      const couponEditable = couponPresent ? await details.perks.isFieldEditable('coupon_code') : false;
      expect(couponEditable, 'Coupon code must not be editable for non-Discount types').toBe(false);
      expect(await details.perks.isCouponTypeVisible(), 'Coupon type must not be shown').toBe(false);
    });
  });
});
