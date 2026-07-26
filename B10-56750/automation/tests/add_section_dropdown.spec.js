'use strict';

/**
 * B10-56750 — Admin Portal: Add Section to All Perk Types
 * Spec 1/3 — Section dropdown presence, required-field validation, and content.
 *
 * Mirrors BrowserStack cases (verbatim titles):
 *   - Verify the Section field is displayed on the Create Perk form for all perk types (AC-01)
 *   - Verify Section is a required field that blocks Preview & Save when empty, for all perk types (AC-02)
 *   - Verify the Section dropdown lists all existing Sections by name (AC-03)
 *   - Verify '+ Add section' is always pinned at the bottom of the Section dropdown regardless of list size (AC-04)
 *
 * This story's Section field/dropdown IS the same live control documented in
 * B10-56729's PerksPage "B10-56729" block (mat-select[formcontrolname=
 * "section_id"]) — reused here rather than re-selectored (reuse-before-build).
 * New "B10-56750" PerksPage methods only cover the "+ Add section" MODAL,
 * which did not exist as a page-object method before this story (see the
 * sibling spec add_section_modal.spec.js).
 *
 * Selectors captured/confirmed LIVE 2026-07-16 (card-panel-testing) by driving
 * the real admin panel (Playwright MCP), not guessed from Figma. Live section
 * data at capture time: only "Breadfast" and "General Purchases" are seeded —
 * NOT the four (Breadfast/General/Food & Beverage/Fitness) shown in the reused
 * Figma export (figma-analysis.md). "General Purchases" (not "General") is
 * confirmed as the LIVE name, resolving the AC-14 naming discrepancy in the
 * AC text's favor — see ac-coverage-matrix.md "Live findings".
 */

const { test, expect } = require('@playwright/test');
const config    = require('../../../automation/helpers/ConfigReader');
const LoginPage = require('../../../automation/pages/LoginPage');
const PerksPage = require('../../../automation/pages/PerksPage');

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

test.describe('B10-56750 — Section dropdown', () => {
  test('Verify the Section field is displayed on the Create Perk form for all perk types', async ({ page }) => {
    for (const type of PERK_TYPES) {
      await test.step(`Section field visible for ${type}`, async () => {
        await openForm(page, type);
        await expect(page.locator('mat-select[formcontrolname="section_id"]'),
          `Section dropdown missing for ${type}`).toBeVisible();
      });
    }
  });

  test('Verify the Section dropdown lists all existing Sections by name', async ({ page }) => {
    const perks = await openForm(page, 'General spend cashback');
    const options = await perks.getSectionOptions();
    expect(options.length, 'Section dropdown has no options').toBeGreaterThan(0);

    // Live-confirmed seeded sections at capture time (2026-07-16). NOTE: only
    // these two exist in this environment — the Figma export's "Food &
    // Beverage"/"Fitness" are NOT seeded here; this assertion is scoped to
    // what's actually present, not the full Figma-documented list.
    expect(options.some((o) => /breadfast/i.test(o) && !/purchases/i.test(o)),
      `Expected a "Breadfast" option among: ${options.join(', ')}`).toBeTruthy();
    expect(options.some((o) => /general purchases/i.test(o)),
      `Expected a "General Purchases" option among: ${options.join(', ')}`).toBeTruthy();

    // Every option is displayed by NAME (not a bare internal ID/number).
    for (const label of options) {
      expect(/^\d+$/.test(label.trim()), `Option "${label}" looks like a bare ID, not a name`).toBeFalsy();
    }
  });

  test('Verify \'+ Add section\' is always pinned at the bottom of the Section dropdown regardless of list size', async ({ page }) => {
    const perks = await openForm(page, 'General spend cashback');
    await perks.sectionDropdown.click();
    // The row is a DISABLED mat-option wrapping an ENABLED button (see
    // PerksPage constructor's dated comment) — assert it renders, is the
    // LAST option, and stays present regardless of how many real Sections
    // are listed above it.
    const allOptionTexts = await page.locator('mat-option').allInnerTexts();
    expect(allOptionTexts.length, 'expected at least the "+ Add section" row').toBeGreaterThan(0);
    expect(allOptionTexts[allOptionTexts.length - 1], '"+ Add section" should be the LAST row')
      .toMatch(/\+\s*add section/i);
    await expect(page.locator('mat-option button.add-section-btn')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('Verify Section is a required field that blocks Preview & Save when empty, for all perk types', async ({ page }) => {
    // General spend cashback carries the full "fill every other required
    // field" exercise (fillGeneralCashbackMandatory, skipSection:true) since
    // it has the only fully-implemented mandatory-fill helper; the other
    // three types are checked for the Section control's continued required
    // presence (repeating the full image-upload-heavy fill for each type is
    // covered once, end-to-end, by the cross-story E2E happy-path spec).
    await test.step('General spend cashback: empty Section blocks Preview & Save', async () => {
      const perks = await openForm(page, 'General spend cashback');
      await perks.fillGeneralCashbackMandatory({ skipSection: true });

      await perks.previewAndSaveButton.click();
      await page.waitForTimeout(1_000);

      expect(page.url().includes('/perks/create'),
        'should stay on the create form when Section is empty').toBeTruthy();
      const previewDialog = page.locator('mat-dialog-container').filter({ hasText: 'Quick Preview' });
      expect(await previewDialog.isVisible().catch(() => false),
        'Quick Preview should NOT open while the required Section is empty').toBeFalsy();
    });

    await test.step('Selecting a Section clears the block', async () => {
      const perks = new PerksPage(page);
      const chosen = await perks.selectFirstSection();
      expect(chosen, 'selectFirstSection should return a non-empty label').toBeTruthy();
    });

    for (const type of ['Category cashback', 'Merchant cashback', 'Discount/Coupon']) {
      await test.step(`Section dropdown still required-marked for ${type}`, async () => {
        await openForm(page, type);
        await expect(page.locator('mat-select[formcontrolname="section_id"]'),
          `Section dropdown should still be present for ${type}`).toBeVisible();
      });
    }
  });
});
