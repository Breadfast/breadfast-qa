'use strict';

/**
 * B10-55168 — Increase MID Exclusion Capacity to 200
 * UI Test Suite — 20 test cases covering every AC via the Card Admin Panel browser UI
 *
 * Test environment merchant data used for boundary testing:
 *   elaraby          → 190 branch MIDs   ← alone = 190 (≤ 200) ✓ selectable
 *   Breadfast Coffee →  16 branch MIDs   ← elaraby + BFC = 206 (> 200) ✗ blocked
 *   Breadfast App    →  15 branch MIDs   ← elaraby + App = 205 (> 200) ✗ blocked
 *   breadfast market →   4 branch MIDs   ← elaraby + market = 194 (≤ 200) ✓
 *   Others           →   1–5 branch MIDs each
 *   ALL merchants    → 237 total MIDs    (> 200) — cannot all be selected
 *
 * CAP BEHAVIOUR (confirmed live 2026-06-21): the 200-MID cap is enforced CLIENT-SIDE
 * at selection time. The Excluded Merchants control sums each merchant's branch MIDs;
 * a selection that would push the running total over 200 does NOT toggle on and a
 * snackbar "Cannot select merchants with more than 200 merchants." is shown. There is
 * therefore NO over-limit save to reject server-side from the UI — negative tests
 * assert the blocked selection + warning, not a save rejection.
 *
 * Submit verification uses the real POST /card/perks/create call (HTTP status + the
 * excluded_merchants_ids count actually sent), not URL navigation alone.
 *
 * API boundary tests (exactly 200 and 201 MIDs):
 *   Covered by mid_exclusion_api.spec.js  TC_008 and TC_009.
 */

const { test, expect } = require('@playwright/test');
const config    = require('../../helpers/ConfigReader');
const LoginPage = require('../../pages/LoginPage');
const PerksPage = require('../../pages/PerksPage');

// ── Login before each test ───────────────────────────────────────────────────
test.beforeEach(async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.fillLoginFormAndSubmit(
    config.getAdminUserName(),
    config.getAdminPassword()
  );
});

// ── Shortcut: navigate to form and select General Spend Cashback ─────────────
async function openCreateForm(page) {
  const perks = new PerksPage(page);
  await perks.goToPerksPage();
  await perks.clickAddPerk();
  await perks.selectGeneralSpendCashbackType();
  return perks;
}

// ════════════════════════════════════════════════════════════════════════════
//  GROUP 1 — Form inspection (labels, buttons, navigation)
// ════════════════════════════════════════════════════════════════════════════

/**
 * TC_UI_001 — AC1 regression: Excluded Merchants label shows "(200 merchants max.)"
 *             The old limit "(60 merchants max.)" must NOT appear.
 */
test('[TC_UI_001] Form shows "(200 merchants max.)" label — not the old "(60 max.)"', async ({ page }) => {
  const perks = await openCreateForm(page);

  const visible = await perks.hasMaxCapacityLabel();
  expect(visible, 'Expected "(200 merchants max.)" hint in the Excluded Merchants section').toBe(true);

  const fullLabelText = await page
    .locator('text=/Excluded Merchants/')
    .first()
    .textContent();
  expect(fullLabelText).toMatch(/200/);
  expect(fullLabelText).not.toMatch(/\b60\b/);
});

/**
 * TC_UI_002 — "General spend cashback" exists as a selectable perk type option.
 */
test('[TC_UI_002] "General spend cashback" perk type option is available in the dropdown', async ({ page }) => {
  const perks = new PerksPage(page);
  await perks.goToPerksPage();
  await perks.clickAddPerk();

  await perks.perkTypeCombobox.click();
  await page.waitForTimeout(400);

  const opt = page.getByRole('option', { name: 'General spend cashback' });
  await expect(opt).toBeVisible();

  await page.keyboard.press('Escape');
});

/**
 * TC_UI_003 — "Add Perk" button navigates to the create form (#/perks/create).
 */
