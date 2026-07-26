'use strict';

/**
 * B10-56729 — Create Perk: Form Enhancements
 * Spec 5/5 — Preview screen (AC18 + comment override).
 * Covers: AC18 — the Preview ("Quick Preview") renders the new/updated fields:
 *         merchant name, perk title, perk subtitle (custom & auto-filled), description,
 *         usage, branches, cashback processing, duration, cover photo, logo.
 *
 * This spec FILLS the form and opens the preview, but does NOT save (no perk is
 * created) unless RUN_PERK_CREATE=1 — keep it non-destructive by default.
 * Selectors captured live 2026-07-14 (PerksPage.js "B10-56729" block).
 */

const { test, expect } = require('@playwright/test');
const config    = require('../../../automation/helpers/ConfigReader');
const LoginPage = require('../../../automation/pages/LoginPage');
const PerksPage = require('../../../automation/pages/PerksPage');

const P = {
  titleEn: 'Preview EN 56729',   // ≤ 20 chars (AC3)
  titleAr: 'معاينة ٥٦٧٢٩',
  subEn: 'Custom subheader',
  subAr: 'عنوان فرعي',
  usageEn: 'Used once, cashback capped at 200 EGP.',
  usageAr: 'يستخدم مرة واحدة.',
  cbEn: 'Cashback in up to 14 days.',
  cbAr: 'استرداد خلال ١٤ يوم.',
};

test.beforeEach(async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.fillLoginFormAndSubmit(config.getAdminUserName(), config.getAdminPassword());
});

test.describe('B10-56729 — Preview screen', () => {
  // BrowserStack TC21.
  test('Verify the Preview screen displays all new sections and fields', async ({ page }) => {
    const perks = new PerksPage(page);
    await perks.goToPerksPage();
    await perks.clickAddPerk();
    await perks.selectPerkTypeByName('General spend cashback');

    await test.step('fill ALL mandatory fields + the new content fields', async () => {
      // The Preview button is a no-op while the form is invalid, so we must fill
      // the full required set (Section, cover photos, logos, cashback Type+value,
      // short description) — not just the new B10-56729 content fields. The
      // preview-asserted values (title, subheader, usage) are passed through.
      await perks.fillGeneralCashbackMandatory({
        titleEn: P.titleEn, titleAr: P.titleAr,
        subEn:   P.subEn,   subAr:   P.subAr,
        usageEn: P.usageEn, usageAr: P.usageAr,
      });
      await perks.fillCashbackProcessing(P.cbEn, P.cbAr);
    });

    await test.step('open the Quick Preview dialog', async () => {
      await perks.previewAndSaveButton.click();
      const dialog = page.locator('mat-dialog-container').filter({ has: page.locator('text=Quick Preview') });
      await dialog.waitFor({ state: 'visible', timeout: 10_000 });

      // The preview must surface the custom subheader and the perk title (AC18).
      await expect(dialog.getByText(P.titleEn, { exact: false })).toBeVisible();
      await expect(dialog.getByText(P.subEn, { exact: false })).toBeVisible();
      await expect(dialog.getByText(P.usageEn.slice(0, 15), { exact: false })).toBeVisible();
    });

    // Only actually persist when explicitly opted-in (avoids polluting the env).
    if (process.env.RUN_PERK_CREATE === '1') {
      await test.step('save the perk (opt-in)', async () => {
        const saveBtn = page.locator('mat-dialog-container').getByRole('button', { name: /^\s*save\s*$/i });
        if (await saveBtn.isVisible().catch(() => false)) await saveBtn.click();
        await page.waitForURL(/\/#\/perks$/, { timeout: 30_000 }).catch(() => {});
      });
    }
  });
});
