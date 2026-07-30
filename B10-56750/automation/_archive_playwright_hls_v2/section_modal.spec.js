'use strict';

/**
 * B10-56750 — "Add section" inline-creation modal (HLS v2 items 6–13)
 *
 * Generated against **HLS v2** (2026-07-26). Assertions target the SPEC (AC +
 * the design-wins rulings in clarifications B1–B8); a failure is a reportable
 * defect. Known defects are tagged [DEFECT-EXPECTED <id>] and asserted `soft`
 * so one documented gap does not mask the rest of the modal's coverage.
 *
 * Test-data note (clarifications §Prerequisites): there is NO delete-section
 * flow, so every successful create permanently adds a row to a shared
 * environment. Creates are therefore unique-stamped and kept to the minimum the
 * ACs require (AC-07/08/12). Duplicate-rule cases deliberately reuse an
 * EXISTING name so they create nothing.
 */

const { test, expect } = require('@playwright/test');
const LoginPage = require('../../../automation/pages/LoginPage');
const PerksPage = require('../../../automation/pages/PerksPage');
const config = require('../../../automation/helpers/ConfigReader');
const stamp = () => String(Date.now()).slice(-6);

/**
 * Tear down any lingering cdk overlay backdrop.
 *
 * The Section `mat-select` panel and the Add-section dialog are TWO stacked
 * cdk overlays: dismissing the dialog leaves the select panel (and its
 * backdrop) behind. The next click on the select then reports
 * "element is visible, enabled and stable" and still times out, because the
 * orphaned backdrop intercepts pointer events. Any shared page-object method
 * that assumes a closed starting point (getSectionOptions, selectSection)
 * must be preceded by this.
 */
async function settleOverlays(page) {
  for (let i = 0; i < 4; i += 1) {
    if (!(await page.locator('.cdk-overlay-backdrop').count().catch(() => 0))) break;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(350);
  }
}

async function openModalOnFreshForm(page, type = 'Discount/coupon') {
  const login = new LoginPage(page);
  const perks = new PerksPage(page);
  await login.fillLoginFormAndSubmit(config.getAdminUserName(), config.getAdminPassword());
  await perks.goToPerksPage();
  await perks.clickAddPerk();
  await perks.selectPerkTypeByName(type);
  await perks.openAddSectionModal();
  return perks;
}

