'use strict';

/**
 * B10-57393 — App preview modal, core acceptance criteria (BrowserStack TC-53953…TC-53971, TC-53973).
 *
 * TEST NAMES ARE THE BROWSERSTACK TEST-CASE NAMES, verbatim. One test per case, so results map by
 * name with no hand-maintained lookup — the same contract the Java suite honours via @TmsLink.
 * Verify offline with `node ../check_test_name_parity.js` before running.
 *
 * Assertions target the SPEC (the acceptance criteria), so a failure is a reportable defect. The two
 * assertions tagged [DEFECT-EXPECTED] cover filed defects and fail until those are fixed:
 *   B10-58251 — detail sections are not collapsible
 *   B10-58252 — device frame is not 375x812
 *
 * The Create perk form is PROGRESSIVE and its fill ORDER is load-bearing — see
 * PerksPage.fillCompleteMerchantCashbackPerk. Each test builds its own form from a fresh login,
 * because the modal cannot be reopened across a page reload.
 */

const { test, expect } = require('@playwright/test');
const LoginPage = require('../../../automation/pages/LoginPage');
const PerksPage = require('../../../automation/pages/PerksPage');
const AppPreviewModal = require('../../../automation/pages/AppPreviewModal');
const config = require('../../../automation/helpers/ConfigReader');

const SECTION = 'Breadfast';

/** Login → Card Perks → Add perk. The panel is a hash-routed SPA, so navigate via the UI. */
async function openCreatePerkPage(page) {
  const login = new LoginPage(page);
  await login.fillLoginFormAndSubmit(config.getAdminUserName(), config.getAdminPassword());
  const perks = new PerksPage(page);
  await perks.goToPerksPage();
  await perks.clickAddPerk();
  return perks;
}

/** Reach the open App preview modal from a complete valid Merchant-cashback perk. */
async function openPreviewFor(page, overrides = {}) {
  const perks = await openCreatePerkPage(page);
  const data = await perks.fillCompleteMerchantCashbackPerk(overrides);
  await perks.previewAndSaveButton.click();
  const modal = new AppPreviewModal(page);
  await modal.waitUntilVisible().catch(async () => {
    throw new Error('App preview modal did not open. Form validation errors: '
      + JSON.stringify(await perks.getFormValidationErrors()));
  });
  return { perks, modal, data };
}

