'use strict';

/**
 * B10-57393 — App preview modal, save-failure path (BrowserStack TC-53972).
 *
 * This case is in its OWN spec because it is the one case the Java/Selenium suite cannot automate:
 * it needs the perk-creation request forced to fail, and Selenium has no request-interception hook.
 * Playwright's `page.route` provides exactly that, so the case is automatable here — which is the
 * clearest capability difference between the two stacks on this story.
 *
 * TEST NAME IS THE BROWSERSTACK CASE NAME, verbatim.
 *
 * Assertions target the SPEC, so this fails until B10-58253 is fixed. The failure is deliberately
 * observed by POLLING rather than by a single sample: an auto-dismissing toast would be missed by a
 * one-shot read, which is exactly the false-negative the bug-reporting gate warns about
 * (docs/ai/bug-reporting.md §1.1 check 8).
 */

const { test, expect } = require('@playwright/test');
const LoginPage = require('../../../automation/pages/LoginPage');
const PerksPage = require('../../../automation/pages/PerksPage');
const AppPreviewModal = require('../../../automation/pages/AppPreviewModal');
const config = require('../../../automation/helpers/ConfigReader');

test.describe('B10-57393 — App preview save failure', () => {

  test('Verify a failed save keeps the "App preview" modal open, preserves the data and surfaces an error message', async ({ page }) => {
    const login = new LoginPage(page);
    await login.fillLoginFormAndSubmit(config.getAdminUserName(), config.getAdminPassword());

    const perks = new PerksPage(page);
    await perks.goToPerksPage();
    await perks.clickAddPerk();
    const unique = `15% CB ${String(Date.now()).slice(-5)}`;
    const data = await perks.fillCompleteMerchantCashbackPerk({ titleEn: unique });

    // Force the perk-creation request to fail. Reads (GET) still pass through, so only the save breaks.
    await page.route('**/api/v1/web/card/perks**', async (route) => {
      if (['POST', 'PUT'].includes(route.request().method())) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Injected failure for the save-failure negative test' }),
        });
      } else {
        await route.continue();
      }
    });

    await perks.clickPreviewAndSave();
    const modal = new AppPreviewModal(page);
    await modal.waitUntilVisible();

    await modal.saveButton.click();
    const outcome = await modal.watchSaveOutcome({ totalMs: 12_000, stepMs: 500 });

    // What already behaves correctly.
    expect(outcome.modalOpenAtEnd, 'the modal should stay open on a failed save').toBe(true);
    expect(await modal.countDeviceFrames(), 'both preview frames should still render').toBe(2);
    expect(await page.locator('app-bf-input[controlname="title_en"] input').inputValue(),
      'the entered data must be preserved so the admin can retry').toBe(data.titleEn);

    // [DEFECT-EXPECTED B10-58253] no error is surfaced and the Save button spins forever.
    expect(outcome.firstError,
      `an error message should be shown on a failed save, but none appeared in `
      + `${outcome.samples} samples over 12s`).not.toBeNull();
    expect(outcome.spinnerAtEnd,
      `the Save button should leave its loading state so the save can be retried, but the spinner was `
      + `still showing after 12s (present in ${outcome.spinnerSamples}/${outcome.samples} samples)`).toBe(false);

    // Nothing may have been created despite the failure.
    await page.unroute('**/api/v1/web/card/perks**');
    await perks.goToPerksPage();
    await perks.waitForTableSettled().catch(() => {});
    expect(await perks.getColumnValues('Title'),
      'a failed save must leave no partial record').not.toContain(data.titleEn);
  });
});
