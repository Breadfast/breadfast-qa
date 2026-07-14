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
const config    = require('../helpers/ConfigReader');
const LoginPage = require('../pages/LoginPage');
const PerksPage = require('../pages/PerksPage');

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
  test('AC1: page title is "Create perk" (sentence case)', async ({ page }) => {
    const perks = await openGeneralCashbackForm(page);
    await expect(page.locator('h1, h4', { hasText: EXPECTED_PAGE_TITLE }).first()).toBeVisible();
    // guard against the old title-case "Create Perks"
    await expect(page.locator('text=Create Perks')).toHaveCount(0);
    expect(perks).toBeTruthy();
  });

  test('AC2: section headings render in sentence case', async ({ page }) => {
    const perks = await openGeneralCashbackForm(page);
    for (const heading of EXPECTED_SECTIONS_GENERAL) {
      await test.step(`section "${heading}" present`, async () => {
        expect(await perks.hasSectionHeader(heading), `missing/mis-cased section: ${heading}`).toBeTruthy();
      });
    }
  });

  test('AC8: image upload labels are "Cover photo EN/AR" and "Logo EN/AR"', async ({ page }) => {
    await openGeneralCashbackForm(page);
    for (const label of EXPECTED_IMAGE_LABELS) {
      await expect(page.locator('label, span', { hasText: new RegExp(`^\\s*${label}\\s*\\*?\\s*$`) }).first(),
        `missing image label: ${label}`).toBeVisible();
    }
    // old naming must be gone (AC8: was "Logo/Image EN")
    await expect(page.locator('text=/Logo\\/Image/i')).toHaveCount(0);
  });

  test('AC3: Perk title EN is capped at 20 characters', async ({ page }) => {
    const perks = await openGeneralCashbackForm(page);
    const accepted = await perks.typeAndReadAccepted('title_en', 'A'.repeat(30));
    expect(accepted.length, `title_en accepted ${accepted.length} chars, expected cap ${TITLE_MAX}`).toBeLessThanOrEqual(TITLE_MAX);
  });

  test('AC3: Perk title AR is capped at 20 characters', async ({ page }) => {
    const perks = await openGeneralCashbackForm(page);
    const accepted = await perks.typeAndReadAccepted('title_ar', 'ن'.repeat(30));
    expect(accepted.length, `title_ar accepted ${accepted.length} chars, expected cap ${TITLE_MAX}`).toBeLessThanOrEqual(TITLE_MAX);
  });
});