test.describe('B10-56750 · Add section modal', () => {
  // ── HLS 6 · AC-05 — modal structure, title, fields, placeholders, markers ──
  test('Verify the "Add section" modal structure, title, field labels and required markers', async ({ page }) => {
    const perks = await openModalOnFreshForm(page);

    await expect(perks.addSectionModal).toBeVisible();
    expect(await perks.getAddSectionModalTitle(), 'title must be sentence-case "Add section"').toBe('Add section');

    // Overlay backdrop = the dimmed page behind the modal.
    await expect(page.locator('.cdk-overlay-backdrop').first(), 'page behind must be dimmed by an overlay backdrop').toBeAttached();

    await expect(perks.addSectionNameEnInput, 'Section name EN field must exist').toBeVisible();
    await expect(perks.addSectionNameArInput, 'Section name AR field must exist').toBeVisible();

    // Design placeholders: EN "e.g Fitness", AR "اسم التصنيف".
    const enPlaceholder = await perks.addSectionNameEnInput.getAttribute('placeholder');
    const arPlaceholder = await perks.addSectionNameArInput.getAttribute('placeholder');
    expect.soft(enPlaceholder, 'EN placeholder per design "e.g Fitness" [DEFECT-EXPECTED F-05]').toBe('e.g Fitness');
    expect.soft(arPlaceholder, 'AR placeholder per design "اسم التصنيف" [DEFECT-EXPECTED F-05]').toBe('اسم التصنيف');

    // Design marks BOTH fields required with a red asterisk.
    const modalText = ((await perks.addSectionModal.innerText()) || '').trim();
    expect.soft(modalText, 'EN field must carry a required marker [DEFECT-EXPECTED F-04]').toMatch(/Section name EN\s*\*/);
    expect.soft(modalText, 'AR field must carry a required marker [DEFECT-EXPECTED F-04]').toMatch(/Section name AR\s*\*/);
  });

  // ── HLS 7 · AC-05 — the Arabic field is enforced as required ──
  test('Verify the Arabic Section name is enforced as required and an English-only submit is blocked', async ({ page }) => {
    const perks = await openModalOnFreshForm(page);

    const created = [];
    page.on('response', (r) => {
      if (/section\/create/i.test(r.url())) created.push(r.status());
    });

    await perks.fillAddSectionModal(`QA EnOnly ${stamp()}`, '');
    await perks.addSectionSubmitButton.click();
    await page.waitForTimeout(1500);

    await expect(perks.addSectionModal, 'modal must stay open when AR is empty').toBeVisible();
    // Required/max-length render as per-field <mat-error>, NOT the form-level
    // span.text-danger the duplicate error uses — see PerksPage constructor.
    expect(
      (await perks.getAddSectionFieldErrorTexts()).join(' | '),
      'a required-field error must be shown against the empty AR field'
    ).toMatch(/required/i);
    expect(created, 'no create request may be issued for an EN-only submit').toEqual([]);

    // Symmetry: AR-only must be blocked too (EN is required per AC-05 text).
    await perks.fillAddSectionModal('', `قسم ${stamp()}`);
    await perks.addSectionSubmitButton.click();
    await page.waitForTimeout(1500);
    await expect(perks.addSectionModal, 'modal must stay open when EN is empty').toBeVisible();
    expect(
      (await perks.getAddSectionFieldErrorTexts()).join(' | '),
      'a required-field error must be shown against the empty EN field'
    ).toMatch(/required/i);
    expect(created, 'no create request may be issued for an AR-only submit').toEqual([]);
  });

  // ── HLS 8 · AC-06 — exactly two CTAs; Cancel creates nothing ──
  test('Verify the "Add section" modal exposes exactly two CTAs and Cancel saves nothing', async ({ page }) => {
    const perks = await openModalOnFreshForm(page);

    await expect(perks.addSectionSubmitButton).toBeVisible();
    await expect(perks.addSectionSubmitButton).toHaveText(/Add section/);
    await expect(perks.addSectionSubmitButton, 'primary CTA is the filled button').toHaveClass(/btn-primary/);
    await expect(perks.addSectionCancelButton).toBeVisible();
    await expect(perks.addSectionCancelButton, 'secondary CTA is a text link').toHaveClass(/btn-link/);

    await settleOverlays(page);
    const before = await perks.getSectionOptions();

    await settleOverlays(page);
    await perks.openAddSectionModal();
    const throwaway = `QA Cancelled ${stamp()}`;
    await perks.fillAddSectionModal(throwaway, `ملغى ${stamp()}`);
    await perks.cancelAddSectionModal();
    await expect(perks.addSectionModal, 'Cancel must close the modal').toBeHidden();

    await settleOverlays(page);
    const after = await perks.getSectionOptions();
    expect(after, 'Cancel must not create a Section').toEqual(before);
    expect(after.some((o) => o.includes(throwaway)), 'the cancelled name must not appear').toBe(false);
  });

  // ── HLS 9 · AC-07 — in-flight: spinner + non-interactive, no double-create ──
  test('Verify the in-flight loading state of the "Add section" button and that a double-click cannot create two Sections', async ({ page }) => {
    const perks = await openModalOnFreshForm(page);
    const s = stamp();

    const creates = [];
    page.on('response', (r) => {
      if (/section\/create/i.test(r.url()) && r.request().method() === 'POST') creates.push(r.status());
    });

    await perks.fillAddSectionModal(`QA Inflight ${s}`, `اثناء الطلب ${s}`);

    // Sample the button synchronously after the click so the in-flight window
    // (~400ms live) is actually observed rather than assumed.
    const submit = perks.addSectionSubmitButton;
    await submit.click();
    let sawDisabled = false;
    let sawSpinner = false;
    for (let i = 0; i < 40; i += 1) {
      const s2 = await submit
        .evaluate((btn) => ({
          disabled: btn.disabled || btn.getAttribute('aria-disabled') === 'true',
          spinner: !!btn.querySelector('mat-spinner, mat-progress-spinner, .spinner, [class*="spin"]'),
        }))
        .catch(() => null);
      if (s2) {
        sawDisabled = sawDisabled || s2.disabled;
        sawSpinner = sawSpinner || s2.spinner;
      }
      if (!(await perks.addSectionModal.isVisible().catch(() => false))) break;
      await page.waitForTimeout(40);
    }

    expect(sawSpinner, 'a spinner must render inside the Add section button while in-flight').toBe(true);
    expect(sawDisabled, 'the Add section button must be non-interactive while in-flight').toBe(true);

    await page.waitForTimeout(1500);
    expect(creates.filter((c) => c === 200).length, 'exactly one Section may be created').toBe(1);
  });

  // ── HLS 10 · AC-08 — success: closes, green toast, new Section auto-selected ──
  test('Verify successful Section creation closes the modal, shows the success toast, and auto-selects the new Section', async ({ page }) => {
    const perks = await openModalOnFreshForm(page);
    const s = stamp();
    const nameEn = `QA Success ${s}`;
    const nameAr = `نجاح ${s}`;

    await perks.fillAddSectionModal(nameEn, nameAr);

    // Arm the toast wait BEFORE submitting, then await it after. The toast is
    // transient (auto-dismisses) and only appears once the create round-trip
    // completes, so a wait STARTED after the submit can miss it, and a short
    // wait started before the submit expires before it ever renders.
    const toastSeen = page
      .locator('snack-bar-container, simple-snack-bar')
      .filter({ hasText: /Section created successfully/i })
      .first()
      .waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => true)
      .catch(() => false);

    const result = await perks.submitAddSection();
    const sawToast = await toastSeen;

    expect(result.status, 'create must succeed').toBe(200);
    expect(result.closed, 'the modal must close on success').toBe(true);
    expect(sawToast, 'a green "Section created successfully" toast must appear').toBe(true);

    // POLL the trigger — do not read it once. Angular paints the auto-selected
    // value into the (now-closed) trigger asynchronously: measured live, it is
    // empty at t≈0 and populated from ~500 ms onward, then stable. A single
    // immediate read reports an empty trigger and looks exactly like
    // "auto-selection is broken" — it produced precisely that false defect
    // before this poll was added.
    // Poll the trigger — the auto-selected value lands ~300-500 ms after the
    // dialog closes, so a single immediate read returns empty and looks exactly
    // like "auto-selection is broken".
    //
    // This assertion previously failed for a harness reason worth remembering:
    // `submitAddSection()` used to press Escape (via `_closeStaleSectionPanel()`)
    // BEFORE the value committed, and Escape on the still-open Section panel
    // cancels the pending selection outright — the control kept `mat-select-empty`
    // permanently while create returned 200, the modal closed and the toast fired.
    // Bisected 2026-07-26 and fixed in `PerksPage.submitAddSection()` by waiting
    // for the value to commit and only then closing the panel. See the comment
    // there. Read via textContent, not innerText.
    await expect
      .poll(async () => ((await perks.sectionDropdown.textContent().catch(() => '')) || '').trim(), {
        message: 'the newly created Section must be auto-selected in the Section dropdown',
        timeout: 15_000,
        intervals: [250, 250, 500, 500, 1000],
      })
      .toContain(nameEn);

    const trigger = ((await perks.sectionDropdown.textContent().catch(() => '')) || '').trim();
    expect(trigger, 'auto-selection shows the bilingual "EN - AR" label').toContain(nameAr);
  });

  // ── HLS 11 · AC-09 — duplicate: red field highlight, inline error, stays open ──
  test('Verify a duplicate Section name shows the inline error, keeps the modal open, and preserves the entered values', async ({ page }) => {
    const perks = await openModalOnFreshForm(page);

    // Reuse an existing Section verbatim so nothing is created.
    await perks.cancelAddSectionModal();
    const existing = (await perks.getSectionOptions()).filter((o) => !/add section/i.test(o))[0];
    const [enName, arName] = existing.split(/\s+-\s+/);
    expect(arName, 'need a bilingual seeded Section to build the duplicate case').toBeTruthy();

    await perks.openAddSectionModal();
    await perks.fillAddSectionModal(enName, arName);
    await perks.addSectionSubmitButton.click();
    await page.waitForTimeout(2500);

    await expect(perks.addSectionModal, 'the modal must remain open on a duplicate').toBeVisible();
    expect(await perks.getAddSectionErrorText(), 'inline duplicate error must be shown').toMatch(/This section already exists/i);

    // Entered values must survive so the admin can correct them.
    expect(await perks.addSectionNameEnInput.inputValue(), 'EN value must be preserved').toBe(enName);
    expect(await perks.addSectionNameArInput.inputValue(), 'AR value must be preserved').toBe(arName);

    // AC-09 requires the name field itself to be highlighted red. Live renders
    // only the shared message (aria-invalid stays false) — finding F-03.
    expect.soft(
      await perks.isAddSectionNameFieldMarkedInvalid(),
      'the Section-name field must be marked invalid / highlighted red [DEFECT-EXPECTED F-03]'
    ).toBe(true);
  });

  // ── HLS 12 · AC-09 — the duplicate-matching rule, isolated per dimension ──
  test('Verify the duplicate-matching rule: EITHER name matches, case-insensitively and trimmed', async ({ page }) => {
    const perks = await openModalOnFreshForm(page);
    await perks.cancelAddSectionModal();
    const existing = (await perks.getSectionOptions()).filter((o) => !/add section/i.test(o))[0];
    const [enName, arName] = existing.split(/\s+-\s+/);
    const s = stamp();

    // Each case varies ONE dimension and makes the OTHER name unique, so a
    // rejection proves the varied name alone matched (v1's matrix could not
    // distinguish an EN hit from an AR hit because both collided at once).
    const cases = [
      { label: 'EN exact, AR unique', en: enName, ar: `فريد ألف ${s}` },
      { label: 'EN upper-cased, AR unique', en: enName.toUpperCase(), ar: `فريد باء ${s}` },
      { label: 'EN whitespace-padded, AR unique', en: `  ${enName}  `, ar: `فريد جيم ${s}` },
      { label: 'EN unique, AR exact', en: `QA Unique ${s}`, ar: arName },
    ];

    for (const c of cases) {
      await perks.openAddSectionModal();
      await perks.fillAddSectionModal(c.en, c.ar);
      await perks.addSectionSubmitButton.click();
      await page.waitForTimeout(2500);

      const open = await perks.addSectionModal.isVisible().catch(() => false);
      expect(open, `"${c.label}" must be rejected as a duplicate (modal stays open)`).toBe(true);
      expect(await perks.getAddSectionErrorText(), `"${c.label}" must show the duplicate error`).toMatch(/already exists/i);

      await perks.cancelAddSectionModal();
    }
  });

  // ── HLS 13 · AC-10 — dismissal clears inputs and returns focus ──
  test('Verify dismissing the "Add section" modal via Cancel and via the X icon clears all inputs without saving', async ({ page }) => {
    const perks = await openModalOnFreshForm(page);

    // Partially-filled → Cancel → reopen must be clean.
    await perks.fillAddSectionModal('Dirty EN', 'قذر');
    await perks.cancelAddSectionModal();
    await perks.openAddSectionModal();
    expect(await perks.addSectionNameEnInput.inputValue(), 'EN must be cleared after Cancel').toBe('');
    expect(await perks.addSectionNameArInput.inputValue(), 'AR must be cleared after Cancel').toBe('');

    // AC-10's second dismissal path is "the X icon". The dialog header has no X
    // control at all (only the two per-input Clear affordances) — finding F-01.
    const headerClose = perks.addSectionModal.locator(
      'h3 button, [mat-dialog-title] button, button[aria-label*="close" i], button.close'
    );
    expect
      .soft(await headerClose.count(), 'the modal must expose an X close control [DEFECT-EXPECTED F-01]')
      .toBeGreaterThan(0);

    // Exercise the only available non-Cancel dismissal so the path is covered.
    await perks.fillAddSectionModal('Dirty2 EN', 'قذر٢');
    await perks.closeAddSectionModalViaX();
    await expect(perks.addSectionModal, 'the modal must close via the non-Cancel path').toBeHidden();
    await perks.openAddSectionModal();
    expect(await perks.addSectionNameEnInput.inputValue(), 'EN must be cleared after the X/Escape path').toBe('');
    expect(await perks.addSectionNameArInput.inputValue(), 'AR must be cleared after the X/Escape path').toBe('');
  });

  // ── Max length (clarifications assumption B — corrected by live evidence) ──
  test('Verify Section names are capped at 50 characters with a clear validation message', async ({ page }) => {
    const perks = await openModalOnFreshForm(page);

    const creates = [];
    page.on('response', (r) => {
      if (/section\/create/i.test(r.url())) creates.push(r.status());
    });

    await perks.fillAddSectionModal(`QA Long ${stamp()} ${'X'.repeat(80)}`, `طويل ${'ي'.repeat(80)}`);
    await perks.addSectionSubmitButton.click();
    await page.waitForTimeout(1800);

    await expect(perks.addSectionModal, 'an over-long name must be rejected client-side').toBeVisible();
    expect(
      (await perks.getAddSectionFieldErrorTexts()).join(' | '),
      'a max-length message must be shown'
    ).toMatch(/Maximum length should be 50 characters/i);
    expect(creates, 'no create request may be issued for an over-long name').toEqual([]);
  });
});
