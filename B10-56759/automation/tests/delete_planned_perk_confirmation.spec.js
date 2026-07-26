'use strict';

/**
 * B10-56759 — Perk Details lifecycle management.
 * Spec 2/7 — Planned delete confirmation: confirm permanently deletes, cancel
 * leaves the perk intact. Covers AC-02 · HLS 3.
 *
 * A Planned fixture is CREATED per test via ApiHelper.createPerk, so the
 * destructive confirm path acts on a throwaway perk (never a pre-existing one).
 * The actual confirm (permanent delete) is gated behind RUN_PERK_DELETE=1; the
 * cancel path and prompt-copy checks are non-destructive and always run.
 *
 * The delete-confirmation modal is reused from PerksPage (isDeleteDialogVisible /
 * getDeleteDialogText / confirmDeleteAndCapture / cancelDeleteDialog).
 */

const { test, expect } = require('@playwright/test');
const config          = require('../../../automation/helpers/ConfigReader');
const LoginPage       = require('../../../automation/pages/LoginPage');
const PerkDetailsPage = require('../../../automation/pages/PerkDetailsPage');
const ApiHelper       = require('../../../automation/helpers/ApiHelper');

// The exact prompt copy is unspecified in the story (see requirements-analysis
// "Missing Requirements"); assert the modal is a delete confirmation by keyword.
const EXPECTED_DELETE_KEYWORD = /delete/i;

/** Create a Planned fixture and open its detail page; returns { opened, title }. */
async function createAndOpenPlanned(request, details) {
  const token = await ApiHelper.loginAndGetToken(request);
  const { title } = await ApiHelper.createPerk(request, token, { type: 'general-cashback', status: 'planned' });
  const { opened } = await details.openPerkByTitle(title);
  return { opened, title };
}

test.beforeEach(async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.fillLoginFormAndSubmit(config.getAdminUserName(), config.getAdminPassword());
});

test.describe('B10-56759 — Planned perk delete confirmation', () => {
  test('Verify clicking Delete on a Planned perk triggers a confirmation prompt before deletion', async ({ page, request }) => {
    const details = new PerkDetailsPage(page);
    const { opened } = await createAndOpenPlanned(request, details);
    expect(opened, 'Planned fixture opened').toBe(true);

    await test.step('Clicking Delete shows a confirmation prompt (perk not yet deleted)', async () => {
      await details.clickDelete();
      expect(await details.perks.isDeleteDialogVisible(), 'Confirmation prompt shown').toBe(true);
      expect(await details.perks.getDeleteDialogText()).toMatch(EXPECTED_DELETE_KEYWORD);
      await details.perks.cancelDeleteDialog();
    });
  });

  test('Verify cancelling the deletion confirmation keeps the Planned perk intact', async ({ page, request }) => {
    const details = new PerkDetailsPage(page);
    const { opened, title } = await createAndOpenPlanned(request, details);
    expect(opened).toBe(true);

    await test.step('Open then cancel the confirmation prompt — no deletion occurs', async () => {
      await details.clickDelete();
      expect(await details.perks.isDeleteDialogVisible()).toBe(true);
      await details.perks.cancelDeleteDialog();
      expect(await details.perks.isDeleteDialogVisible(), 'Prompt closed after cancel').toBe(false);
    });

    await test.step('The perk still exists in the Perks list', async () => {
      const { opened: stillThere } = await details.openPerkByTitle(title);
      expect(stillThere, `Cancelled perk "${title}" still appears in the list`).toBe(true);
    });
  });

  test('Verify confirming the deletion permanently deletes a Planned perk', async ({ page, request }) => {
    test.skip(process.env.RUN_PERK_DELETE !== '1', 'Destructive — set RUN_PERK_DELETE=1 to run');
    const details = new PerkDetailsPage(page);
    const { opened, title } = await createAndOpenPlanned(request, details);
    expect(opened).toBe(true);

    let result;
    await test.step('Confirm the deletion and capture the delete API response', async () => {
      await details.clickDelete();
      expect(await details.perks.isDeleteDialogVisible()).toBe(true);
      result = await details.perks.confirmDeleteAndCapture();
    });

    await test.step('The delete call succeeded and the perk is gone from the list', async () => {
      if (result.status !== null) {
        expect(result.status, `delete body: ${result.body.slice(0, 200)}`).toBeLessThan(400);
      }
      const { opened: stillThere } = await details.openPerkByTitle(title);
      expect(stillThere, `Deleted perk "${title}" must no longer appear`).toBe(false);
    });
  });
});
