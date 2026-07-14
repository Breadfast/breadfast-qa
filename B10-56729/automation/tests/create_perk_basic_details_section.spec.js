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
const config    = require('../helpers/ConfigReader');
const LoginPage = require('../pages/LoginPage');
const PerksPage = require('../pages/PerksPage');

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
  for (const type of PERK_TYPES) {
    test(`AC6: required "Section" dropdown is present for ${type}`, async ({ page }) => {
      await openForm(page, type);
      await expect(page.locator('mat-select[formcontrolname="section_id"]'),
        `Section dropdown missing for ${type}`).toBeVisible();
    });
  }

  test('AC6: Section dropdown exposes selectable options', async ({ page }) => {
    const perks = await openForm(page, 'General spend cashback');
    const options = await perks.getSectionOptions();
    expect(options.length, 'Section dropdown has no options').toBeGreaterThan(0);
  });

  test('AC7: Perk subheader EN/AR are shown by default for General spend cashback', async ({ page }) => {
    const perks = await openForm(page, 'General spend cashback');
    expect(await perks.isSubheaderVisible(), 'subheader should always show for General cashback').toBeTruthy();
    await expect(page.locator('app-bf-input[controlname="subheader_ar"] input')).toBeVisible();
  });

  test('AC7: Perk subheader EN is capped at 30 characters', async ({ page }) => {
    const perks = await openForm(page, 'General spend cashback');
    const accepted = await perks.typeAndReadAccepted('subheader_en', 'A'.repeat(45));
    expect(accepted.length, `subheader_en accepted ${accepted.length}, expected cap ${SUBHEADER_MAX}`).toBeLessThanOrEqual(SUBHEADER_MAX);
  });
});
