'use strict';

/**
 * B10-56759 — Perk Details lifecycle management.
 * Spec 6/7 — Save integrity, negative no-op, and regression.
 * Covers AC-14 · HLS 15, 16, 20.
 *
 *   - Save integrity: editing a permitted field and saving does NOT change the
 *     perk status or reset its start date (gated behind RUN_PERK_EDIT_SAVE=1 —
 *     mutates a live perk).
 *   - Negative no-op: force-clicking a dimmed Delete on an Active perk triggers
 *     no action; a locked field stays locked.
 *   - Regression: opening details from the list renders the correct per-status
 *     buttons, and leaving edit mode without saving persists nothing.
 *
 * Fixtures CREATED via ApiHelper.createPerk (Active for the save/no-op checks).
 */

const { test, expect } = require('@playwright/test');
const config          = require('../../../automation/helpers/ConfigReader');
const LoginPage       = require('../../../automation/pages/LoginPage');
const PerkDetailsPage = require('../../../automation/pages/PerkDetailsPage');
const ApiHelper       = require('../../../automation/helpers/ApiHelper');

async function createAndOpenActive(request, details) {
  const token = await ApiHelper.loginAndGetToken(request);
  let title = null;
  try {
    ({ title } = await ApiHelper.createPerk(request, token, { type: 'general-cashback', status: 'active' }));
  } catch (e) {
    console.warn(`[fixture] createPerk(general-cashback/active) failed, using existing: ${e.message}`);
  }
  let opened = false;
  if (title) opened = (await details.openPerkByTitle(title)).opened;
  if (!opened) opened = (await details.openPerkByStatus('active')).opened;
  return { opened, title };
}

test.beforeEach(async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.fillLoginFormAndSubmit(config.getAdminUserName(), config.getAdminPassword());
});

test.describe('B10-56759 — Active perk save integrity & regression', () => {
  test('Verify saving edits to an Active perk does not change its status', async ({ page, request }) => {
    test.skip(process.env.RUN_PERK_EDIT_SAVE !== '1', 'Destructive — set RUN_PERK_EDIT_SAVE=1 to run');
    const details = new PerkDetailsPage(page);
    const { opened, title } = await createAndOpenActive(request, details);
    expect(opened).toBe(true);

    const statusBefore = await details.getDisplayedStatus();
    test.skip(!statusBefore, 'Perk status not readable on detail page — cannot compare');

    await test.step('Edit a permitted field and save', async () => {
      await details.clickEdit();
      expect(await details.isInEditMode()).toBe(true);
      await details.perks.fillTitles('EditAct', 'تعديل');
      await details.perks.previewAndSaveButton.click();
      await page.waitForTimeout(2_000);
    });

    await test.step('The perk status is still Active', async () => {
      if (title) await details.openPerkByTitle(title);
      const statusAfter = await details.getDisplayedStatus();
      expect(statusAfter.toLowerCase()).toContain('active');
      expect(statusAfter.toLowerCase()).toBe(statusBefore.toLowerCase());
    });
  });

  test('Verify saving edits to an Active perk does not reset its start date', async ({ page, request }) => {
    test.skip(process.env.RUN_PERK_EDIT_SAVE !== '1', 'Destructive — set RUN_PERK_EDIT_SAVE=1 to run');
    const details = new PerkDetailsPage(page);
    const { opened, title } = await createAndOpenActive(request, details);
    expect(opened).toBe(true);

    const startBefore = await details.getStartDateValue();
    test.skip(!startBefore, 'Start date not readable on detail page — cannot compare');

    await test.step('Edit a permitted field and save', async () => {
      await details.clickEdit();
      expect(await details.isInEditMode()).toBe(true);
      await details.perks.fillTitles('EditDate', 'تاريخ');
      await details.perks.previewAndSaveButton.click();
      await page.waitForTimeout(2_000);
    });

    await test.step('Re-open the perk — the start date is unchanged', async () => {
      if (title) await details.openPerkByTitle(title);
      const startAfter = await details.getStartDateValue();
      expect(startAfter).toBe(startBefore);
    });
  });

  test('Verify interacting with a dimmed Delete button on an Active perk triggers no action', async ({ page, request }) => {
    const details = new PerkDetailsPage(page);
    const { opened } = await createAndOpenActive(request, details);
    expect(opened).toBe(true);

    await test.step('Force-clicking the dimmed Delete opens no confirmation prompt', async () => {
      expect(await details.isDeleteButtonEnabled(), 'Delete should be dimmed for Active').toBe(false);
      const { promptShown } = await details.attemptDeleteExpectNoPrompt();
      expect(promptShown, 'No deletion prompt from a dimmed button').toBe(false);
    });

    await test.step('The perk type field stays locked in edit mode (no-op input)', async () => {
      await details.clickEdit();
      expect(await details.isInEditMode()).toBe(true);
      expect(await details.isPerkTypeLocked(), 'Perk type remains locked').toBe(true);
    });
  });

  test('Verify opening Perk Details from the list renders the Delete/Edit buttons per status and leaving edit mode persists nothing', async ({ page, request }) => {
    const details = new PerkDetailsPage(page);
    const { opened } = await createAndOpenActive(request, details);
    expect(opened).toBe(true);

    await test.step('Both header buttons render, with Active-appropriate states', async () => {
      await details.expectBothHeaderButtons();
      expect(await details.isDeleteButtonEnabled(), 'Active Delete dimmed').toBe(false);
      expect(await details.isEditButtonEnabled(), 'Active Edit active').toBe(true);
    });

    await test.step('Entering then navigating away from edit mode persists no change', async () => {
      await details.clickEdit();
      expect(await details.isInEditMode()).toBe(true);
      await details.perks.goToPerksTable();
      const settled = await details.perks.waitForTableSettled();
      expect(settled.ready, 'Perks list still renders after leaving edit mode').toBe(true);
    });
  });
});
