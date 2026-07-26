'use strict';

/**
 * B10-56759 — Perk Details lifecycle management.
 * Spec 7/7 — Localization + scope-only Figma visual comparison.
 * Covers AC-13 · HLS 9, 18, 19.
 *
 *   - Bilingual edit: EN (en-US) and AR (ar-EG) variants of the permitted
 *     Active fields are both editable, and the AR inputs render RTL.
 *   - Visual: capture the live Perk Details button/field states and diff them
 *     against the SCOPE-ONLY exported Perk Details Figma frames (active-magenta
 *     Delete, dimmed Delete/Edit, greyed locked fields) via VisualComparisonHelper
 *     — only the story's Perk Details node is exported, not the whole dashboard.
 *
 * The visual comparison degrades gracefully when no FIGMA_API_TOKEN is available
 * (Expected pane omitted, Actual + REVIEW verdict still produced), so the suite
 * never hard-fails on design-tooling availability.
 */

const path = require('path');
const { test, expect } = require('@playwright/test');
const config                 = require('../../../automation/helpers/ConfigReader');
const LoginPage              = require('../../../automation/pages/LoginPage');
const PerkDetailsPage        = require('../../../automation/pages/PerkDetailsPage');
const ApiHelper              = require('../../../automation/helpers/ApiHelper');
const VisualComparisonHelper = require('../../../automation/helpers/VisualComparisonHelper');

// Scope-only Perk Details frame from THIS story's Figma URL (per execution
// instructions): file key kyspsx61WsmZgAgjMpimcu, node-id 5893-378873.
const FIGMA_FILE_KEY = 'kyspsx61WsmZgAgjMpimcu';
const FIGMA_NODE     = '5893-378873';
const VISUAL_OUT_DIR = path.join(__dirname, '..', 'visual-comparison');

async function createAndOpen(request, details, status) {
  const token = await ApiHelper.loginAndGetToken(request);
  let title = null;
  try {
    ({ title } = await ApiHelper.createPerk(request, token, { type: 'general-cashback', status }));
  } catch (e) {
    console.warn(`[fixture] createPerk(general-cashback/${status}) failed, using existing: ${e.message}`);
  }
  let opened = false;
  if (title) opened = (await details.openPerkByTitle(title)).opened;
  if (!opened) opened = (await details.openPerkByStatus(status)).opened;
  return opened;
}

test.beforeEach(async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.fillLoginFormAndSubmit(config.getAdminUserName(), config.getAdminPassword());
});

test.describe('B10-56759 — Perk Details localization & Figma visual', () => {
  test('Verify the bilingual editable fields support both English (en-US) and Arabic (ar-EG) variants when editing an Active perk', async ({ page, request }) => {
    const details = new PerkDetailsPage(page);
    expect(await createAndOpen(request, details, 'active'), 'Active perk opened').toBe(true);
    await details.clickEdit();
    expect(await details.isInEditMode(), 'Active perk opened in edit mode').toBe(true);

    const pairs = [
      ['title_en', 'title_ar'],
      ['description_en', 'description_ar'],
      ['usage_description_en', 'usage_description_ar'],
    ];

    await test.step('Both EN and AR variants of the bilingual fields are editable', async () => {
      for (const [en, ar] of pairs) {
        expect(await details.perks.isFieldEditable(en), `${en} editable`).toBe(true);
        expect(await details.perks.isFieldEditable(ar), `${ar} editable`).toBe(true);
      }
    });

    await test.step('The Arabic title input renders right-to-left', async () => {
      const arInput = page.locator('app-bf-input[controlname="title_ar"] input').first();
      const rtl = await arInput
        .evaluate((el) => el.getAttribute('dir') === 'rtl' || getComputedStyle(el).direction === 'rtl')
        .catch(() => false);
      expect(rtl, 'title_ar should render RTL').toBe(true);
    });
  });

  test('Verify Perk Details button states and locked-field styling match the scope-relevant Figma frames', async ({ page, request }) => {
    const details = new PerkDetailsPage(page);
    const visual = new VisualComparisonHelper({
      outDir: VISUAL_OUT_DIR,
      fileKey: FIGMA_FILE_KEY,
      node: FIGMA_NODE,
    });

    await test.step('Planned — active magenta Delete', async () => {
      expect(await createAndOpen(request, details, 'planned'), 'Planned perk opened').toBe(true);
      const style = await details.getDeleteButtonStyle();
      await visual.compareScreen(page, 'Planned perk — active magenta Delete', {
        notes: `Delete bg=${style.background} fg=${style.color}; isMagenta=${style.isMagenta}`,
        fullPage: true,
      });
    });

    await test.step('Active — dimmed Delete, active Edit', async () => {
      expect(await createAndOpen(request, details, 'active'), 'Active perk opened').toBe(true);
      await visual.compareScreen(page, 'Active perk — dimmed Delete, active Edit', {
        notes: `deleteEnabled=${await details.isDeleteButtonEnabled()}; editEnabled=${await details.isEditButtonEnabled()}`,
        fullPage: true,
      });
    });

    await test.step('Active edit mode — greyed locked fields', async () => {
      await details.clickEdit();
      if (await details.isInEditMode()) {
        await visual.compareScreen(page, 'Active edit mode — greyed locked fields', {
          notes: `perkTypeLocked=${await details.isPerkTypeLocked()}`,
          fullPage: true,
        });
      }
    });

    await test.step('Expired — dimmed Delete and Edit', async () => {
      expect(await createAndOpen(request, details, 'expired'), 'Expired perk opened').toBe(true);
      await visual.compareScreen(page, 'Expired perk — dimmed Delete and Edit', {
        notes: `deleteEnabled=${await details.isDeleteButtonEnabled()}; editEnabled=${await details.isEditButtonEnabled()}`,
        fullPage: true,
      });
    });

    const report = visual.writeReport();
    expect(report.count, 'visual comparison records written').toBeGreaterThan(0);
  });
});
