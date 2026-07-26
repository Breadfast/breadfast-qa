'use strict';

/**
 * B10-56759 — Perk Details lifecycle management.
 * Spec 3/7 — Planned full edit mode: all fields editable EXCEPT perk type,
 * matching the creation form, and the same field validations apply.
 * Covers AC-05 / AC-17 · HLS 6, 17.
 *
 * A Planned fixture is CREATED via ApiHelper.createPerk, then opened and put in
 * edit mode. Non-destructive: inspects field state + validation errors; never
 * saves. Field state is read via PerksPage's edit-mode readers (reusing the
 * creation-form controlname selectors) and its create-form validation checker.
 */

const { test, expect } = require('@playwright/test');
const config          = require('../../../automation/helpers/ConfigReader');
const LoginPage       = require('../../../automation/pages/LoginPage');
const PerkDetailsPage = require('../../../automation/pages/PerkDetailsPage');
const ApiHelper       = require('../../../automation/helpers/ApiHelper');

// Common content fields present on every perk type — all editable in Planned
// full-edit mode (same as creation). Type-specific fields are covered per-type
// in edit_active_type_specific_fields.spec.js.
const EDITABLE_IN_PLANNED = [
  'title_en', 'title_ar',
  'description_en', 'description_ar',
  'usage_description_en', 'usage_description_ar',
  'section_id',
];

const TITLE_MAX = 20; // creation-parity title cap (B10-56729 AC3)

async function createAndOpenPlanned(request, details) {
  const token = await ApiHelper.loginAndGetToken(request);
  let title = null;
  try {
    ({ title } = await ApiHelper.createPerk(request, token, { type: 'general-cashback', status: 'planned' }));
  } catch (e) {
    console.warn(`[fixture] createPerk(general-cashback/planned) failed, using existing: ${e.message}`);
  }
  if (title) {
    const byTitle = await details.openPerkByTitle(title);
    if (byTitle.opened) return byTitle.opened;
  }
  return (await details.openPerkByStatus('planned')).opened;
}

test.beforeEach(async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.fillLoginFormAndSubmit(config.getAdminUserName(), config.getAdminPassword());
});

test.describe('B10-56759 — Planned perk full edit mode', () => {
  test('Verify clicking Edit on a Planned perk opens full edit mode with all fields editable except type', async ({ page, request }) => {
    const details = new PerkDetailsPage(page);
    expect(await createAndOpenPlanned(request, details), 'Planned perk opened').toBe(true);

    await test.step('Clicking Edit opens full edit mode (creation-form layout)', async () => {
      expect(await details.isEditButtonEnabled(), 'Edit should be active for Planned').toBe(true);
      await details.clickEdit();
      expect(await details.isInEditMode(), 'Perk opened in edit mode').toBe(true);
    });

    await test.step('Every common content field is editable', async () => {
      const matrix = await details.perks.getEditableFieldMatrix(EDITABLE_IN_PLANNED);
      for (const [control, state] of Object.entries(matrix)) {
        if (!state.present) continue; // subheader etc. are conditional per type
        expect(state.editable, `Field "${control}" should be editable in Planned edit mode`).toBe(true);
      }
    });

    await test.step('The perk type field is locked/read-only', async () => {
      expect(await details.perks.isFieldPresent('type'), 'Perk type control present').toBe(true);
      expect(await details.isPerkTypeLocked(), 'Perk type should be locked in edit mode').toBe(true);
    });
  });

  test('Verify Planned edit mode enforces the same field validations as the creation flow', async ({ page, request }) => {
    const details = new PerkDetailsPage(page);
    expect(await createAndOpenPlanned(request, details), 'Planned perk opened').toBe(true);
    await details.clickEdit();
    expect(await details.isInEditMode(), 'Perk opened in edit mode').toBe(true);

    await test.step(`The perk title EN field enforces the ${TITLE_MAX}-character limit`, async () => {
      const r = await details.perks.checkMaxLengthValidation('input', 'title_en', TITLE_MAX);
      expect(r.errorShown, `expected a "Maximum length should be ${TITLE_MAX} characters." error on title_en`).toBeTruthy();
      expect(r.errorText).toMatch(new RegExp(`maximum length should be\\s*${TITLE_MAX}\\s*characters`, 'i'));
    });

    await test.step(`The perk title AR field enforces the ${TITLE_MAX}-character limit`, async () => {
      const r = await details.perks.checkMaxLengthValidation('input', 'title_ar', TITLE_MAX);
      expect(r.errorShown, `expected a "Maximum length should be ${TITLE_MAX} characters." error on title_ar`).toBeTruthy();
    });
  });
});
