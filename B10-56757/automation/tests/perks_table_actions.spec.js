'use strict';

/**
 * B10-56757 — Perks table management.
 * Spec 4/7 — Actions column: View + Delete, status-gated delete, confirmation
 * (AC-06 / AC-07 / AC-08).
 *
 * Mirrors BrowserStack cases (verbatim titles):
 *   - Verify Actions column is the last column with View and Delete actions per row
 *   - Verify View action navigates to the perk detail page
 *   - Verify Delete action is enabled for planned perks
 *   - Verify Delete action is dimmed/disabled for Active perks
 *   - Verify Delete action is dimmed/disabled for Expired perks
 *   - Verify Delete on an eligible perk triggers a confirmation prompt
 *   - Verify confirming the delete prompt removes the planned perk
 *   - Verify cancelling the delete prompt aborts the deletion
 *
 * The actual deletion (confirm) is DESTRUCTIVE — gated behind RUN_PERK_DELETE=1.
 * Selector provenance + live-DOM (env 502) blocker: PerksPage "B10-56757" block.
 */

const { test, expect } = require('@playwright/test');
const config    = require('../../../automation/helpers/ConfigReader');
const LoginPage = require('../../../automation/pages/LoginPage');
const PerksPage = require('../../../automation/pages/PerksPage');

const EXPECTED_ACTIONS       = ['View', 'Delete'];
const EXPECTED_DELETE_PROMPT = 'Are you sure you want to delete this perk?';

/** Index of the first row whose Status column matches `status` (−1 if none). */
async function rowIndexByStatus(perks, status) {
  const statuses = await perks.getColumnValues('Status');
  return statuses.findIndex((s) => new RegExp(status, 'i').test(s));
}

test.beforeEach(async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.fillLoginFormAndSubmit(config.getAdminUserName(), config.getAdminPassword());
});

test.describe('B10-56757 — Perks table actions', () => {
  test('Verify Actions column is the last column with View and Delete actions per row', async ({ page }) => {
    const perks = new PerksPage(page);
    await perks.goToPerksTable();

    await test.step('An Actions column is the last (rightmost) column', async () => {
      const headers = await perks.getTableColumnHeaders();
      expect(headers.length).toBeGreaterThan(0);
      expect(headers[headers.length - 1].toLowerCase()).toContain('action');
    });

    await test.step('Each row exposes View and Delete actions', async () => {
      const count = await perks.getRowCount();
      test.skip(count === 0, 'No perk rows in env to inspect row actions');
      const labels = (await perks.getRowActionLabels(0)).join(' | ').toLowerCase();
      for (const a of EXPECTED_ACTIONS) expect(labels).toContain(a.toLowerCase());
    });
  });

  test('Verify View action navigates to the perk detail page', async ({ page }) => {
    const perks = new PerksPage(page);
    await perks.goToPerksTable();

    await test.step('Click View on the first perk row', async () => {
      const count = await perks.getRowCount();
      test.skip(count === 0, 'No perk rows in env to open detail');
      await perks.clickViewAction(0);
    });

    await test.step('The admin is navigated to a perk detail page', async () => {
      // Detail routes off the list (#/perks) to a per-perk URL (#/perks/<id>/…).
      await expect(page).toHaveURL(/#\/perks\/.+/, { timeout: 15_000 });
    });
  });

  test('Verify Delete action is enabled for planned perks', async ({ page }) => {
    const perks = new PerksPage(page);
    await perks.goToPerksTable();

    const idx = await rowIndexByStatus(perks, 'planned');
    test.skip(idx < 0, 'No planned perk in env');
    await test.step('Delete is enabled (not dimmed) for the planned perk', async () => {
      expect(await perks.isDeleteEnabled(idx)).toBe(true);
    });
  });

  test('Verify Delete action is dimmed/disabled for Active perks', async ({ page }) => {
    const perks = new PerksPage(page);
    await perks.goToPerksTable();

    const idx = await rowIndexByStatus(perks, 'active');
    test.skip(idx < 0, 'No Active perk in env');
    await test.step('Delete is dimmed/disabled for the Active perk', async () => {
      expect(await perks.isDeleteEnabled(idx)).toBe(false);
    });
  });

  test('Verify Delete action is dimmed/disabled for Expired perks', async ({ page }) => {
    const perks = new PerksPage(page);
    await perks.goToPerksTable();

    const idx = await rowIndexByStatus(perks, 'expired');
    test.skip(idx < 0, 'No Expired perk in env');
    await test.step('Delete is dimmed/disabled for the Expired perk', async () => {
      expect(await perks.isDeleteEnabled(idx)).toBe(false);
    });
  });

  test('Verify Delete on an eligible perk triggers a confirmation prompt', async ({ page }) => {
    const perks = new PerksPage(page);
    await perks.goToPerksTable();

    const idx = await rowIndexByStatus(perks, 'planned');
    test.skip(idx < 0, 'No planned perk in env');

    await test.step('Click Delete on the planned perk → confirmation prompt appears', async () => {
      await perks.clickDeleteAction(idx);
      expect(await perks.isDeleteDialogVisible()).toBe(true);
      expect(await perks.getDeleteDialogText()).toContain(EXPECTED_DELETE_PROMPT);
    });

    // Leave the perk intact — dismiss the prompt (this case only verifies the prompt).
    await perks.cancelDeleteDialog();
  });

  test('Verify cancelling the delete prompt aborts the deletion', async ({ page }) => {
    const perks = new PerksPage(page);
    await perks.goToPerksTable();

    const idx = await rowIndexByStatus(perks, 'planned');
    test.skip(idx < 0, 'No planned perk in env');

    const before = await perks.getRowCount();
    await test.step('Open then cancel the delete prompt', async () => {
      await perks.clickDeleteAction(idx);
      expect(await perks.isDeleteDialogVisible()).toBe(true);
      await perks.cancelDeleteDialog();
    });

    await test.step('The perk still appears — no deletion occurred', async () => {
      expect(await perks.getRowCount()).toBe(before);
    });
  });

  test('Verify confirming the delete prompt removes the planned perk', async ({ page }) => {
    test.skip(process.env.RUN_PERK_DELETE !== '1', 'Destructive — set RUN_PERK_DELETE=1 to run');
    const perks = new PerksPage(page);
    await perks.goToPerksTable();

    const idx = await rowIndexByStatus(perks, 'planned');
    test.skip(idx < 0, 'No planned perk in env');

    const before = await perks.getRowCount();
    let result;
    await test.step('Confirm the deletion and capture the delete API response', async () => {
      await perks.clickDeleteAction(idx);
      expect(await perks.isDeleteDialogVisible()).toBe(true);
      result = await perks.confirmDeleteAndCapture();
    });

    await test.step('The delete call succeeded and the row was removed', async () => {
      if (result.status !== null) {
        expect(result.status, `delete body: ${result.body.slice(0, 200)}`).toBeLessThan(400);
      }
      await perks.waitForTableSettled();
      expect(await perks.getRowCount()).toBe(before - 1);
    });
  });
});
