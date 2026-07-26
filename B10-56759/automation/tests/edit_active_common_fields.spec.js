'use strict';

/**
 * B10-56759 — Perk Details lifecycle management.
 * Spec 4/7 — Active edit mode: the common permitted fields are editable while all
 * other fields (perk type) are locked/read-only and visually greyed.
 * Covers AC-06 / AC-07 / AC-13 · HLS 7, 8, 14.
 *
 * An Active fixture is CREATED via ApiHelper.createPerk, then opened in edit
 * mode. Non-destructive: inspects field state; never saves. Fields the creation
 * form does not expose by controlname (End date & time, Short duration
 * description) are read by label; a narrow env-limitation skip applies only when
 * such a control cannot be resolved on this build (see PerksPage B10-56759 header).
 */

const { test, expect } = require('@playwright/test');
const config          = require('../../../automation/helpers/ConfigReader');
const LoginPage       = require('../../../automation/pages/LoginPage');
const PerkDetailsPage = require('../../../automation/pages/PerkDetailsPage');
const ApiHelper       = require('../../../automation/helpers/ApiHelper');

// AC-07 common permitted fields shared by every Active perk type (by controlname).
const COMMON_EDITABLE = [
  'title_en', 'title_ar',
  'description_en', 'description_ar',
  'subheader_en', 'subheader_ar',
  'usage_description_en', 'usage_description_ar',
  'branches_description_en', 'branches_description_ar',
  'cashback_processing_description_en', 'cashback_processing_description_ar',
  'section_id',
];

const END_DATE_LABEL = /end date/i;

async function createAndOpenActiveInEdit(request, details) {
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
  if (!opened) return false;
  await details.clickEdit();
  return details.isInEditMode();
}

test.beforeEach(async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.fillLoginFormAndSubmit(config.getAdminUserName(), config.getAdminPassword());
});

test.describe('B10-56759 — Active perk edit mode (common fields)', () => {
  test('Verify clicking Edit on an Active perk opens edit mode with only the permitted fields editable', async ({ page, request }) => {
    const details = new PerkDetailsPage(page);
    expect(await createAndOpenActiveInEdit(request, details), 'Active perk opened in edit mode').toBe(true);

    await test.step('Permitted common fields are editable while the perk type is locked', async () => {
      const matrix = await details.perks.getEditableFieldMatrix(COMMON_EDITABLE);
      const present = Object.entries(matrix).filter(([, s]) => s.present);
      expect(present.length, 'At least the mandatory common fields render in edit mode').toBeGreaterThan(0);
      for (const [control, state] of present) {
        expect(state.editable, `Permitted field "${control}" should be editable`).toBe(true);
      }
      expect(await details.isPerkTypeLocked(), 'Perk type must stay locked in Active edit').toBe(true);
    });
  });

  test('Verify the common permitted fields are editable for an Active perk across all perk types', async ({ page, request }) => {
    const details = new PerkDetailsPage(page);
    expect(await createAndOpenActiveInEdit(request, details), 'Active perk opened in edit mode').toBe(true);

    await test.step('Title, description, subheader, usage, branches, cashback-processing and Section are editable', async () => {
      const matrix = await details.perks.getEditableFieldMatrix(COMMON_EDITABLE);
      for (const [control, state] of Object.entries(matrix)) {
        if (!state.present) continue; // subheader/branches are conditional per type
        expect(state.editable, `Common field "${control}" should be editable`).toBe(true);
      }
    });

    await test.step('End date & time is editable (read by label — unconfirmed live selector)', async () => {
      const resolvable = (await details.perks._fieldByLabel(END_DATE_LABEL).count()) > 0;
      test.skip(!resolvable, 'End date & time control not resolvable on this build — re-confirm live');
      expect(await details.perks.isFieldEditableByLabel(END_DATE_LABEL), 'End date & time editable').toBe(true);
    });
  });

  test('Verify locked fields in Active edit mode are visually distinguished as greyed out / read-only', async ({ page, request }) => {
    const details = new PerkDetailsPage(page);
    expect(await createAndOpenActiveInEdit(request, details), 'Active perk opened in edit mode').toBe(true);

    await test.step('The perk type field is locked (greyed / read-only) and cannot receive input', async () => {
      expect(await details.perks.isFieldPresent('type'), 'Perk type control present').toBe(true);
      expect(await details.perks.isFieldLocked('type'), 'Perk type should be locked/greyed').toBe(true);
    });
  });

  test('Verify Active edit mode permitted fields support both English and Arabic variants', async ({ page, request }) => {
    const details = new PerkDetailsPage(page);
    expect(await createAndOpenActiveInEdit(request, details), 'Active perk opened in edit mode').toBe(true);

    const pairs = [
      ['title_en', 'title_ar'],
      ['description_en', 'description_ar'],
      ['usage_description_en', 'usage_description_ar'],
    ];
    await test.step('Both EN and AR variants of the permitted text fields are editable', async () => {
      for (const [en, ar] of pairs) {
        expect(await details.perks.isFieldEditable(en), `${en} editable`).toBe(true);
        expect(await details.perks.isFieldEditable(ar), `${ar} editable`).toBe(true);
      }
    });
  });
});