test.describe('B10-57393 — App preview modal', () => {

  test('Verify clicking "Preview & save" on a valid Create perk form opens the "App preview" modal', async ({ page }) => {
    const { modal } = await openPreviewFor(page);

    expect(await modal.isVisible(), 'the App preview modal should be open').toBe(true);
    expect(await modal.getTitleText()).toBe('App preview');
    expect(await modal.getPreviewLanguageOptions()).toEqual(['English', 'Arabic']);
    await expect(modal.saveButton, 'the modal should render a Save button').toBeVisible();
    await expect(modal.cancelButton, 'the modal should render a Cancel button').toBeVisible();
  });

  test('Verify the "App preview" modal renders both the Card perks tile view and the perk detail screen', async ({ page }) => {
    const { modal, data } = await openPreviewFor(page);

    expect(await modal.countDeviceFrames(), 'two device frames: tile view + detail screen').toBe(2);
    const tile = await modal.getTileText();
    expect(tile, 'tile frame shows the Card perks screen header').toContain('Card perks');
    expect(tile, 'tile frame shows the entered perk title').toContain(data.titleEn);
    expect(await modal.getSectionText('Usage'), 'detail screen shows the entered usage description')
      .toContain(data.usageEn);
    expect(await modal.getPreviewText(), 'preview shows the entered perk subheader').toContain(data.subEn);
  });

  test('Verify the "App preview" device frame measures 375 x 812 (iPhone 13 mini)', async ({ page }) => {
    const { modal } = await openPreviewFor(page);
    const m = await modal.measureFrame(0);

    // [DEFECT-EXPECTED B10-58252] bezel is 375x840 and the inner screen 347x812, so NO element is
    // 375x812, and an ancestor scales the whole mockup to 0.8 (rendered 300x672).
    expect(
      [m.bezelLayout, m.screenLayout],
      `AC requires a 375x812 device frame. Measured bezel ${m.bezelLayout}, inner screen `
      + `${m.screenLayout}, rendered ${m.bezelRendered} because an ancestor applies ${m.transform}.`
    ).toContain('375x812');
  });

  test('Verify scrolling within the device frame reveals all remaining perk detail content', async ({ page }) => {
    const { modal } = await openPreviewFor(page);

    const before = await modal.detailScrollMetrics();
    expect(before.scrollable,
      `detail content should overflow the frame so AC2 can be exercised `
      + `(scrollHeight ${before.scrollHeight} vs clientHeight ${before.clientHeight})`).toBe(true);

    await modal.scrollDetailToBottom();
    const after = await modal.detailScrollMetrics();
    expect(after.scrollTop, 'scrolling inside the frame should move the content').toBeGreaterThan(before.scrollTop);
    expect(after.atBottom, 'the content should scroll all the way to its end').toBe(true);
    expect(await modal.hasSection('Expiry'), 'the last section should be reachable after scrolling').toBe(true);
  });

  test('Verify tapping a detail-screen section header expands and collapses that section', async ({ page }) => {
    const { modal } = await openPreviewFor(page);

    // [DEFECT-EXPECTED B10-58251] the sections are static cards — no chevron, cursor:auto, no
    // role/tabindex, no aria-expanded — and tapping a header changes nothing.
    expect(await modal.sectionOffersCollapseAffordance('Usage'),
      'the "Usage" section header should offer a collapse affordance').toBe(true);

    const first = await modal.tapSectionAndDetectToggle('Usage');
    expect(first.changed, `tapping "Usage" should toggle it (state ${first.before} -> ${first.after})`).toBe(true);
    const second = await modal.tapSectionAndDetectToggle('Usage');
    expect(second.changed, 'tapping "Usage" again should toggle it back').toBe(true);
    const expiry = await modal.tapSectionAndDetectToggle('Expiry');
    expect(expiry.changed, 'tapping "Expiry" should toggle it').toBe(true);
  });

  test('Verify the tile preview shows only the new perk\'s own category and tile, excluding all other categories and perks', async ({ page }) => {
    // Read the perks already in the environment first — they are the control set the preview must exclude.
    const login = new LoginPage(page);
    await login.fillLoginFormAndSubmit(config.getAdminUserName(), config.getAdminPassword());
    const perks = new PerksPage(page);
    await perks.goToPerksPage();
    await perks.waitForTableSettled().catch(() => {});
    const existingTitles = await perks.getColumnValues('Title').catch(() => []);
    const existingCategories = await perks.getColumnValues('Category').catch(() => []);
    expect(existingCategories.length,
      'the environment needs more than one existing perk for isolation to be provable').toBeGreaterThan(1);

    await perks.clickAddPerk();
    const data = await perks.fillCompleteMerchantCashbackPerk();
    await perks.clickPreviewAndSave();
    const modal = new AppPreviewModal(page);
    await modal.waitUntilVisible();

    expect(await modal.getTileCategoryNames(),
      'only the perk\'s own category may appear in the tile view').toEqual([SECTION]);
    const tile = await modal.getTileText();
    expect(tile, 'the perk being created should be shown').toContain(data.titleEn);
    for (const other of existingTitles.filter((t) => t && t !== data.titleEn)) {
      expect(tile, `the tile preview leaked the existing perk "${other}"`).not.toContain(other);
    }
  });

  test('Verify selecting the "Arabic" preview language renders the preview in Arabic with correct RTL layout', async ({ page }) => {
    const { modal, data } = await openPreviewFor(page);

    await modal.selectPreviewLanguage('Arabic');

    expect(await modal.isPreviewLanguageSelected('Arabic')).toBe(true);
    expect(await modal.bothFramesDirection(), 'both frames must render RTL in Arabic')
      .toEqual({ tile: 'rtl', detail: 'rtl' });
    expect(await modal.previewHasArabicScript(), 'the Arabic preview should render Arabic content').toBe(true);
    expect(await modal.getPreviewText(), 'the Arabic perk title entered on the form').toContain(data.titleAr);
    expect(await modal.hasSection('الاستخدام'), 'section labels should be translated').toBe(true);
    // Only the preview content localizes — the admin portal itself is English-only.
    expect(await modal.chromeHasArabicScript(), 'the modal chrome must stay English').toBe(false);
  });

  test('Verify selecting the "English" preview language returns the preview to English with LTR layout', async ({ page }) => {
    const { modal, data } = await openPreviewFor(page);

    await modal.selectPreviewLanguage('Arabic');
    expect(await modal.bothFramesDirection()).toEqual({ tile: 'rtl', detail: 'rtl' });
    await modal.selectPreviewLanguage('English');

    expect(await modal.isPreviewLanguageSelected('English')).toBe(true);
    expect(await modal.bothFramesDirection(), 'both frames must return to LTR')
      .toEqual({ tile: 'ltr', detail: 'ltr' });
    expect(await modal.getPreviewText()).toContain(data.titleEn);
    expect(await modal.previewHasArabicScript(), 'no Arabic content should remain').toBe(false);
  });

  test('Verify the "App preview" modal opens with English pre-selected as the default preview language', async ({ page }) => {
    const { modal } = await openPreviewFor(page);

    expect(await modal.isPreviewLanguageSelected('English'), 'English is pre-selected on open').toBe(true);
    expect(await modal.isPreviewLanguageSelected('Arabic'), 'Arabic is not selected on open').toBe(false);
    expect(await modal.bothFramesDirection()).toEqual({ tile: 'ltr', detail: 'ltr' });
  });

  test('Verify clicking "Save" in the "App preview" modal creates the perk and it appears in the perks list', async ({ page }) => {
    const unique = `15% CB ${String(Date.now()).slice(-5)}`;   // <= 20 chars
    const { perks, modal } = await openPreviewFor(page, { titleEn: unique });

    await modal.clickSave();

    expect(await modal.waitForPerkCreatedToast(),
      'a "Card perk created successfully" confirmation should appear').toBe(true);
    expect(await modal.waitUntilClosed(), 'the modal should close after a successful save').toBe(true);

    await perks.goToPerksPage();
    await perks.waitForTableSettled().catch(() => {});
    expect(await perks.getColumnValues('Title'), 'the saved perk should be listed').toContain(unique);
  });

  test('Verify clicking "Cancel" in the "App preview" modal closes it without saving and keeps the form data', async ({ page }) => {
    const unique = `15% CB ${String(Date.now()).slice(-5)}`;
    const { perks, modal } = await openPreviewFor(page, { titleEn: unique });

    await modal.clickCancel();

    expect(await modal.waitUntilClosed(), 'the modal should close on Cancel').toBe(true);
    await expect(perks.createPerksHeading, 'the Create perk form should be shown again').toBeVisible();
    expect((await modal.pageRestoredCleanly()).clean, 'no stuck backdrop and no scroll lock').toBe(true);
    // The entered data must survive.
    expect(await page.locator('app-bf-input[controlname="title_en"] input').inputValue()).toBe(unique);

    await perks.goToPerksPage();
    await perks.waitForTableSettled().catch(() => {});
    expect(await perks.getColumnValues('Title'), 'Cancel must not create the perk').not.toContain(unique);
  });

  test('Verify clicking "Preview & save" with missing mandatory fields blocks the preview and shows field-level errors', async ({ page }) => {
    const perks = await openCreatePerkPage(page);
    await perks.selectPerkTypeByName('Merchant cashback');

    await perks.clickPreviewAndSave();
    await page.waitForTimeout(1_500);

    const modal = new AppPreviewModal(page);
    expect(await modal.isVisible(), 'the preview must be blocked on an invalid form').toBe(false);
    expect((await perks.getFormValidationErrors()).join(' | '),
      'required-field errors should be surfaced instead').toContain('This field is required');

    // Completing the form must then let the preview through — proving the block was validation-driven.
    await perks.fillCompleteMerchantCashbackPerk();
    await perks.clickPreviewAndSave();
    await modal.waitUntilVisible();
    expect(await modal.isVisible(), 'the preview should open once the form is valid').toBe(true);
  });

  test('Verify every entered Create perk field renders in the correct place in the preview (Merchant cashback)', async ({ page }) => {
    const { modal, data } = await openPreviewFor(page);

    const tile = await modal.getTileText();
    expect(tile, 'category comes from the selected Section').toContain(SECTION);
    expect(tile, 'perk title').toContain(data.titleEn);
    expect(tile, 'perk subheader').toContain(data.subEn);

    expect(await modal.getPreviewText(), 'short perk description').toContain(data.descEn);
    expect(await modal.getSectionText('Usage')).toContain(data.usageEn);
    expect(await modal.getSectionText('Cashback processing')).toContain(data.cbEn);
    expect(await modal.getSectionText('Expiry')).toContain(data.durEn);
    // Branches is a multi-line list; the tail can sit behind the "See more" expander.
    expect(await modal.getSectionText('Branches')).toContain('Promenade Mall');
  });

  test('Verify the Coupon code section renders with the coupon code chip for a "Discount/coupon" perk', async ({ page }) => {
    const perks = await openCreatePerkPage(page);
    const data = await perks.fillCompleteDiscountCouponPerk();
    await perks.clickPreviewAndSave();
    const modal = new AppPreviewModal(page);
    await modal.waitUntilVisible().catch(async () => {
      throw new Error('modal did not open for a Discount/coupon perk. Errors: '
        + JSON.stringify(await perks.getFormValidationErrors()));
    });

    expect(await modal.hasSection('Coupon code'),
      `Coupon code section should render. Sections: ${JSON.stringify(await modal.getSectionNames())}`).toBe(true);
    expect(await modal.getSectionText('Coupon code')).toContain(data.couponCode);

    await modal.selectPreviewLanguage('Arabic');
    expect(await modal.getSectionText('كود الكوبون'), 'the Arabic coupon section keeps the code')
      .toContain(data.couponCode);
    expect(await modal.bothFramesDirection()).toEqual({ tile: 'rtl', detail: 'rtl' });
  });

  test('Verify the perk cover image and logo render correctly in both preview views', async ({ page }) => {
    const { modal } = await openPreviewFor(page);

    const stats = await modal.imageStats();
    expect(stats.count, 'cover + logo in each of the two views').toBeGreaterThanOrEqual(4);
    expect(stats.allLoaded, 'every preview image should decode (non-zero natural size)').toBe(true);
    expect(stats.worstAspectDeviation,
      `a preview image is stretched (worst aspect deviation ${stats.worstAspectDeviation})`).toBeLessThan(0.10);

    await modal.selectPreviewLanguage('Arabic');
    expect((await modal.imageStats()).allLoaded, 'the Arabic artwork should render too').toBe(true);
  });

  test('Verify closing the "App preview" modal with the X icon restores the Create perk page cleanly', async ({ page }) => {
    const { perks, modal, data } = await openPreviewFor(page);

    await modal.closeViaX();

    expect(await modal.waitUntilClosed(), 'the modal should close on the X icon').toBe(true);
    const restored = await modal.pageRestoredCleanly();
    expect(restored.visibleBackdrops, 'no leftover modal backdrop').toBe(0);
    expect(restored.scrollLocked, 'the page scroll should not stay locked').toBe(false);
    await expect(perks.createPerksHeading).toBeVisible();

    // The page must still be interactive and the data intact — the preview reopens.
    await perks.clickPreviewAndSave();
    await modal.waitUntilVisible();
    expect(await modal.getTileText(), 'the reopened preview keeps the form data').toContain(data.titleEn);
  });

  test('Verify the preview reflects the Create perk form values at the moment the modal is opened', async ({ page }) => {
    const { perks, modal, data } = await openPreviewFor(page);
    expect(await modal.getTileText()).toContain(data.titleEn);

    await modal.clickCancel();
    await modal.waitUntilClosed();

    const edited = 'Edited Title 77';
    await perks.fillTitles(edited, data.titleAr);
    await perks.clickPreviewAndSave();
    await modal.waitUntilVisible();

    const tile = await modal.getTileText();
    expect(tile, 'the reopened preview reflects the edit').toContain(edited);
    expect(tile, 'and no longer shows the old title').not.toContain(data.titleEn);
  });

  test('Verify maximum-length content does not break the preview layout, scrolling or the "See more" expander', async ({ page }) => {
    const { modal } = await openPreviewFor(page, PerksPage.maxLengthContent());

    expect((await modal.detailScrollMetrics()).scrollable,
      'max-length content should overflow the frame').toBe(true);

    const seeMore = await modal.clickSeeMoreAndDetectExpansion();
    expect(seeMore.present, 'the long branches list should be truncated behind "See more"').toBe(true);
    expect(seeMore.expanded, '"See more" should reveal additional content').toBe(true);

    await modal.scrollDetailToBottom();
    expect((await modal.detailScrollMetrics()).atBottom,
      'the expanded content should scroll to its end').toBe(true);

    await modal.selectPreviewLanguage('Arabic');
    expect(await modal.bothFramesDirection()).toEqual({ tile: 'rtl', detail: 'rtl' });
    await modal.scrollDetailToBottom();
    expect((await modal.detailScrollMetrics()).atBottom,
      'the Arabic max-length content should scroll to its end').toBe(true);
  });

  test('Verify optional sections left empty are omitted from the perk detail preview', async ({ page }) => {
    const { modal } = await openPreviewFor(page, {
      branchesEn: null, branchesAr: null, cbEn: null, cbAr: null, durEn: null, durAr: null,
    });

    const sections = await modal.getSectionNames();
    expect(await modal.hasSection('Usage'), `populated Usage should render. Sections: ${JSON.stringify(sections)}`).toBe(true);
    expect(await modal.hasSection('Branches'), 'empty Branches should be omitted').toBe(false);
    expect(await modal.hasSection('Cashback processing'), 'empty Cashback processing should be omitted').toBe(false);
    expect(await modal.hasSection('Expiry'), 'empty Expiry should be omitted').toBe(false);

    await modal.selectPreviewLanguage('Arabic');
    expect(await modal.hasSection('الفروع'), 'the Arabic preview should omit it too').toBe(false);
  });

  test('Verify the existing Create perk form and publish flow are not regressed by the "App preview" modal', async ({ page }) => {
    const perks = await openCreatePerkPage(page);

    // Every perk type still renders its own field set progressively.
    for (const type of ['Discount/coupon', 'Category cashback', 'Merchant cashback', 'General spend cashback']) {
      await perks.selectPerkTypeByName(type);
      await expect(perks.createPerksHeading, `form renders for "${type}"`).toBeVisible();
      await expect(perks.sectionDropdown, `Section field renders for "${type}"`).toBeVisible();
    }

    // Image-spec validation still rejects a wrong-sized image.
    await perks.selectPerkTypeByName('Merchant cashback');
    const rejected = await perks.attemptImageUploadExpectRejection(0, PerksPage.PHOTOS.logoSpec)
      .then(() => true).catch(() => false);
    expect(rejected, 'a 240x180 logo must be rejected by the 1080x1080 Cover slot').toBe(true);

    // And the publish path still works end to end through the modal.
    const unique = `15% CB ${String(Date.now()).slice(-5)}`;
    await perks.goToPerksPage();
    await perks.clickAddPerk();
    await perks.fillCompleteMerchantCashbackPerk({ titleEn: unique });
    await perks.clickPreviewAndSave();
    const modal = new AppPreviewModal(page);
    await modal.waitUntilVisible();
    await modal.clickSave();
    expect(await modal.waitForPerkCreatedToast(), 'publishing should still confirm success').toBe(true);

    await perks.goToPerksPage();
    await perks.waitForTableSettled().catch(() => {});
    expect(await perks.getColumnValues('Title')).toContain(unique);
  });
});