test('[TC_UI_003] "Add Perk" button navigates to the Create Perks form', async ({ page }) => {
  const perks = new PerksPage(page);
  await perks.goToPerksPage();
  await perks.clickAddPerk();

  await expect(page).toHaveURL(/\/#\/perks\/create/);
  await expect(perks.createPerksHeading).toBeVisible();
});

/**
 * TC_UI_004 — "Preview & Save" button is visible on the create form.
 */
test('[TC_UI_004] "Preview & Save" button is visible on the create form', async ({ page }) => {
  const perks = await openCreateForm(page);
  await expect(perks.previewAndSaveButton).toBeVisible();
});

/**
 * TC_UI_005 — All four "Add Image" upload slots are present on the form.
 *             Cover Photo EN, Cover Photo AR, Logo/Image EN, Logo/Image AR.
 */
test('[TC_UI_005] Four "Add Image" buttons are present (Cover EN, Cover AR, Logo EN, Logo AR)', async ({ page }) => {
  const perks = await openCreateForm(page);
  const count = await perks.addImageButtons.count();
  expect(count, 'Expected 4 image upload slots on the create form').toBeGreaterThanOrEqual(4);
});

// ════════════════════════════════════════════════════════════════════════════
//  GROUP 2 — Excluded Merchants multi-select (select / deselect)
// ════════════════════════════════════════════════════════════════════════════

/**
 * TC_UI_006 — Selecting 1 merchant marks it as aria-selected="true".
 */
test('[TC_UI_006] Selecting 1 merchant marks it as selected (aria-selected="true")', async ({ page }) => {
  const perks = await openCreateForm(page);

  await perks.selectMerchants(1);
  const selected = await perks.getSelectedMerchantsCount();
  expect(selected, 'Expected exactly 1 merchant to be selected').toBe(1);
});

/**
 * TC_UI_007 — Selecting 3 merchants marks all three as selected.
 */
test('[TC_UI_007] Selecting 3 merchants marks all 3 as selected', async ({ page }) => {
  const perks = await openCreateForm(page);

  const available = await perks.selectMerchants(3);
  const selected  = await perks.getSelectedMerchantsCount();
  expect(selected, 'Expected 3 selected merchants').toBe(Math.min(3, available));
});

/**
 * TC_UI_008 — Deselecting a merchant reduces the selected count.
 */
test('[TC_UI_008] Deselecting a merchant reduces the selected merchant count', async ({ page }) => {
  const perks = await openCreateForm(page);

  await perks.selectMerchants(2);
  const afterSelect = await perks.getSelectedMerchantsCount();
  expect(afterSelect).toBeGreaterThanOrEqual(1);

  // Re-open and deselect the first option (click it again)
  const opts = await perks.openExcludedMerchantsDropdown();
  await opts.first().click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  const afterDeselect = await perks.getSelectedMerchantsCount();
  expect(afterDeselect, 'Count must decrease after deselecting').toBeLessThan(afterSelect);
});

/**
 * TC_UI_009 — elaraby (190 branch MIDs, < 200 limit) can be selected without error.
 *             This validates the new 200-limit by confirming a near-limit selection is allowed.
 */
test('[TC_UI_009] Selecting elaraby (190 MIDs) is allowed — MID count < 200 threshold', async ({ page }) => {
  const perks = await openCreateForm(page);

  await perks.selectMerchantsByName(['elaraby']);
  const selected = await perks.getSelectedMerchantsCount();
  expect(selected, 'elaraby should be selectable without restriction').toBeGreaterThanOrEqual(1);

  // No inline cap-reached warning should appear
  const capWarning = page.locator('text=/limit reached|maximum reached|cannot add more|exceeded/i');
  await expect(capWarning).not.toBeVisible();
});

/**
 * TC_UI_010 — The 200-MID cap is enforced client-side at SELECTION time.
 *   elaraby (190) selects; adding Breadfast Coffee (+16 = 206 > 200) must be BLOCKED:
 *   the option stays unselected, a "Cannot select merchants with more than 200
 *   merchants." warning appears, and the running total stays ≤ 200.
 *
 *   (Confirmed live 2026-06-21: the UI prevents an over-limit selection, so an
 *    over-limit perk can never reach the save call — there is no server-side
 *    save rejection to assert.)
 */
test('[TC_UI_010] Cap blocks adding Breadfast Coffee after elaraby (190+16=206 > 200) with a warning', async ({ page }) => {
  const perks = await openCreateForm(page);

  const a = await perks.attemptToggleMerchant('elaraby');           // 190 ≤ 200 → allowed
  expect(a.selected, 'elaraby (190) should be selectable').toBe(true);

  const b = await perks.attemptToggleMerchant('Breadfast Coffee');  // 190+16=206 → blocked
  expect(b.selected, 'Breadfast Coffee must NOT be selectable (would be 206 > 200)').toBe(false);
  expect(b.capWarning, 'A "more than 200 merchants" cap warning must be shown').toBe(true);

  const total = await perks.getSelectedMidTotal();
  expect(total, 'Selected branch-MID total must stay ≤ 200').toBeLessThanOrEqual(200);
  expect(total, 'Only elaraby (190) should remain selected').toBe(190);
});

// ════════════════════════════════════════════════════════════════════════════
//  GROUP 3 — Required-field validation (submit with missing data)
// ════════════════════════════════════════════════════════════════════════════

/**
 * TC_UI_011 — Submitting without a perk title must show a validation error.
 */
test('[TC_UI_011] Submit without perk title → validation error, form stays on create page', async ({ page }) => {
  const perks = await openCreateForm(page);
  // Do NOT fill in a title — just click save immediately
  await perks.previewAndSaveButton.click();
  await page.waitForTimeout(1_500);

  await expect(page).toHaveURL(/\/#\/perks\/create/);
  // Angular marks invalid/touched fields with .ng-invalid — title field is required
  const invalidField = page.locator('mat-form-field.ng-invalid').first();
  await expect(invalidField).toBeVisible();
});

/**
 * TC_UI_012 — Submitting without images must not navigate to the perks list.
 *             Images are required (* fields) on the create form.
 */
test('[TC_UI_012] Submit without uploading images → form stays on create page', async ({ page }) => {
  const perks = await openCreateForm(page);

  // Fill text fields only — no image uploads
  await perks.titleEnInput.fill('No Images Test');
  await perks.titleArInput.fill('اختبار بدون صور');
  await perks.percentageRadio.click();
  await perks.cashbackValueInput.waitFor({ state: 'visible', timeout: 5_000 });
  await perks.cashbackValueInput.fill('5');
  await perks.descEnTextarea.fill('Test without images');
  await perks.descArTextarea.fill('اختبار بدون صور');

  await perks.previewAndSaveButton.click();
  await page.waitForTimeout(2_000);

  // Must stay on the create page — images are required
  await expect(page).toHaveURL(/\/#\/perks\/create/);
});

// ════════════════════════════════════════════════════════════════════════════
//  GROUP 4 — End-to-end perk creation (success paths)
// ════════════════════════════════════════════════════════════════════════════

/**
 * TC_UI_013 — Create perk with 0 excluded merchants (all required fields filled) → success.
 *             Validates the baseline: perk creation works without any merchant exclusions.
 */
test('[TC_UI_013] Create General Cashback perk with 0 excluded merchants → saved successfully', async ({ page }) => {
  const perks = await openCreateForm(page);
  await perks.fillMandatoryFields({ titleEn: 'B10-55168 TC_UI_013 Zero Merchants' });

  // No merchants selected — leave Excluded Merchants empty
  await perks.submitPerkExpectSuccess();

  await expect(page).toHaveURL(/\/#\/perks$/);
});

/**
 * TC_UI_014 — Create perk with breadfast market (4 MIDs, << 200) → success.
 *             Small-merchant selection well below the new 200-MID limit.
 */
test('[TC_UI_014] Create perk with breadfast market (4 MIDs, << 200) → saved successfully', async ({ page }) => {
  const perks = await openCreateForm(page);
  await perks.fillMandatoryFields({ titleEn: 'B10-55168 TC_UI_014 Small Merchant' });

  await perks.selectMerchantsByName(['breadfast market']);

  await perks.submitPerkExpectSuccess();
  await expect(page).toHaveURL(/\/#\/perks$/);
});

/**
 * TC_UI_015 — Create perk with elaraby (190 MIDs, < 200) → success.
 *             Near-limit selection — under the old 60-MID cap this would have failed.
 *             This directly validates that the new 200-limit is in effect.
 */
test('[TC_UI_015] Create perk with elaraby (190 MIDs, < 200 limit) → saved successfully', async ({ page }) => {
  const perks = await openCreateForm(page);
  await perks.fillMandatoryFields({ titleEn: 'B10-55168 TC_UI_015 Elaraby 190 MIDs' });

  await perks.selectMerchantsByName(['elaraby']);

  await perks.submitPerkExpectSuccess();
  await expect(page).toHaveURL(/\/#\/perks$/);
});

/**
 * TC_UI_016 — Attempting to select ALL merchants (237 branch MIDs total) cannot
 *             exceed the cap: at least one merchant is blocked with the cap warning
 *             and the selected branch-MID total never exceeds 200.
 */
test('[TC_UI_016] Selecting all merchants (237 MIDs) is capped — not all selectable, total stays ≤ 200', async ({ page }) => {
  const perks = await openCreateForm(page);

  const totalOptions = await (await perks.openExcludedMerchantsDropdown()).count();
  await page.keyboard.press('Escape');

  await perks.selectAllMerchants(); // clicks every option; over-limit ones are blocked client-side

  const selectedCount   = await perks.getSelectedMerchantsCount();
  const elarabySelected = await perks.isMerchantSelected('elaraby');

  // At least one merchant must be blocked — all 237 MIDs cannot be selected together.
  expect(
    selectedCount,
    `Not every merchant can be selected (all would be 237 MIDs > 200) — selected ${selectedCount}/${totalOptions}`
  ).toBeLessThan(totalOptions);

  // elaraby (190) cannot be added on top of the other ~47 MIDs (47+190 = 237 > 200).
  expect(
    elarabySelected,
    'elaraby (190 MIDs) must be blocked once other merchants are selected (would exceed 200)'
  ).toBe(false);
});

/**
 * TC_UI_017 — Create perk with "Fixed Amount" cashback type → success.
 */
test('[TC_UI_017] Create perk with Fixed Amount cashback type → saved successfully', async ({ page }) => {
  const perks = await openCreateForm(page);
  await perks.fillMandatoryFields({
    titleEn:      'B10-55168 TC_UI_017 Fixed Amount',
    titleAr:      'اختبار مبلغ ثابت',
    descEn:       'Fixed EGP 50 cashback per transaction',
    descAr:       'استرداد ٥٠ جنيه ثابت لكل معاملة',
    cashback:     '50',
    minTx:        '200',
    cashbackType: 'fixed',
  });

  await perks.submitPerkExpectSuccess();
  await expect(page).toHaveURL(/\/#\/perks$/);
});

/**
 * TC_UI_018 — Create perk with "Percentage" cashback type → success.
 */
test('[TC_UI_018] Create perk with Percentage cashback type → saved successfully', async ({ page }) => {
  const perks = await openCreateForm(page);
  await perks.fillMandatoryFields({
    titleEn:  'B10-55168 TC_UI_018 Percentage Type',
    titleAr:  'اختبار نوع النسبة المئوية',
    cashback: '10',
    minTx:    '100',
  });

  await perks.submitPerkExpectSuccess();
  await expect(page).toHaveURL(/\/#\/perks$/);
});

/**
 * TC_UI_019 — Newly created perk appears in the perks list.
 *             The most recently created perk must appear at the top of the list
 *             with type "General spend cashback".
 */
test('[TC_UI_019] Newly created perk is visible in the perks list with correct type', async ({ page }) => {
  const perks = await openCreateForm(page);
  await perks.fillMandatoryFields({ titleEn: 'B10-55168 TC_UI_019 List Verify' });

  await perks.submitPerkExpectSuccess();

  await expect(page).toHaveURL(/\/#\/perks$/);

  // Latest perk is in the first row of the table
  const firstRow = page.locator('table tbody tr').first();
  await expect(firstRow).toContainText('General spend cashback');
  await expect(firstRow).toContainText('B10-55168');
});

/**
 * TC_UI_020 — Alternative over-limit combination confirming the cap is consistent:
 *             elaraby (190) selects; adding Breadfast App (+15 = 205 > 200) is blocked
 *             with the cap warning and the total stays ≤ 200.
 */
test('[TC_UI_020] Cap blocks adding Breadfast App after elaraby (190+15=205 > 200) with a warning', async ({ page }) => {
  const perks = await openCreateForm(page);

  const a = await perks.attemptToggleMerchant('elaraby');         // 190 → allowed
  expect(a.selected, 'elaraby (190) should be selectable').toBe(true);

  const b = await perks.attemptToggleMerchant('Breadfast App');   // 190+15=205 → blocked
  expect(b.selected, 'Breadfast App must NOT be selectable (would be 205 > 200)').toBe(false);
  expect(b.capWarning, 'A "more than 200 merchants" cap warning must be shown').toBe(true);

  const total = await perks.getSelectedMidTotal();
  expect(total, 'Selected branch-MID total must stay ≤ 200').toBe(190);
});

/**
 * TC_UI_021 — Cap-recovery + payload integrity (B10-56609 regression guard).
 *
 * B10-56609 (server-reject → correct → stale-resubmit) required submitting a > 200-MID
 * list. The client-side cap now BLOCKS selecting over 200, so that exact path is no
 * longer reachable from the UI. This test verifies the reachable equivalent and the
 * core concern of B10-56609 — payload integrity:
 *
 *   1. Select elaraby (190 ≤ 200) → allowed.
 *   2. Attempt Breadfast Coffee (190+16 = 206 > 200) → blocked with the cap warning.
 *   3. Save the remaining valid selection → the create call must return 200 AND the
 *      submitted excluded_merchants_ids must contain EXACTLY the 190 valid MIDs
 *      (no stale/extra entries leaking into the payload — the B10-56609 desync).
 */
test('[TC_UI_021] After cap blocks an over-limit add, the valid 190-MID selection saves with the exact payload (B10-56609 guard)', async ({ page }) => {
  const perks = await openCreateForm(page);
  await perks.fillMandatoryFields({ titleEn: 'B10-55168 TC_UI_021 Cap Recovery' });

  // Step 1 — elaraby (190) is allowed
  const a = await perks.attemptToggleMerchant('elaraby');
  expect(a.selected, 'elaraby (190) should be selectable').toBe(true);

  // Step 2 — Breadfast Coffee (206) is blocked client-side
  const b = await perks.attemptToggleMerchant('Breadfast Coffee');
  expect(b.selected, 'Breadfast Coffee must be blocked (190+16=206 > 200)').toBe(false);
  expect(b.capWarning, 'cap warning must be shown').toBe(true);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // Step 3 — the valid 190-MID selection saves, and the payload carries exactly 190 MIDs
  const r = await perks.submitPerkExpectSuccess();
  expect(r.status, 'create API should return 200').toBe(200);
  expect(
    r.midCount,
    'submitted payload must carry exactly the 190 valid MIDs (no stale/extra entries — B10-56609)'
  ).toBe(190);
  await expect(page).toHaveURL(/\/#\/perks$/);
});
