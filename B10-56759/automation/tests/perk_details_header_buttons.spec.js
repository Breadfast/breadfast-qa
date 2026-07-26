'use strict';

/**
 * B10-56759 — Perk Details lifecycle management.
 * Spec 1/7 — Header Delete + Edit buttons & their per-status state.
 * Covers AC-01 / AC-02 / AC-03 / AC-04 · HLS 1, 2, 4, 5.
 *
 * Fixtures are CREATED per status via ApiHelper.createPerk (tester feedback:
 * create the required perk instead of skipping when the env lacks one). If the
 * create API rejects a payload, the spec falls back to an existing perk of that
 * status; it never silently skips on fixture absence.
 *
 * Selector provenance + live-DOM (env 502) blocker: PerkDetailsPage header block.
 */

const { test, expect } = require('@playwright/test');
const config          = require('../../../automation/helpers/ConfigReader');
const LoginPage       = require('../../../automation/pages/LoginPage');
const PerkDetailsPage = require('../../../automation/pages/PerkDetailsPage');
const ApiHelper       = require('../../../automation/helpers/ApiHelper');

/** Create a fixture of the given status/type and open it; fall back to an
 *  existing perk of that status when the create API rejects the payload. */
async function ensurePerk(request, details, { type = 'general-cashback', status }) {
  const token = await ApiHelper.loginAndGetToken(request);
  let title = null;
  try {
    ({ title } = await ApiHelper.createPerk(request, token, { type, status }));
  } catch (e) {
    console.warn(`[fixture] createPerk(${type}/${status}) failed, using existing: ${e.message}`);
  }
  if (title) {
    const byTitle = await details.openPerkByTitle(title);
    if (byTitle.opened) return { ...byTitle, title };
  }
  return { ...(await details.openPerkByStatus(status)), title };
}

test.beforeEach(async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.fillLoginFormAndSubmit(config.getAdminUserName(), config.getAdminPassword());
});

test.describe('B10-56759 — Perk Details header buttons', () => {
  test('Verify the Perk Details page header displays both a "Delete" button and an "Edit" button for a Planned perk', async ({ page, request }) => {
    const details = new PerkDetailsPage(page);
    const { opened } = await ensurePerk(request, details, { status: 'planned' });
    expect(opened, 'A Planned perk detail page could be opened').toBe(true);

    await test.step('The header displays both a Delete and an Edit button', async () => {
      await details.expectBothHeaderButtons();
    });
  });

  test('Verify the Perk Details page header displays both a "Delete" button and an "Edit" button for an Active perk', async ({ page, request }) => {
    const details = new PerkDetailsPage(page);
    const { opened } = await ensurePerk(request, details, { status: 'active' });
    expect(opened, 'An Active perk detail page could be opened').toBe(true);

    await test.step('The header displays both a Delete and an Edit button', async () => {
      await details.expectBothHeaderButtons();
    });
  });

  test('Verify the Perk Details page header displays both a "Delete" button and an "Edit" button for an Expired perk', async ({ page, request }) => {
    const details = new PerkDetailsPage(page);
    const { opened } = await ensurePerk(request, details, { status: 'expired' });
    expect(opened, 'An Expired perk detail page could be opened').toBe(true);

    await test.step('The header displays both a Delete and an Edit button (regardless of dimmed state)', async () => {
      await details.expectBothHeaderButtons();
    });
  });

  test('Verify the Delete button is active and styled in magenta for a Planned perk and opens a confirmation prompt', async ({ page, request }) => {
    const details = new PerkDetailsPage(page);
    const { opened } = await ensurePerk(request, details, { status: 'planned' });
    expect(opened).toBe(true);

    await test.step('Delete is active and rendered in magenta', async () => {
      expect(await details.isDeleteButtonEnabled(), 'Delete active for Planned').toBe(true);
      const style = await details.getDeleteButtonStyle();
      expect(style.isMagenta, `Delete not magenta (bg=${style.background} fg=${style.color})`).toBe(true);
    });

    await test.step('Clicking Delete opens a confirmation prompt (perk not yet deleted)', async () => {
      await details.clickDelete();
      expect(await details.perks.isDeleteDialogVisible(), 'Confirmation prompt shown').toBe(true);
      await details.perks.cancelDeleteDialog();
    });
  });

  test('Verify the Delete button is dimmed and non-interactive for an Active perk', async ({ page, request }) => {
    const details = new PerkDetailsPage(page);
    const { opened } = await ensurePerk(request, details, { status: 'active' });
    expect(opened).toBe(true);

    await test.step('Delete is present but dimmed/disabled', async () => {
      expect(await details.isDeleteButtonPresent()).toBe(true);
      expect(await details.isDeleteButtonEnabled(), 'Delete should be dimmed for Active').toBe(false);
    });

    await test.step('Clicking the dimmed Delete triggers no confirmation prompt', async () => {
      const { promptShown } = await details.attemptDeleteExpectNoPrompt();
      expect(promptShown, 'No delete confirmation should appear for Active').toBe(false);
    });
  });

  test('Verify the Delete button is dimmed and non-interactive for an Expired perk', async ({ page, request }) => {
    const details = new PerkDetailsPage(page);
    const { opened } = await ensurePerk(request, details, { status: 'expired' });
    expect(opened).toBe(true);

    await test.step('Delete is present but dimmed/disabled', async () => {
      expect(await details.isDeleteButtonPresent()).toBe(true);
      expect(await details.isDeleteButtonEnabled(), 'Delete should be dimmed for Expired').toBe(false);
    });

    await test.step('Clicking the dimmed Delete triggers no confirmation prompt', async () => {
      const { promptShown } = await details.attemptDeleteExpectNoPrompt();
      expect(promptShown, 'No delete confirmation should appear for Expired').toBe(false);
    });
  });

  test('Verify the Edit button is dimmed and non-interactive for an Expired perk', async ({ page, request }) => {
    const details = new PerkDetailsPage(page);
    const { opened } = await ensurePerk(request, details, { status: 'expired' });
    expect(opened).toBe(true);

    await test.step('The Edit button is present but dimmed/disabled', async () => {
      expect(await details.isEditButtonPresent(), 'Edit button present').toBe(true);
      expect(await details.isEditButtonEnabled(), 'Edit should be dimmed for Expired').toBe(false);
    });

    await test.step('Attempting to click Edit does not open edit mode', async () => {
      const { enteredEditMode } = await details.attemptEditExpectNoEditMode();
      expect(enteredEditMode, 'Expired perk must not open in edit mode').toBe(false);
    });
  });
});
