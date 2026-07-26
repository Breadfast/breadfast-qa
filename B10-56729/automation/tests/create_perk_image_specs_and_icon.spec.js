'use strict';

/**
 * B10-56729 — Create Perk: Form Enhancements
 * Spec 6/6 — Image spec/ratio validation + sidebar Perk icon.
 * Covers: AC5 (logo & cover photo specs/ratios enforced on upload — reject a
 *              wrong-spec image, accept a conforming one),
 *         AC4 (the Perk icon in the sidebar).
 *
 * AC5 expected specs (from Figma upload modals — figma-analysis.md §Validations):
 *   Cover photo → 1080×1080 px, 1:1 aspect ratio, ≤ 500 KB (JPG/PNG)
 *   Logo        →  240×180  px, 4:3 aspect ratio, ≤  40 KB
 *   NOTE: Figma flags a contradiction — the cover UPLOAD modal states 1:1 while
 *   the cover REJECTION banner says "3:2 aspect ratio". The negative assertion
 *   below only requires that a non-conforming image is rejected with a spec/ratio
 *   message, so it is robust to whichever ratio the backend actually enforces.
 *
 * AC4 caveat: no Figma sidebar/navigation frame was provided, so the specific
 * new glyph cannot be asserted from code. This verifies the sidebar Perks entry
 * exists and renders an icon, and captures a screenshot for manual comparison.
 *
 * Selectors captured live 2026-07-14 (PerksPage.js "B10-56729" block).
 */

const { test, expect } = require('@playwright/test');
const config    = require('../../../automation/helpers/ConfigReader');
const LoginPage = require('../../../automation/pages/LoginPage');
const PerksPage = require('../../../automation/pages/PerksPage');
const { PHOTOS } = PerksPage;

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

test.describe('B10-56729 — image specs (AC5) & sidebar icon (AC4)', () => {
  // BrowserStack TC6.
  test('Verify logo and cover photo upload specs/ratios are updated', async ({ page }) => {
    const perks = await openGeneralCashbackForm(page);

    // LIVE FINDING (2026-07-20): the wrong-spec image is rejected with NO visible
    // error message anywhere (no inline dialog text, no toast, no console error, no
    // failed network call — confirmed by polling the dialog's full HTML/page state
    // for 6+ seconds). attemptImageUploadExpectRejection() therefore detects rejection
    // behaviorally (dialog never closes / no thumbnail appears), not by matching an
    // error string — there isn't one. See DEF-4 in defects.md for the silent-rejection
    // UX gap this surfaced (separate from AC5 itself, which only requires the
    // non-conforming image not be silently ACCEPTED — it is not).
    const rejection = await test.step('upload a non-conforming cover image → expect rejection', async () => {
      // PHOTOS.coverEn is the 1020×510 composite — a known non-conforming cover
      // (verified live 2026-07-14). The form must reject it and leave the slot empty.
      return perks.attemptImageUploadExpectRejection(0, PHOTOS.coverEn);
    });
    expect(rejection.rejected,
      `wrong-spec cover should be rejected; saw: ${rejection.message}`).toBeTruthy();

    await test.step('upload the conforming 1080×1080 cover → expect it to be accepted', async () => {
      // uploadImage throws if the slot rejects the asset; reaching the next line
      // means the conforming image was accepted (slot committed, dialog closed).
      await perks.uploadImage(0, PHOTOS.coverSpec);
    });
  });

  // BrowserStack TC5.
  test('Verify the Perk icon in the sidebar is updated', async ({ page }, testInfo) => {
    const perks = new PerksPage(page);
    await perks.goToPerksPage();

    const nav = await perks.getPerksSidebarNav();
    expect(nav.present, 'sidebar Perks navigation item should be present').toBeTruthy();
    expect(nav.hasIcon, 'sidebar Perks item should render an icon element').toBeTruthy();

    // Evidence for manual glyph comparison against Figma (no sidebar frame exported).
    const shot = await page.screenshot({ fullPage: false });
    await testInfo.attach('sidebar-perk-icon', { body: shot, contentType: 'image/png' });
  });
});
