'use strict';

/**
 * PerksPage — Card Admin Panel  (#/perks  and  #/perks/create)
 *
 * Selectors verified against live form (2026-06-09):
 *
 * Form field map (General Spend Cashback):
 *   perk type          → combobox "Select Type"
 *   title EN           → mat-form-field :has-text("Perk Title EN") > input
 *   title AR           → mat-form-field :has-text("Perk Title Ar") > input
 *   cover photo EN     → Add Image button [0]
 *   cover photo AR     → Add Image button [1]
 *   logo EN            → Add Image button [2]
 *   logo AR            → Add Image button [3]
 *   cashback type      → mat-radio-button "Fixed Amount" | "Percentage"
 *   cashback value     → input[placeholder="e.g 4"]  (DOM-dynamic, appears after radio select)
 *   min tx amount      → input[type=number][placeholder="e.g 100"] first()  (also dynamic)
 *   desc EN            → textarea[placeholder*="Get 10% off"]
 *   desc AR            → textarea[placeholder="احصل على خصم ١٠٪"]
 *   excl. merchants    → combobox "Excluded Merchants (All Branch MIDs)"
 *   capacity label     → visible text "(200 merchants max.)"
 *
 * Image upload: buttons trigger a dynamic file-picker (no static <input type=file>).
 *   Playwright waitForEvent('filechooser') intercepts the OS dialog.
 *
 * Test-environment merchant data (2026-06-09):
 *   elaraby             → 190 branch MIDs   ← <200 alone; combine for >200 test
 *   Breadfast Coffee    →  16 branch MIDs
 *   Breadfast App       →  15 branch MIDs
 *   breadfast market    →   4 branch MIDs
 *   (others)            →   1–5 branch MIDs each
 */

const path     = require('path');
const { expect } = require('@playwright/test');
const BasePage = require('./BasePage');

// ── Image assets ─────────────────────────────────────────────────────────────
const PHOTO_DIR = path.join(__dirname, '..', 'perks photos');
const PHOTOS = {
  // Apple/Adidas/Nike composite — requested by user for both Cover EN and Cover AR
  coverEn: path.join(PHOTO_DIR, 'ChatGPTImageFeb3202607_40_32PM.jpeg'),
  coverAr: path.join(PHOTO_DIR, 'ChatGPTImageFeb3202607_40_32PM.jpeg'),
  // Apple/Adidas/Nike logo composite — requested by user for both Logo EN and Logo AR
  logoEn:  path.join(PHOTO_DIR, 'Gemini_Generated_Image_dnm2wmdnm2wmdnm2.jpeg'),
  logoAr:  path.join(PHOTO_DIR, 'Gemini_Generated_Image_dnm2wmdnm2wmdnm2.jpeg'),

  // B10-56729 (AC8) — the create form NOW validates exact image specs per slot.
  // Verified live against each upload dialog 2026-07-14:
  //   Cover photo EN/AR → 1080×1080 px, 1:1 aspect ratio, ≤ 500 KB
  //   Logo EN/AR        →  240×180  px, 4:3 aspect ratio, ≤  80 KB
  // The composites above (1020×510 cover, 300×300 logo) are REJECTED
  // ("Image resolution is invalid") and leave the slot empty, which silently
  // blocks Preview & save. Use these exact-size assets for the new form.
  coverSpec: path.join(PHOTO_DIR, 'exact_1080x1080.jpg'), // Cover photo EN/AR
  logoSpec:  path.join(PHOTO_DIR, 'exact_240x180.jpg'),   // Logo EN/AR
};

class PerksPage extends BasePage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    super(page);

    // ── Perks list ──────────────────────────────────────────────────────
    // .first(): the panel can render more than one "Add Perk" trigger (page + nav),
    // which trips Playwright strict-mode in waitFor/click. Pin to the first match.
    this.addPerkButton = page.locator("button:has-text('Add Perk')").first();

    // ── Create form ─────────────────────────────────────────────────────
    // B10-56729 (AC1): the page title was renamed to sentence-case "Create perk".
    // Match the new title (and stay tolerant of the old "Create Perks") across h1..h4.
    this.createPerksHeading = page
      .locator('h1, h2, h3, h4')
      .filter({ hasText: /create perk/i })
      .first();

    // Perk type.
    // NOT getByRole('combobox', { name: 'Select Type' }) — the funding_types select carries the
    // same accessible name ("Select type"), so once the Value section renders that locator
    // resolves to 2 elements and every click fails on strict mode (live 2026-07-27, B10-57393).
    // formcontrolname is unique and stable.
    this.perkTypeCombobox        = page.locator('mat-select[formcontrolname="type"]');
    this.generalSpendCashbackOpt = page.getByRole('option',   { name: 'General spend cashback' });

    // Titles — app-bf-input is a custom Angular component; navigate into it for the native input
    //   controlname confirmed from live DOM inspect (2026-06-09)
    this.titleEnInput = page.locator('app-bf-input[controlname="title_en"] input');
    this.titleArInput = page.locator('app-bf-input[controlname="title_ar"] input');

    // Descriptions — direct textarea elements with formcontrolname (confirmed from live DOM)
    this.descEnTextarea = page.locator('textarea[formcontrolname="description_en"]');
    this.descArTextarea = page.locator('textarea[formcontrolname="description_ar"]');

    // Cashback type radios
    this.percentageRadio  = page.locator('mat-radio-button').filter({ hasText: 'Percentage' });
    this.fixedAmountRadio = page.locator('mat-radio-button').filter({ hasText: 'Fixed Amount' });

    // These inputs are inside *ngIf — only appear in DOM after a radio is selected.
    // formcontrolname confirmed from live DOM after clicking Percentage radio.
    this.cashbackValueInput  = page.locator('input[formcontrolname="cashback_value"]');
    this.minTransactionInput = page.locator('input[formcontrolname="minimum_transaction_amount"]');

    // Image upload buttons — order on form: Cover EN, Cover AR, Logo EN, Logo AR
    this.addImageButtons = page.locator("button:has-text('Add Image')");

    // Excluded merchants multi-select
    this.excludedMerchantsCombobox = page.getByRole('combobox', { name: /Excluded Merchants/i });

    // Capacity hint: full label reads "Excluded Merchants (All Branches) (200 merchants max.)"
    this.maxCapacityLabel = page.locator('text=(200 merchants max.)');

    // Client-side cap warning shown when a selection would exceed 200 branch MIDs.
    // Exact copy confirmed from live form (2026-06-21).
    this.capWarning = page.locator('text=Cannot select merchants with more than 200 merchants');

    // Preview & Save (two on form — top and bottom; use last/bottom)
    this.previewAndSaveButton = page.locator("button:has-text('Preview & Save')").last();

    // ════════════════════════════════════════════════════════════════════
    //  B10-56757 — Perks TABLE (#/perks list) locators
    //  See the dated "B10-56757" comment block further down for the full
    //  selector rationale + the live-DOM verification blocker (env 502).
    // ════════════════════════════════════════════════════════════════════
    this.perksTable        = page.locator('table, mat-table').first();
    this.tableHeaderCells  = page.locator('table thead th, mat-header-cell, [role="columnheader"]');
    // Apply-filters ("Search") + persist-reorder ("Save order") buttons.
    this.searchFilterButton = page.locator("button:has-text('Search')").first();
    this.saveOrderButton    = page.locator("button:has-text('Save order')").first();
    // Row drag-reorder handles (6-dot icon) — the design realizes AC-03/04
    // "sorting" as drag-and-drop row reordering, present only in a category view.
    this.dragHandles        = page.locator(
      '.cdk-drag-handle, [cdkDragHandle], [class*="drag"], mat-icon:has-text("drag_indicator")'
    );
    // In-table empty states: filtered ("No results found") and zero-data
    // ("There are no perks added yet") — see Figma "Perks table - Empty state".
    this.emptyState = page.locator(
      'text=/no results found|there are no perks added yet|no perks/i'
    ).first();
    // Delete confirmation modal (AC-08).
    this.deleteConfirmDialog = page
      .locator('mat-dialog-container, .modal, [role="dialog"]')
      .filter({ hasText: /are you sure you want to delete this perk/i });

    // ════════════════════════════════════════════════════════════════════
    //  B10-56750 — Section dropdown "+ Add section" inline-creation modal.
    //  Selectors captured LIVE against card-panel-testing 2026-07-16 by
    //  actually driving the browser (Playwright MCP), not guessed from Figma.
    //  See the dated method-level comments below for the full provenance,
    //  including two live-confirmed DEVIATIONS from the BrowserStack CSV/AC
    //  wording (modal title casing + labels; no distinct "X" close icon;
    //  duplicate error is a shared message, not a red field highlight) and
    //  one AMBIGUITY RESOLUTION (Section name Arabic IS required live).
    // ════════════════════════════════════════════════════════════════════
    this.sectionDropdown = page.locator('mat-select[formcontrolname="section_id"]');
    // The "+ Add section" row renders as a DISABLED <mat-option> wrapping an
    // ENABLED <button class="add-section-btn">. Clicking it therefore needs
    // { force: true } (Playwright treats the button as non-actionable because
    // an ancestor carries aria-disabled="true" — confirmed live: a plain click
    // times out with "element is not enabled").
    this.addSectionOptionButton = page.locator('mat-option button.add-section-btn');
    this.addSectionModal = page
      .locator('mat-dialog-container')
      .filter({ has: page.locator('app-create-section-dialog') });
    this.addSectionNameEnInput = this.addSectionModal.locator('app-bf-input[controlname="name_en"] input');
    this.addSectionNameArInput = this.addSectionModal.locator('app-bf-input[controlname="name_ar"] input');
    this.addSectionSubmitButton = this.addSectionModal.locator('button[type="submit"]');
    this.addSectionCancelButton = this.addSectionModal.locator('button.btn-link', { hasText: 'Cancel' });
    // Duplicate-name error (AC-09) — a SHARED text-danger span below both
    // fields, not a per-field message (live DOM: both inputs keep
    // aria-invalid="false" even while this is shown).
    this.addSectionErrorText = this.addSectionModal.locator('span.text-danger');
    // FIELD-level validation (required / max-length) uses a DIFFERENT element:
    // one <mat-error> per input. Confirmed live 2026-07-26 by DOM capture:
    //   empty submit    → 2 × <mat-error>"This field is required."
    //   >50 chars       → 2 × <mat-error>"Maximum length should be 50 characters."
    //   duplicate name  → 1 × <span class="text-danger d-block"> (NO mat-error)
    // The two are disjoint — span.text-danger is 0 in the first two states and
    // mat-error is 0 in the duplicate state. Reading only span.text-danger
    // therefore returns '' for required/max-length and silently looks like
    // "no validation", so field-level checks MUST use this locator instead.
    this.addSectionFieldErrors = this.addSectionModal.locator('mat-error');

    // ════════════════════════════════════════════════════════════════════
    //  B10-56729 gap-fill (TC22/23/24) — Merchant & Category pickers.
    //  Selectors captured LIVE 2026-07-16. See selectMerchantForPerk() /
    //  selectCategoryForPerk() below for the full interaction notes.
    // ════════════════════════════════════════════════════════════════════
    this.merchantPickerInput = page.locator('input[data-placeholder="Select one or more branches"]');
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  async goToPerksPage() {
    await this.goToUrl('/#/perks');
    await this.waitForVisible(this.addPerkButton);
  }

  async clickAddPerk() {
    await this.addPerkButton.click();
    await this.page.waitForURL('**/#/perks/create', { timeout: 15_000 });
    await this.waitForVisible(this.createPerksHeading);
  }

  // ── Perk type ─────────────────────────────────────────────────────────────

  async selectGeneralSpendCashbackType() {
    await this.perkTypeCombobox.click();
    await this.waitForVisible(this.generalSpendCashbackOpt);
    await this.generalSpendCashbackOpt.click();
    await this.page.waitForTimeout(800);
  }

  // ── Image upload ──────────────────────────────────────────────────────────

  /**
   * Click an "Add Image" button, handle the upload dialog, and close it.
   *
   * Flow (confirmed from live DOM 2026-06-09):
   *   1. Clicking "Add Image" opens a mat-dialog-container with app-bf-upload-file-dialog.
   *      The dialog shows a drop zone + "Upload Document" button + hidden input[type=file].
   *   2. We set the file directly on the hidden input inside the dialog (fires Angular's
   *      filechange handler without needing OS file picker).
   *   3. After setting the file, Angular processes the upload and either:
   *      a. The dialog auto-closes, OR
   *      b. A "Save" / confirm button appears inside the dialog.
   *   4. We click the close icon on the dialog header if still open (the × mat-icon
   *      in the dialog's title bar).
   *
   * @param {0|1|2|3} slotIndex  0=Cover EN, 1=Cover AR, 2=Logo EN, 3=Logo AR
   * @param {string}  imagePath  Absolute path to the image file
   */
  async uploadImage(slotIndex, imagePath) {
    // 1. Click the "Add Image" button to open the upload dialog
    await this.addImageButtons.nth(slotIndex).click();

    // 2. Wait for the dialog to be fully visible
    const dialog = this.page.locator('mat-dialog-container');
    await dialog.waitFor({ state: 'visible', timeout: 8_000 });
    await this.page.waitForTimeout(400);

    // 3. Set the file on the hidden input inside the dialog
    const fileInput = dialog.locator('input[type="file"]');
    await fileInput.waitFor({ state: 'attached', timeout: 5_000 });
    await fileInput.setInputFiles(imagePath);
    await this.page.waitForTimeout(1_500); // allow Angular to process the file change

    // 3b. Fail loudly if the form REJECTED the image (wrong size/ratio/too big).
    // A valid upload auto-commits and closes the dialog; a rejected one keeps the
    // dialog open with an inline "Image resolution is invalid" message and leaves
    // the slot empty — which otherwise silently blocks "Preview & save". Each slot
    // has its own spec (cover 1080×1080/≤500KB, logo 240×180/≤80KB) — see PHOTOS.
    const rejection = dialog.locator('text=/invalid/i');
    if (await rejection.first().isVisible({ timeout: 500 }).catch(() => false)) {
      const msg = ((await dialog.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      throw new Error(`Image "${path.basename(imagePath)}" rejected by slot ${slotIndex}: ${msg}`);
    }

    // 4. Check for a confirm/save button inside the dialog (some dialogs show a preview)
    const saveBtn = dialog.locator('button').filter({ hasText: /save|ok|confirm|upload|done/i }).first();
    if (await saveBtn.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await saveBtn.click();
      await this.page.waitForTimeout(1_000);
    }

    // 5. If dialog still open, click the close icon (× in the header)
    const stillOpen = await dialog.isVisible({ timeout: 1_000 }).catch(() => false);
    if (stillOpen) {
      // The close icon is a mat-icon 'close' inside a <span> in the dialog header
      const closeIcon = dialog.locator('mat-icon:has-text("close")');
      if (await closeIcon.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await closeIcon.click();
      } else {
        await this.page.keyboard.press('Escape');
      }
      await this.page.waitForTimeout(600);
    }

    // 6. Wait for dialog to fully dismiss before proceeding
    await dialog.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
    await this.page.waitForTimeout(300);
  }

  // ── Fill mandatory fields ─────────────────────────────────────────────────

  /**
   * Fill every field required for a valid General Spend Cashback perk.
   * Call selectGeneralSpendCashbackType() first.
   *
   * @param {object} opts
   * @param {string} opts.titleEn   Perk title (English) — max 50 chars
   * @param {string} opts.titleAr   Perk title (Arabic)  — max 50 chars
   * @param {string} opts.descEn    Short description (English) — max 80 chars
   * @param {string} opts.descAr    Short description (Arabic)
   * @param {string} opts.cashback  Cashback percentage value, e.g. '5'
   * @param {string} opts.minTx     Minimum transaction amount, e.g. '1'
   */
  async fillMandatoryFields({
    titleEn       = 'B10-55168 UI Test',
    titleAr       = 'اختبار واجهة B10-55168',
    descEn        = 'Automated UI test — MID exclusion capacity B10-55168',
    descAr        = 'اختبار تلقائي — سعة استثناء التجار',
    cashback      = '5',
    minTx         = '1',
    cashbackType  = 'percentage',  // 'percentage' | 'fixed'
  } = {}) {
    // Titles
    await this.titleEnInput.fill(titleEn);
    await this.titleArInput.fill(titleAr);

    // Four image slots uploaded in order: Cover EN → Cover AR → Logo EN → Logo AR.
    // Each successful upload replaces the "Add Image" button with a thumbnail,
    // so the NEXT slot to upload is always nth(0) of the remaining buttons.
    await this.uploadImage(0, PHOTOS.coverEn);
    await this.uploadImage(0, PHOTOS.coverAr);
    await this.uploadImage(0, PHOTOS.logoEn);
    await this.uploadImage(0, PHOTOS.logoAr);

    // Cashback type radio, then fill the value (both inputs appear after any radio click)
    if (cashbackType === 'fixed') {
      await this.fixedAmountRadio.click();
    } else {
      await this.percentageRadio.click();
    }
    await this.cashbackValueInput.waitFor({ state: 'visible', timeout: 5_000 });
    await this.cashbackValueInput.fill(cashback);
    await this.minTransactionInput.fill(minTx);

    // Descriptions
    await this.descEnTextarea.fill(descEn);
    await this.descArTextarea.fill(descAr);
  }

  // ── Excluded merchants ────────────────────────────────────────────────────

  /**
   * Open the Excluded Merchants dropdown robustly and return the option locator.
   *
   * The combobox is a mat-select whose trigger toggles open/closed on each click,
   * so a naive "click + retry" can accidentally close an already-open panel.
   * Instead we read `aria-expanded` and only click when the panel is NOT open.
   * We also wait for any lingering overlay backdrop (from a just-closed dialog or
   * snackbar) to detach, and scroll the control into view, before interacting.
   */
  async openExcludedMerchantsDropdown() {
    // Make sure no leftover overlay backdrop is intercepting the click
    await this.page
      .locator('.cdk-overlay-backdrop')
      .waitFor({ state: 'detached', timeout: 4_000 })
      .catch(() => {});

    const combo = this.excludedMerchantsCombobox;
    await combo.scrollIntoViewIfNeeded().catch(() => {});

    // Ensure the panel is OPEN (toggle-safe: only click when not already expanded)
    for (let attempt = 0; attempt < 3; attempt++) {
      const expanded = await combo.getAttribute('aria-expanded').catch(() => null);
      if (expanded === 'true') break;
      await combo.click();
      await this.page.waitForTimeout(500);
    }

    // Confirm options actually rendered
    await this.page
      .locator('[role="listbox"] [role="option"]')
      .first()
      .waitFor({ state: 'visible', timeout: 8_000 });
    await this.page.waitForTimeout(200);
    return this.page.locator('[role="listbox"] [role="option"]');
  }

  /**
   * Toggle merchants by their display name (partial match, case-insensitive).
   * Clicking an unselected merchant selects it; clicking a selected one
   * deselects it (Angular Material multi-select toggle behaviour).
   * Keeps the dropdown open across all toggles.
   * @param {string[]} names  e.g. ['elaraby', 'Breadfast Coffee']
   */
  async selectMerchantsByName(names) {
    const options = await this.openExcludedMerchantsDropdown();

    for (const name of names) {
      const opt = options.filter({ hasText: name }).first();
      await opt.waitFor({ state: 'visible', timeout: 10_000 });
      await opt.click();
      await this.page.waitForTimeout(200);
    }

    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(500);
  }

  /**
   * Deselect merchants by display name and VERIFY the model actually updated.
   *
   * The mat-select multi-select commits its selection asynchronously; pressing
   * Escape immediately after a toggle click can race that commit, flipping the
   * checkbox visually while the underlying FormControl keeps the value (so the
   * submitted payload still contains the merchant). To prevent that desync we:
   *   1. Open the panel, click the option only if it is currently selected,
   *   2. Wait for the option's aria-selected to actually become "false",
   *   3. Retry up to 3× (re-opening the panel each attempt) before giving up.
   *
   * @param {string[]} names
   */
  async deselectMerchantsByName(names) {
    for (const name of names) {
      let done = false;
      for (let attempt = 0; attempt < 3 && !done; attempt++) {
        const options = await this.openExcludedMerchantsDropdown();
        const opt = options.filter({ hasText: name }).first();
        await opt.waitFor({ state: 'visible', timeout: 10_000 });

        if ((await opt.getAttribute('aria-selected')) === 'true') {
          await opt.click();
          // Poll until the model commits the deselection (aria-selected → false)
          for (let i = 0; i < 10; i++) {
            if ((await opt.getAttribute('aria-selected')) === 'false') break;
            await this.page.waitForTimeout(300);
          }
        }

        done = (await opt.getAttribute('aria-selected')) === 'false';
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(500);
      }

      if (!done) {
        throw new Error(`Failed to deselect merchant "${name}" — still selected after 3 attempts`);
      }
    }
  }

  /** Select the first `count` merchants. Returns actual count selected. */
  async selectMerchants(count) {
    const options  = await this.openExcludedMerchantsDropdown();
    const total    = await options.count();
    const toSelect = Math.min(count, total);
    for (let i = 0; i < toSelect; i++) {
      await options.nth(i).click();
      await this.page.waitForTimeout(100);
    }
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(500);
    return toSelect;
  }

  /** Select every available merchant. Returns count. */
  async selectAllMerchants() {
    const options = await this.openExcludedMerchantsDropdown();
    const total   = await options.count();
    for (let i = 0; i < total; i++) {
      await options.nth(i).click();
      await this.page.waitForTimeout(100);
    }
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(500);
    return total;
  }

  /** Count how many options currently have aria-selected="true". */
  async getSelectedMerchantsCount() {
    const options = await this.openExcludedMerchantsDropdown();
    await this.page.waitForTimeout(300);
    const all     = await options.all();
    let count     = 0;
    for (const opt of all) {
      if ((await opt.getAttribute('aria-selected')) === 'true') count++;
    }
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(400);
    return count;
  }

  /** True if the "(200 merchants max.)" capacity hint is present. */
  async hasMaxCapacityLabel() {
    return this.maxCapacityLabel.isVisible();
  }

  /**
   * Attempt to toggle ONE merchant by name with the dropdown open, and report the
   * real outcome. The 200-MID cap is enforced client-side: an option whose branch
   * MIDs would push the running total over 200 will NOT toggle on (aria-selected
   * stays "false") and a "Cannot select merchants with more than 200 merchants."
   * snackbar appears. Leaves the panel open for chained toggles.
   *
   * @param {string} name
   * @returns {Promise<{selected:boolean, capWarning:boolean}>}
   */
  async attemptToggleMerchant(name) {
    const options = await this.openExcludedMerchantsDropdown();
    const opt = options.filter({ hasText: name }).first();
    await opt.waitFor({ state: 'visible', timeout: 10_000 });
    await opt.scrollIntoViewIfNeeded().catch(() => {});
    await opt.click();
    await this.page.waitForTimeout(400);
    const selected   = (await opt.getAttribute('aria-selected')) === 'true';
    const capWarning = await this.capWarning.first().isVisible().catch(() => false);
    return { selected, capWarning };
  }

  /** True if the cap warning snackbar is currently visible. */
  async isCapWarningVisible() {
    return this.capWarning.first().isVisible().catch(() => false);
  }

  /** Read-only: is the named merchant currently selected? Closes the panel after. */
  async isMerchantSelected(name) {
    const options = await this.openExcludedMerchantsDropdown();
    const opt = options.filter({ hasText: name }).first();
    const sel = (await opt.getAttribute('aria-selected').catch(() => null)) === 'true';
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(300);
    return sel;
  }

  /**
   * Approx. sum of branch MIDs across selected options, parsed from each label's
   * "<n> branches" suffix. RELIABLE ONLY for merchants whose name has no trailing
   * digits (e.g. elaraby → "العربي190 branches" = 190). Merchants with numeric
   * names (e.g. test junk "asdf123") glue name-digits to the count and over-read —
   * do NOT use this for arbitrary/all-merchant selections; use isMerchantSelected
   * or getSelectedMerchantsCount instead. Closes the panel afterwards.
   * @returns {Promise<number>}
   */
  async getSelectedMidTotal() {
    const options = await this.openExcludedMerchantsDropdown();
    await this.page.waitForTimeout(200);
    const all = await options.all();
    let sum = 0;
    for (const o of all) {
      if ((await o.getAttribute('aria-selected')) === 'true') {
        const t = (await o.textContent().catch(() => '')) || '';
        const m = t.match(/(\d+)\s*branches/i);
        if (m) sum += parseInt(m[1], 10);
      }
    }
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(300);
    return sum;
  }

  // ── Form submission ───────────────────────────────────────────────────────

  /**
   * Core submit: click "Preview & Save", confirm the "Quick Preview" dialog, and
   * CAPTURE the POST /card/perks/create call — the HTTP status, the number of
   * excluded_merchants_ids actually sent in the payload, and the response body.
   *
   * This is the source of truth for whether the 200-MID cap accepted/rejected the
   * perk. URL navigation alone is NOT sufficient: the form can stay on /create for
   * unrelated reasons (missing field) and it can navigate away whenever the server
   * returns 2xx — so a test that asserts only the URL verifies nothing about the cap.
   *
   * @returns {Promise<{status:number|null, midCount:number|null, body:string, navigated:boolean}>}
   */
  async submitPerkAndCaptureCreate() {
    await this.page
      .locator('.cdk-overlay-backdrop')
      .waitFor({ state: 'detached', timeout: 4_000 })
      .catch(() => {});

    await this.previewAndSaveButton.click();

    // The "Quick Preview" dialog opens — scope to the visible one by its heading
    const dialog = this.page
      .locator('mat-dialog-container')
      .filter({ has: this.page.locator('text=Quick Preview') });
    await dialog.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {});

    // Arm the response wait BEFORE clicking save so the create call is never missed.
    const respPromise = this.page
      .waitForResponse(r => r.url().includes('/card/perks/create'), { timeout: 30_000 })
      .catch(() => null);

    if (await dialog.isVisible().catch(() => false)) {
      const saveBtn = dialog.getByRole('button', { name: /^\s*save\s*$/i });
      await saveBtn.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
      if (await saveBtn.isVisible().catch(() => false)) await saveBtn.click();
    }

    const resp = await respPromise;
    let status = null, midCount = null, body = '';
    if (resp) {
      status = resp.status();
      try {
        const sent = JSON.parse(resp.request().postData() || '{}');
        midCount = (sent?.perk_attributes?.excluded_merchants_ids || []).length;
      } catch { /* ignore */ }
      try { body = await resp.text(); } catch { /* ignore */ }
    }
    // brief settle so the SPA can navigate (2xx) or render the error (4xx)
    await this.page.waitForTimeout(1_500);

    const result = { status, midCount, body, navigated: /\/#\/perks$/.test(this.page.url()) };
    console.log(`[create] status=${status} midsSent=${midCount} navigated=${result.navigated}` +
                (status && status >= 400 ? ` body=${(body || '').slice(0, 200)}` : ''));
    return result;
  }

  /**
   * Submit and assert the perk was actually CREATED: the create API returned 200
   * AND the app navigated back to the perks list. Asserting the HTTP status (not
   * just the URL) is what makes a "success" test meaningful.
   * @returns the captured create result.
   */
  async submitPerkExpectSuccess() {
    const r = await this.submitPerkAndCaptureCreate();
    if (r.status !== null) {
      expect(
        r.status,
        `Create API should return 200 (sent ${r.midCount} excluded MIDs). Body: ${(r.body || '').slice(0, 300)}`
      ).toBe(200);
    }
    await this.page.waitForURL(/\/#\/perks$/, { timeout: 30_000 }).catch(() => {
      throw new Error(
        `Create returned status=${r.status} (sent ${r.midCount} MIDs) but did not navigate to /perks. ` +
        `url=${this.page.url()} body="${(r.body || '').slice(0, 200)}"`
      );
    });
    return r;
  }

  /**
   * Submit and expect the cap to REJECT the perk. Returns the real evidence so the
   * spec can assert the rejection was caused by the > 200-MID cap, not an unrelated
   * failure. Also dismisses the leftover Quick Preview dialog so the form stays
   * editable for a follow-up correction (recovery flow).
   *
   * @returns {Promise<{stayedOnCreate:boolean, status:number|null, midCount:number|null, body:string, errorText:string}>}
   */
  async submitPerkExpectFailure() {
    const r = await this.submitPerkAndCaptureCreate();

    // Dismiss the preview dialog if it is still open after rejection.
    const dialog = this.page.locator('mat-dialog-container');
    if (await dialog.isVisible({ timeout: 1_000 }).catch(() => false)) {
      const cancelBtn = dialog.locator('button').filter({ hasText: /cancel/i }).first();
      if (await cancelBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await cancelBtn.click();
      } else {
        await this.page.keyboard.press('Escape');
      }
      await dialog.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
    }
    await this.page
      .locator('.cdk-overlay-backdrop')
      .waitFor({ state: 'detached', timeout: 5_000 })
      .catch(() => {});

    const onScreen = (await this.page
      .locator('mat-error, .alert-danger, snack-bar-container, simple-snack-bar, ' +
               '.mat-mdc-snack-bar-label, .error-message')
      .first()
      .textContent()
      .catch(() => '')) || '';

    return {
      stayedOnCreate: this.page.url().includes('/perks/create'),
      status:   r.status,
      midCount: r.midCount,
      body:     r.body,
      errorText: (onScreen || r.body || '').trim(),
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  B10-55185 — perk types beyond General Spend Cashback
  //  Selectors for Merchant cashback are PORTED from the Java framework
  //  (modals/cardsAdminPanel/MerchantPerkCreatePage.java + PerksPage.java),
  //  which are aria-label / mat-option based.
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Open the type dropdown and pick a perk type by its visible label.
   * Works for 'General spend cashback', 'Merchant cashback', and — once their
   * exact labels are confirmed — 'Category cashback' / coupon types.
   * @param {string} label
   */
  async selectPerkTypeByName(label) {
    await this.perkTypeCombobox.click();
    const opt = this.page.getByRole('option', { name: label });
    await this.waitForVisible(opt);
    await opt.click();
    await this.page.waitForTimeout(800);
  }

  /** Add Perk → choose Merchant cashback. */
  async startMerchantCashbackPerk() {
    await this.clickAddPerk();
    await this.selectPerkTypeByName('Merchant cashback');
  }

  /**
   * Fill a Merchant cashback perk. Branch MIDs are the match keys the cron uses.
   * Ported selectors (Java): aria-label 'Merchant Name EN'|'Merchant Name AR',
   * button 'Add Merchant', button 'Add more', branch name aria-label 'e.g Cairo Festival',
   * MID aria-label 'e.g 1234'.
   *
   * CONFIRMED STALE (2026-07-16 live capture, B10-56750/B10-56729 gap-fill work):
   * the current web Create-Perk form does NOT have separate "Merchant Name EN"/
   * "Merchant Name AR" inputs, an "Add Merchant" button, or per-branch name/MID
   * text inputs — the live control is a single "Merchant name & ID" picker
   * (readonly input opening a nested two-level mat-menu: pick merchant, then
   * pick branch(es)). This method's ported-from-Java selectors do not match
   * that DOM and should NOT be used for the web panel. Use
   * selectMerchantForPerk(nameFragment) below instead, whose selectors ARE
   * live-verified against card-panel-testing. Left in place unmodified because
   * no current spec calls it and rewriting the cashback-value/limit portion is
   * out of scope for this pass — flagged here so nobody assumes it works.
   *
   * @param {object} o
   * @param {string} o.nameEn
   * @param {string} o.nameAr
   * @param {Array<{name:string, mid:string}>} o.branches  one entry per branch MID
   */
  async fillMerchantPerk({ nameEn = 'B10-55185 Merchant', nameAr = 'تاجر', branches = [] } = {}) {
    await this.page.locator("input[aria-label='Merchant Name EN']").fill(nameEn);
    await this.page.locator("input[aria-label='Merchant Name AR']").fill(nameAr);
    await this.page.locator("button:has-text('Add Merchant')").click();

    const branchInputs = this.page.locator("input[aria-label='e.g Cairo Festival']");
    const midInputs    = this.page.locator("input[aria-label='e.g 1234']");
    const addMore      = this.page.locator("button:has-text('Add more')");

    while ((await branchInputs.count()) < branches.length) {
      await addMore.click();
      await this.page.waitForTimeout(200);
    }
    for (let i = 0; i < branches.length; i++) {
      await branchInputs.nth(i).fill(branches[i].name || `Branch ${i + 1}`);
      await midInputs.nth(i).fill(String(branches[i].mid));
    }
    // NOTE: cashback value / limit fields for the merchant form still need a
    // live-DOM check — see setLimits() and the AUTOMATION doc, open dep #8.
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  B10-56729 — Create Perk form enhancements (new/renamed fields + sections)
  //  Selectors captured from the LIVE create-perk form 2026-07-14 (card-panel-testing):
  //    perk type          → mat-select[formcontrolname="type"]
  //                         options: General spend cashback | Category cashback |
  //                                  Merchant cashback | Discount/Coupon
  //    Section (AC6)       → mat-select[formcontrolname="section_id"]   (required)
  //    Perk title (AC3)    → app-bf-input[controlname="title_en"|"title_ar"] input (20-char cap)
  //    Perk subheader(AC7) → app-bf-input[controlname="subheader_en"|"subheader_ar"] input (30)
  //    Short usage (AC9)   → textarea[formcontrolname="usage_description_en"|"usage_description_ar"] (200)
  //    Branches (AC10)     → textarea[formcontrolname="branches_description_en"|"branches_description_ar"]
  //    Cashback proc (AC11)→ textarea[formcontrolname="cashback_processing_description_en"|"..._ar"] (45)
  //    Coupon code (AC16)  → app-bf-input[controlname="coupon_code"] input
  //    Coupon type (AC16)  → mat-radio-button[formcontrolname? -> group] "Online" | "Physical"
  //                          (appears only after a coupon code is entered)
  //    Funding (AC15)      → mat-select[formcontrolname="funding_types"]
  //    Section headers     → h4 text (sentence case, AC2/13/14/15)
  //  Image labels (AC8): "Cover photo EN/AR", "Logo EN/AR"; upload buttons: "Add image".
  // ════════════════════════════════════════════════════════════════════════════

  /** Required "Section" dropdown (AC6). Selects an option by visible text. */
  async selectSection(name) {
    const sel = this.page.locator('mat-select[formcontrolname="section_id"]');
    await sel.scrollIntoViewIfNeeded().catch(() => {});
    await sel.click();
    const opt = this.page.locator('mat-option', { hasText: name }).first();
    await this.waitForVisible(opt);
    await opt.click();
    await this.page.waitForTimeout(400);
  }

  /**
   * Open the Section dropdown and return the list of option labels (AC6).
   *
   * Uses allTextContents(), NOT allInnerTexts(). `innerText` returns only
   * RENDERED text, so once the section list grew past the panel's visible height
   * every option scrolled out of view came back as '' — the newly created
   * section (appended last) was silently reported as "not listed", failing
   * AC-12 and the P2 regression even though the option was present in the DOM.
   * Confirmed 2026-07-26: the same specs passed while the list was short and
   * began failing only as it grew. textContent ignores rendering, which is what
   * we want for an option-inventory read.
   */
  async getSectionOptions() {
    await this.page.locator('mat-select[formcontrolname="section_id"]').click();
    await this.page.locator('mat-option').first().waitFor({ state: 'visible', timeout: 8_000 });
    await this._loadAllSectionOptions();
    const opts = await this.page.locator('mat-option').allTextContents();
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(300);
    return opts.map((t) => t.trim()).filter(Boolean);
  }

  /**
   * Internal: exhaust the Section dropdown's LAZY LOADING before reading options.
   *
   * The panel loads sections in pages of 20 (`POST .../section/list` fires again
   * each time you scroll to the bottom: n=20, n=20, n=13 …). On first open only
   * 21 rows exist (20 + the pinned "+ Add section"). A newly created section is
   * appended LAST (id order), so with more than ~20 sections it is NOT in the
   * first page — reading options without scrolling reports it as "not listed"
   * and fails AC-12 / the P2 regression even though the product is correct.
   * Confirmed 2026-07-26: those specs passed while fewer than 20 sections
   * existed and started failing once the list grew past a page.
   *
   * Scrolls to the bottom until the option count stops growing.
   */
  async _loadAllSectionOptions(maxScrolls = 25) {
    let previous = -1;
    let quietRounds = 0;
    for (let i = 0; i < maxScrolls; i += 1) {
      // Scroll by asking Playwright to bring the LAST option into view, rather
      // than setting scrollTop on a panel we have to identify by class. Guessing
      // the panel selector proved unreliable (the option count stayed at the
      // first page of 21), whereas scrollIntoViewIfNeeded works whatever the
      // scroll container turns out to be.
      await this.page.locator('mat-option').last().scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => {});
      // Poll for the next page instead of sleeping a flat 900ms per scroll. With a
      // 50+ item list the flat sleep pushed getSectionOptions() to ~20s a call,
      // and a test that reads the dropdown for all four perk types then blew the
      // 120s test timeout. Break as soon as the count moves.
      const before = await this.page.locator('mat-option').count();
      let count = before;
      for (let poll = 0; poll < 10; poll += 1) {
        await this.page.waitForTimeout(120);
        count = await this.page.locator('mat-option').count();
        if (count !== before) break;
      }
      // A single no-growth round is NOT enough: the next page is often still in
      // flight. Require two consecutive quiet rounds before deciding the list is
      // fully loaded, otherwise the loop exits on the first slow fetch and the
      // tail of the list (where a newly created section lives) is never read.
      if (count === previous) {
        quietRounds += 1;
        if (quietRounds >= 2) break;
      } else {
        quietRounds = 0;
        previous = count;
      }
    }
  }

  /**
   * Select the FIRST real option in the required "Section (Mobile display)"
   * dropdown (AC6). Use when the specific section is irrelevant to the test —
   * we only need a valid selection so the form passes validation. Returns the
   * chosen label.
   */
  async selectFirstSection() {
    const sel = this.page.locator('mat-select[formcontrolname="section_id"]');
    await sel.scrollIntoViewIfNeeded().catch(() => {});
    await sel.click();
    const opt = this.page.locator('mat-option').first();
    await this.waitForVisible(opt);
    const label = ((await opt.innerText().catch(() => '')) || '').trim();
    await opt.click();
    await this.page.waitForTimeout(400);
    return label;
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  B10-56750 — "Add Section" inline-creation modal
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Open the Section dropdown and click its pinned "+ Add section" row
   * (AC-04), waiting for the "Add section" modal to render (AC-05).
   * force:true is required — see the constructor's dated comment block for
   * why (disabled mat-option ancestor wrapping the real button).
   */
  async openAddSectionModal() {
    await this.sectionDropdown.scrollIntoViewIfNeeded().catch(() => {});
    // The underlying mat-select panel stays OPEN behind the Add Section
    // dialog (they are two stacked cdk-overlays) — closing the dialog via
    // Cancel/submit does NOT close the select. A naive click() here would
    // therefore TOGGLE an already-open panel CLOSED on a second call in the
    // same test (confirmed live: this caused every re-open in a test with
    // 2+ Add-Section round trips to time out). Only click when not already
    // expanded, mirroring openExcludedMerchantsDropdown()'s toggle-safe check.
    for (let attempt = 0; attempt < 3; attempt++) {
      const expanded = await this.sectionDropdown.getAttribute('aria-expanded').catch(() => null);
      if (expanded === 'true') break;
      await this.sectionDropdown.click();
      await this.page.waitForTimeout(300);
    }
    await this.addSectionOptionButton.waitFor({ state: 'attached', timeout: 8_000 });
    await this.addSectionOptionButton.click({ force: true });
    await this.addSectionModal.waitFor({ state: 'visible', timeout: 8_000 });
    await this.page.waitForTimeout(300);
  }

  /**
   * Fill the Add Section modal's name fields (AC-05). Pass '' (empty string)
   * for a field to deliberately leave it blank for a required-field test;
   * omit a param entirely to leave the field untouched.
   * LIVE FINDING (2026-07-16): submitting with only EN filled shows
   * "This field is required." under the AR field — Section name Arabic IS
   * required in the live app, resolving the ambiguity flagged in
   * requirements-analysis.md Risk 2 ("AR requiredness ambiguity").
   */
  async fillAddSectionModal(nameEn, nameAr) {
    if (nameEn !== undefined) await this.addSectionNameEnInput.fill(nameEn);
    if (nameAr !== undefined) await this.addSectionNameArInput.fill(nameAr);
  }

  /**
   * Submit the Add Section modal. Arms the response listener BEFORE clicking
   * so a fast backend reply is never missed, and best-effort samples the
   * button's disabled/spinner state right after the click (AC-07). The
   * in-flight window can be well under 100ms on a fast backend, so a
   * `sawLoading:false` result is NOT proof AC-07 is broken by itself — it
   * only means the round trip was too fast for this poll to catch; treat it
   * as supporting evidence, not a standalone pass/fail.
   * @returns {Promise<{sawLoading:boolean, status:number|null, closed:boolean}>}
   */
  async submitAddSection() {
    // Endpoint confirmed live 2026-07-16 (network capture, card-panel-testing):
    //   POST /api/v1/web/card/perks/section/create  → 200
    // followed immediately by a POST .../section/list refetch (this is HOW
    // AC-12's "immediately available, no refresh" is implemented — a server
    // refetch after create, not a client-side cache append). Matching the
    // specific /section/create path (not a bare /section/i) avoids a race
    // where that follow-up list refetch — or an earlier list call from
    // opening the dropdown — could satisfy a looser matcher first.
    const respPromise = this.page
      .waitForResponse(
        (r) => /\/card\/perks\/section\/create/i.test(r.url()) && r.request().method() === 'POST',
        { timeout: 15_000 }
      )
      .catch(() => null);
    await this.addSectionSubmitButton.click();
    const sawLoading = await this.addSectionSubmitButton
      .evaluate((btn) =>
        btn.disabled ||
        btn.getAttribute('aria-disabled') === 'true' ||
        !!btn.querySelector('mat-spinner, .spinner, mat-progress-spinner')
      )
      .catch(() => false);
    const resp = await respPromise;
    // Wait for the dialog to actually finish closing rather than a fixed
    // sleep — a flat ~400ms proved unreliable once trace/video recording
    // overhead was added (confirmed by trial: same flow, slower run, false
    // negative on `closed`).
    await this.addSectionModal.waitFor({ state: 'hidden', timeout: 8_000 }).catch(() => {});
    const closed = !(await this.addSectionModal.isVisible().catch(() => false));

    // ORDER MATTERS — wait for the auto-selected value to COMMIT *before* closing
    // the stale mat-select panel.
    //
    // Bisected 2026-07-26 (B10-56750). `_closeStaleSectionPanel()` presses Escape,
    // and Escape on the still-open Section panel during the window in which the
    // app is writing the newly created Section into the control CANCELS that
    // pending selection: the control keeps `mat-select-empty` and the trigger
    // stays whitespace-only indefinitely (not a slow paint — it never arrives).
    // Evidence: 9/9 runs that submitted WITHOUT the Escape auto-selected fine;
    // every run that pressed Escape first left the control permanently empty,
    // while create still returned 200, the modal closed and the toast fired.
    // The `waitForResponse`/`evaluate` calls above were each cleared as suspects.
    //
    // So: poll for the value first (it lands ~300-500 ms after the dialog closes),
    // and only then tidy the panel.
    if (closed && resp && resp.status() === 200) {
      for (let i = 0; i < 24; i++) {
        const text = ((await this.sectionDropdown.textContent().catch(() => '')) || '').trim();
        if (text) break;
        await this.page.waitForTimeout(250);
      }
    }
    await this._closeStaleSectionPanel();
    return { sawLoading, status: resp ? resp.status() : null, closed };
  }

  /**
   * Internal: the Section mat-select panel stays OPEN behind the Add Section
   * dialog when the dialog is dismissed via Cancel (they are two stacked
   * cdk-overlays; only the dialog closes) — confirmed live. Any SHARED
   * method that assumes a closed starting point (getSectionOptions,
   * selectSection, selectFirstSection) would then toggle it CLOSED on its
   * own next click instead of opening it. Called after every Add Section
   * modal exit path so the section dropdown is left in a known-closed state
   * for whatever runs next.
   */
  async _closeStaleSectionPanel() {
    const expanded = await this.sectionDropdown.getAttribute('aria-expanded').catch(() => null);
    if (expanded === 'true') {
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(200);
    }
  }

  /** Cancel the Add Section modal (AC-06/AC-10) — discards without saving. */
  async cancelAddSectionModal() {
    await this.addSectionCancelButton.click();
    await this.addSectionModal.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
    await this._closeStaleSectionPanel();
  }

  /**
   * AC-10's second dismissal path ("the X icon"). LIVE FINDING (2026-07-16):
   * this modal has NO distinct X close icon in its title bar — the dialog
   * header is just `<h3>Add section</h3>` with no button (confirmed from the
   * live outerHTML); only "Add section"/"Cancel" exist. There is therefore no
   * separate X control to drive. This method documents that fact and falls
   * back to Escape (the only other non-Cancel dismissal available) so a
   * caller still gets a second path to exercise, while callers/specs must
   * report this as a live deviation from TC11, not silently treat Escape as
   * "the X icon".
   */
  async closeAddSectionModalViaX() {
    await this.page.keyboard.press('Escape');
    await this.addSectionModal.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
    await this._closeStaleSectionPanel();
  }

  /** Read the duplicate-name inline error text (AC-09). '' if not shown. */
  async getAddSectionErrorText() {
    if (!(await this.addSectionErrorText.first().isVisible({ timeout: 3_000 }).catch(() => false))) return '';
    return ((await this.addSectionErrorText.first().textContent().catch(() => '')) || '').trim();
  }

  /**
   * Read the FIELD-level validation messages (<mat-error>) — "This field is
   * required." and "Maximum length should be 50 characters." Returns one entry
   * per errored input (both fields error independently), [] if none.
   * Distinct from getAddSectionErrorText(), which reads the form-level
   * duplicate-name span — see the constructor note for why they are disjoint.
   * @returns {Promise<string[]>}
   */
  async getAddSectionFieldErrorTexts() {
    if (!(await this.addSectionFieldErrors.first().isVisible({ timeout: 3_000 }).catch(() => false))) return [];
    return (await this.addSectionFieldErrors.allInnerTexts().catch(() => []))
      .map((t) => t.trim())
      .filter(Boolean);
  }

  /**
   * Any Add-section error text, field-level or form-level, whichever is
   * present. Use when a test only needs "did validation fire and what did it
   * say" without caring which channel rendered it.
   * @returns {Promise<string>}
   */
  async getAnyAddSectionErrorText() {
    const field = await this.getAddSectionFieldErrorTexts();
    if (field.length) return field.join(' | ');
    return this.getAddSectionErrorText();
  }

  /**
   * AC-09 live finding: whether the EN name field is actually marked invalid
   * (aria-invalid/red state) when the duplicate error is shown. Confirmed
   * live that the field stays aria-invalid="false" — only the shared
   * text-danger message renders, no field highlight — which contradicts the
   * "Section-name field highlighted red" wording in the AC/CSV. Returns the
   * real state so a spec asserts actual behavior, not the assumed one.
   */
  async isAddSectionNameFieldMarkedInvalid() {
    const invalid = await this.addSectionNameEnInput.getAttribute('aria-invalid').catch(() => null);
    return invalid === 'true';
  }

  /** True once the Add Section modal is visible. */
  async isAddSectionModalVisible() {
    return this.addSectionModal.isVisible({ timeout: 3_000 }).catch(() => false);
  }

  /** The modal's dialog title text (AC-05). Live text is "Add section"
   *  (sentence case) — the CSV/AC text says "Add Section"; see README. */
  async getAddSectionModalTitle() {
    return (
      (await this.addSectionModal
        .locator('h3.mat-dialog-title, [mat-dialog-title]')
        .first()
        .textContent()
        .catch(() => '')) || ''
    ).trim();
  }

  /**
   * Best-effort: the post-success toast text (AC-08). Returns '' if not
   * observed — toasts can auto-dismiss faster than this poll, especially
   * under CI load, so an empty result is not proof the toast never rendered.
   */
  async getSectionCreatedToastText() {
    const toast = this.page
      .locator('snack-bar-container, simple-snack-bar, .mat-mdc-snack-bar-label, .alert, .toast, [class*="toast"]')
      .filter({ hasText: /section created/i });
    if (!(await toast.first().isVisible({ timeout: 4_000 }).catch(() => false))) return '';
    return ((await toast.first().textContent().catch(() => '')) || '').trim();
  }

  /**
   * Fill EVERY field the create form marks required for a General spend cashback
   * perk, so that "Preview & save" actually opens the Quick Preview dialog (and,
   * when opted-in, the create API accepts the perk).
   *
   * WHY: the Preview button is a no-op while the form is invalid. Beyond the
   * B10-56729 new fields (title/subheader/usage), the form still requires the
   * Section (AC6), both Cover photos + both Logos, the cashback Type + value,
   * and the EN/AR "Short perk description". Any preview/submit spec MUST call
   * this first — filling only the new content fields leaves the form invalid.
   *
   * Composes the existing reusable pieces (uploadImage, cashback radios,
   * description textareas) with the new B10-56729 required fields.
   */
  async fillGeneralCashbackMandatory({
    titleEn      = 'Preview EN',
    titleAr      = 'معاينة',
    subEn        = 'Subheader',
    subAr        = 'عنوان فرعي',
    usageEn      = 'Used once, cashback capped at 200 EGP.',
    usageAr      = 'يستخدم مرة واحدة.',
    descEn       = 'Get cashback on your spend, capped at 200 EGP.',
    descAr       = 'احصل على استرداد نقدي على مشترياتك.',
    cashback     = '5',
    minTx        = '1',
    cashbackType = 'percentage',
    skipSection  = false, // B10-56750: set true to deliberately leave Section
                          // unselected (AC-02 required-field validation tests)
  } = {}) {
    await this.fillTitles(titleEn, titleAr);
    if (!skipSection) await this.selectFirstSection();                  // AC6 (required)
    if (await this.isSubheaderVisible()) await this.fillSubheaders(subEn, subAr); // AC7

    // Required images, in form order: Cover EN → Cover AR → Logo EN → Logo AR.
    // Each slot enforces its own size/ratio (see PHOTOS): cover = 1080×1080,
    // logo = 240×180. Each successful upload replaces its "Add image" button
    // with a thumbnail, so the next slot to fill is always nth(0) of the rest.
    await this.uploadImage(0, PHOTOS.coverSpec); // Cover photo EN
    await this.uploadImage(0, PHOTOS.coverSpec); // Cover photo AR
    await this.uploadImage(0, PHOTOS.logoSpec);  // Logo EN
    await this.uploadImage(0, PHOTOS.logoSpec);  // Logo AR

    // Cashback Type + value (both inputs render only after a radio is clicked).
    if (cashbackType === 'fixed') await this.fixedAmountRadio.click();
    else await this.percentageRadio.click();
    await this.cashbackValueInput.waitFor({ state: 'visible', timeout: 5_000 });
    await this.cashbackValueInput.fill(cashback);
    await this.minTransactionInput.fill(minTx);

    // Required short perk description EN/AR (≤ 80 chars).
    await this.descEnTextarea.fill(descEn);
    await this.descArTextarea.fill(descAr);

    // Usage section — "Short usage description" EN/AR (AC9, required).
    await this.fillUsage(usageEn, usageAr);
  }

  /** Fill the Perk title EN/AR (AC3: 20-char cap on both). */
  async fillTitles(titleEn, titleAr) {
    await this.page.locator('app-bf-input[controlname="title_en"] input').fill(titleEn);
    await this.page.locator('app-bf-input[controlname="title_ar"] input').fill(titleAr);
  }

  /**
   * Type `text` into a controlname field and return the value the field actually
   * accepted — used to assert character caps (AC3 title=20, AC7 subheader=30).
   * @param {string} controlname e.g. 'title_en'
   */
  async typeAndReadAccepted(controlname, text) {
    const inp = this.page.locator(`app-bf-input[controlname="${controlname}"] input`);
    await inp.fill('');
    await inp.type(text, { delay: 5 });
    return (await inp.inputValue()) || '';
  }

  /**
   * AC3/AC7/AC9/AC11 — the capped fields enforce their limit via an inline
   * validation error ("Maximum length should be N characters.") + invalid state,
   * NOT by truncating input (verified live 2026-07-14). Type `max + overBy` chars,
   * blur to touch the control, and return whether the correct per-field error
   * shows. The `\bN\b` match disambiguates e.g. 20 from 200.
   *
   * @param {'input'|'textarea'} kind
   * @param {string} controlname  e.g. 'title_en', 'usage_description_en'
   * @param {number} max          the field's documented maximum (20/30/200/45)
   * @param {number} [overBy=5]   how many chars past `max` to type
   * @returns {Promise<{errorShown:boolean, errorText:string, accepted:number, max:number}>}
   */
  async checkMaxLengthValidation(kind, controlname, max, overBy = 5) {
    const inp = kind === 'input'
      ? this.page.locator(`app-bf-input[controlname="${controlname}"] input`)
      : this.page.locator(`textarea[formcontrolname="${controlname}"]`);
    await inp.scrollIntoViewIfNeeded().catch(() => {});
    await inp.click();
    await inp.fill('');
    await inp.type('X'.repeat(max + overBy), { delay: 2 });
    await inp.blur().catch(() => {});           // touch the control so validation renders
    await this.page.waitForTimeout(500);
    const accepted = ((await inp.inputValue().catch(() => '')) || '').length;
    const err = this.page.locator(`text=/maximum length should be\\s*${max}\\b/i`);
    const errorShown = await err.first().isVisible({ timeout: 2_000 }).catch(() => false);
    const errorText  = errorShown ? (((await err.first().textContent().catch(() => '')) || '').trim()) : '';
    return { errorShown, errorText, accepted, max };
  }

  /** Perk subheader EN/AR (AC7). Present by default for General cashback; for
   *  merchant/coupon perks only when "Breadfast" is the merchant. */
  async fillSubheaders(en, ar) {
    await this.page.locator('app-bf-input[controlname="subheader_en"] input').fill(en);
    await this.page.locator('app-bf-input[controlname="subheader_ar"] input').fill(ar);
  }

  /** True if the Perk subheader fields are rendered (AC7 conditional visibility). */
  async isSubheaderVisible() {
    return this.page.locator('app-bf-input[controlname="subheader_en"] input').isVisible().catch(() => false);
  }

  /** Short usage description EN/AR — required Usage section (AC9, 200 chars). */
  async fillUsage(en, ar) {
    await this.page.locator('textarea[formcontrolname="usage_description_en"]').fill(en);
    await this.page.locator('textarea[formcontrolname="usage_description_ar"]').fill(ar);
  }

  /** List of valid branches EN/AR — optional Branches section (AC10). */
  async fillBranches(en, ar) {
    await this.page.locator('textarea[formcontrolname="branches_description_en"]').fill(en);
    await this.page.locator('textarea[formcontrolname="branches_description_ar"]').fill(ar);
  }

  /** Short cashback description EN/AR — optional Cashback processing section (AC11, 45 chars). */
  async fillCashbackProcessing(en, ar) {
    await this.page.locator('textarea[formcontrolname="cashback_processing_description_en"]').fill(en);
    await this.page.locator('textarea[formcontrolname="cashback_processing_description_ar"]').fill(ar);
  }

  /** Enter a coupon code (AC16 trigger for the Coupon type selector). */
  async fillCouponCode(code) {
    await this.page.locator('app-bf-input[controlname="coupon_code"] input').fill(code);
    await this.page.waitForTimeout(500); // let the Coupon type selector render
  }

  /** True once the Coupon type (Online/Physical) selector is shown (AC16). */
  async isCouponTypeVisible() {
    return this.page.locator('text=Coupon type').first().isVisible({ timeout: 3_000 }).catch(() => false);
  }

  /** Choose the Coupon type (AC16). @param {'Online'|'Physical'} option */
  async selectCouponType(option) {
    const radio = this.page.locator('mat-radio-button', { hasText: option }).first();
    await this.waitForVisible(radio);
    await radio.click();
    await this.page.waitForTimeout(200);
  }

  /**
   * Return the ordered list of section headers rendered on the form (AC17).
   * e.g. ['Basic details','Value','Usage','Branches','Cashback processing',
   *       'Duration','Cashback limit','Exclusions','Funding'] (subset per perk type).
   */
  async getSectionOrder() {
    // Section headers are NOT all the same tag: "Basic details" renders at a
    // different heading level than the rest (Value/Usage/… are h4), so an
    // h4-only scan silently dropped "Basic details" from the order (AC17).
    // Scan all heading levels in DOM order; callers filter to the known section
    // vocabulary, so unrelated headings (e.g. the "Create perk" page title) are
    // discarded while the true section sequence is preserved.
    const texts = await this.page.locator('h1, h2, h3, h4, h5, h6').allInnerTexts();
    return texts.map((t) => t.trim().replace(/\s*\*$/, '')).filter(Boolean);
  }

  /** True if a section header with the given (sentence-case) text is present (AC2/13/14/15).
   *  Tolerant of heading level (h1..h6) and a trailing "*" required-marker. */
  async hasSectionHeader(text) {
    const re = new RegExp(`^\\s*${text}\\s*\\*?\\s*$`, 'i');
    if (await this.page.getByRole('heading', { name: re }).first().isVisible({ timeout: 2000 }).catch(() => false)) {
      return true;
    }
    return this.page
      .locator('h1,h2,h3,h4,h5,h6,.section-title,.card-title,mat-card-title,legend')
      .filter({ hasText: re })
      .first()
      .isVisible({ timeout: 1500 })
      .catch(() => false);
  }

  /** Choose a Funding type (AC15). */
  async selectFundingType(name) {
    const sel = this.page.locator('mat-select[formcontrolname="funding_types"]');
    await sel.scrollIntoViewIfNeeded().catch(() => {});
    await sel.click();
    const opt = this.page.locator('mat-option', { hasText: name }).first();
    await this.waitForVisible(opt);
    await opt.click();
    await this.page.waitForTimeout(300);
  }

  /**
   * Discount/Coupon perk (AC16): title + coupon code (+ optional coupon type).
   * Implemented from live selectors (2026-07-14); replaces the former stub.
   */
  async fillCouponPerk({ titleEn = 'B10-56729 Coupon', titleAr = 'كوبون', couponCode = 'SAVE20', couponType = 'Online' } = {}) {
    await this.fillTitles(titleEn, titleAr);
    await this.fillCouponCode(couponCode);
    if (couponType && (await this.isCouponTypeVisible())) await this.selectCouponType(couponType);
  }

  /**
   * AC5 — attempt an image upload EXPECTING the form to reject it (wrong
   * dimensions / aspect-ratio / size) and RETURN the outcome instead of throwing
   * (the happy-path uploadImage() throws on rejection; a negative test needs the
   * message).
   *
   * LIVE FINDING (2026-07-20, investigated after a reported flaky/failing run):
   * the ORIGINAL version of this method detected "rejected" by matching an inline
   * dialog text against /invalid|aspect ratio|max size|resolution|too large|\bKB\b/i.
   * That regex was NOT distinguishing a real rejection message — it was matching the
   * upload dialog's PERMANENT drop-zone copy ("Specs: 1080*1080 px / Max size: 500 KB,
   * 1:1 aspect ratio"), which is present before any file is even chosen. Confirmed live
   * by polling the DIALOG's full innerHTML for 6+ seconds after uploading a wrong-spec
   * image: no error text appears inside it, and it simply stays in its pristine
   * "Drop files here to upload" state. A conforming image, by contrast, auto-closes the
   * dialog within ~300ms. So the old check only ever "worked" because the always-present
   * static copy happened to satisfy the regex while the dialog was open — it could not
   * tell "rejected" apart from "not yet processed" or any other stuck state, making it a
   * latent flaky/false-signal risk.
   *
   * CORRECTION (2026-07-28, probe_image_spec.js): the earlier conclusion that the panel
   * gives NO feedback at all — recorded here and elsewhere as "DEF-4, silent rejection" —
   * was WRONG, and no such defect was ever filed. It came from scoping the search to
   * mat-dialog-container. The panel DOES toast, immediately:
   *     "Image resolution is invalid. Should be (1080 x 1080)"
   * but Material renders a snack-bar in .cdk-overlay-container as a SIBLING of the dialog,
   * so a dialog-scoped read can never see it. Anything checking for upload feedback must
   * search the DOCUMENT, not the dialog. The behavioural signal below is still the more
   * reliable one and is kept as the primary check.
   *
   * The RELIABLE signal is behavioral, not textual: an accepted image closes the
   * dialog (or shows a thumbnail/confirm step) promptly; a rejected one leaves the
   * drop-zone prompt ("Drop files here to upload" / "Upload Document" button)
   * untouched. This polls for either outcome up to a bounded timeout instead of
   * guessing with a fixed sleep + text match.
   *
   * @param {0|1|2|3} slotIndex  0=Cover EN, 1=Cover AR, 2=Logo EN, 3=Logo AR
   * @param {string}  imagePath  wrong-spec image to try
   * @param {number}  [timeoutMs=6000] how long to wait for an "accepted" signal before concluding rejection
   * @returns {Promise<{rejected:boolean, message:string}>}
   */
  async attemptImageUploadExpectRejection(slotIndex, imagePath, timeoutMs = 6_000) {
    await this.addImageButtons.nth(slotIndex).click();
    const dialog = this.page.locator('mat-dialog-container');
    await dialog.waitFor({ state: 'visible', timeout: 8_000 });
    await this.page.waitForTimeout(400);

    const fileInput = dialog.locator('input[type="file"]');
    await fileInput.waitFor({ state: 'attached', timeout: 5_000 });
    await fileInput.setInputFiles(imagePath);

    // Accepted-signal locators: a thumbnail/preview image, or a save/confirm button
    // replacing the plain drop-zone (per uploadImage()'s documented dialog flow).
    const acceptedIndicator = dialog.locator(
      'img, button:has-text("Save"), button:has-text("Ok"), button:has-text("Confirm"), button:has-text("Done")'
    );
    const dropZonePrompt = dialog.locator('text=Drop files here to upload');

    const pollIntervalMs = 250;
    const deadline = Date.now() + timeoutMs;
    let accepted = false;
    while (Date.now() < deadline) {
      const stillOpen = await dialog.isVisible().catch(() => false);
      if (!stillOpen) { accepted = true; break; } // dialog closed → upload committed
      if (await acceptedIndicator.first().isVisible({ timeout: 200 }).catch(() => false)) {
        accepted = true;
        break;
      }
      await this.page.waitForTimeout(pollIntervalMs);
    }

    const rejected = !accepted;
    let message;
    if (rejected) {
      // Confirm the drop-zone is still showing its untouched initial prompt (the "nothing was
      // committed" signal), and report the rejection toast alongside it. The toast is read from the
      // DOCUMENT, not the dialog: Material renders it in .cdk-overlay-container as a sibling, so a
      // dialog-scoped read misses it and makes a well-behaved panel look silent.
      const stillPristine = await dropZonePrompt.first().isVisible({ timeout: 1_000 }).catch(() => false);
      const toast = (await this.getUploadFeedbackToasts()).join(' | ');
      message = stillPristine
        ? `rejected — dialog stayed open on the untouched "Drop files here to upload" prompt.`
          + ` Feedback shown: ${toast || '(none seen — check whether the toast had already auto-dismissed)'}`
        : 'dialog remained open but the drop-zone prompt changed to an unrecognized state — inspect manually';
    } else {
      message = 'upload was accepted (dialog closed or a thumbnail/confirm control appeared)';
    }

    // Dismiss the dialog so the form remains editable for follow-up steps.
    if (await dialog.isVisible().catch(() => false)) {
      const closeIcon = dialog.locator('mat-icon:has-text("close")');
      if (await closeIcon.isVisible({ timeout: 800 }).catch(() => false)) await closeIcon.click();
      else await this.page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
      await this.page.waitForTimeout(300);
    }

    return { rejected, message };
  }

  /**
   * AC4 — the sidebar "Perks" navigation entry and whether it carries an icon
   * element. The SPECIFIC new icon glyph cannot be asserted from code (no Figma
   * sidebar frame was provided — see figma-analysis.md "No sidebar/global
   * navigation frame ... to verify AC4"); this confirms the nav item exists and
   * renders an icon, and a screenshot is captured alongside for manual glyph
   * comparison. @returns {Promise<{present:boolean, hasIcon:boolean}>}
   */
  async getPerksSidebarNav() {
    const item = this.page
      .locator('a[href*="perks"], nav a:has-text("perks"), .menu-item:has-text("perks")')
      .first();
    const present = await item.isVisible({ timeout: 5_000 }).catch(() => false);
    let hasIcon = false;
    if (present) {
      hasIcon = await item
        .locator('svg, mat-icon, i, img, [class*="icon"]')
        .first()
        .isVisible({ timeout: 1_500 })
        .catch(() => false);
    }
    return { present, hasIcon };
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  B10-56729 gap-fill (TC22/23/24) — Merchant & Category pickers.
  //  Selectors captured LIVE 2026-07-16 (card-panel-testing) by driving the
  //  real browser (Playwright MCP), resolving the open deps this section used
  //  to cite (reusable-components.md "Known gaps" #1/#3).
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Merchant cashback (AC7/TC22/TC24): open the "Merchant name & ID" picker
   * and choose a merchant by its visible "Name - Arabic" label (partial
   * match), then select ALL of its branches. Returns the resulting trigger
   * text, e.g. "elaraby - All branches selected".
   *
   * Interaction notes (confirmed by live trial, not assumed):
   *   - The field is a READ-ONLY matInput that opens a NESTED two-level
   *     mat-menu on click: level 1 lists merchants (role=menuitem); clicking
   *     one opens level 2, a per-merchant branch checklist with a
   *     "Select All" mat-checkbox plus individual branch/MID checkboxes.
   *   - The "Select All" checkbox MUST be clicked via its <label> (a real
   *     Playwright .click() on the checkbox/label target). A raw DOM
   *     .click() on the wrapping <button mat-menu-item> does NOT toggle the
   *     checkbox — confirmed by trial: that left aria-checked="false" and
   *     the trigger blank, while clicking the label set aria-checked="true"
   *     and populated the trigger correctly.
   *   - Escape commits the selection and closes both menu levels.
   *
   * @param {string} nameFragment  e.g. 'elaraby' (non-Breadfast) or 'Breadfast App' (Breadfast)
   * @returns {Promise<string>} the picker's resulting trigger text
   */
  async selectMerchantForPerk(nameFragment) {
    await this.merchantPickerInput.click();
    const merchantItem = this.page
      .locator('.cdk-overlay-pane [role="menuitem"]')
      .filter({ hasText: nameFragment })
      .first();
    await this.waitForVisible(merchantItem);
    await merchantItem.click();

    // Level 2: per-merchant branch checklist — tick "Select All" via its
    // <label> (see the method-level note above for why a plain click fails).
    const selectAllLabel = this.page
      .locator('.cdk-overlay-pane [role="menuitem"]')
      .filter({ hasText: /^\s*select all/i })
      .locator('label')
      .first();
    await this.waitForVisible(selectAllLabel);
    await selectAllLabel.click();

    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(400);
    return (await this.merchantPickerInput.inputValue().catch(() => '')) || '';
  }

  /**
   * Category cashback (AC7/TC23): select a category by its visible
   * "name - arabic" label (partial match) in the "Category name & code
   * (MCC)" dropdown — a plain mat-select[formcontrolname="category_code"]
   * with mat-option entries "name - arabic ID code" (plus a pinned
   * "+ Add category" row, the pre-existing Category modal — out of scope
   * for B10-56750/B10-56729, not automated here).
   * @param {string} nameFragment  e.g. 'fitness', 'food'
   */
  async selectCategoryForPerk(nameFragment) {
    const sel = this.page.locator('mat-select[formcontrolname="category_code"]');
    await sel.scrollIntoViewIfNeeded().catch(() => {});
    await sel.click();
    const opt = this.page.locator('mat-option').filter({ hasText: nameFragment }).first();
    await this.waitForVisible(opt);
    await opt.click();
    await this.page.waitForTimeout(300);
  }

  /**
   * Category cashback perk: keyed on MCC / category selection (AC7/TC23).
   * Was a stub that threw ("category-perk MCC/category picker selectors not
   * yet captured") — implemented 2026-07-16 using selectCategoryForPerk()
   * above, whose selectors were captured live against card-panel-testing.
   * @param {{titleEn?:string, titleAr?:string, category?:string}} o
   */
  async fillCategoryPerk({ titleEn = 'B10-56729 Category', titleAr = 'فئة', category = 'fitness' } = {}) {
    await this.fillTitles(titleEn, titleAr);
    await this.selectCategoryForPerk(category);
  }

  /**
   * Set perk limits + cap. Selectors unconfirmed — likely formcontrolname-based,
   * e.g. input[formcontrolname="daily_limit"] etc. Confirm against live DOM.
   * @param {{daily?:number, weekly?:number, monthly?:number, annual?:number, maxCashback?:number}} _limits
   */
  async setLimits(_limits = {}) {
    throw new Error(
      'setLimits: daily/weekly/monthly/annual/max-cap field selectors not yet confirmed — open dep #8.'
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  B10-56757 — Perks TABLE (#/perks list): Type/Category filters, Type/Category
  //  columns, category-scoped drag-reorder ("sorting"), row Actions (View/Delete),
  //  delete confirmation, empty state, and batched "Save order".
  //
  //  SELECTOR PROVENANCE (read before editing):
  //    Grounded in (a) the exported Figma frames for this story
  //    (figma-analysis/*.png — table columns Logo/ID/Category/Type/Title/
  //    Description/Status/Actions; a pink "Search" apply-filters button; a
  //    magenta "Save order" button; 6-dot drag handles in a category view; a
  //    "•••" row Actions popover with View + Delete; the delete modal
  //    "Are you sure you want to delete this perk?" / "Delete perk" / "Cancel";
  //    the "No results found" and "There are no perks added yet" empty states),
  //    and (b) the portal's PROVEN Angular Material conventions already used
  //    above (mat-select / mat-option, mat-dialog-container, role/text hooks).
  //
  //    Live #/perks DOM capture was BLOCKED on 2026-07-14: the backend returned
  //    502 Bad Gateway on POST /api/v1/web/card/perks/list and
  //    /api/v1/web/card/perks/section/list, so the table never rendered (same
  //    env outage as screenshots/exploratory_10/11). Locators here are tolerant
  //    (role/text + structural fallbacks via .or()) and MUST be re-confirmed
  //    against the live table once the backend recovers.
  //
  //  DESIGN NOTE (AC-03/04 "sorting"): the Figma design implements category-
  //  scoped SORTING as drag-and-drop ROW reordering (6-dot handles), not
  //  column-header sort arrows (figma-analysis "Gaps vs spec"). The methods
  //  below detect the drag-reorder affordance as the "sorting available" signal.
  //
  //  API endpoints (from ApiHelper + live network):
  //    list   → POST /api/v1/web/card/perks/list
  //    delete → matched by DELETE method on a /card/perks/… URL
  //    order  → matched by PUT|PATCH|POST on a /card/perks/… URL containing
  //             order|rank|sort|reorder|arrange (exact path to confirm live).
  // ════════════════════════════════════════════════════════════════════════════

  /** Navigate to the perks table and wait for either rows, an empty state, or
   *  the loading spinner to settle. Returns true if the table body resolved. */
  async goToPerksTable() {
    await this.goToUrl('/#/perks');
    return this.waitForTableSettled();
  }

  /**
   * Wait until the table has data rows OR an empty state is shown. Returns
   * {ready, rowCount, empty}. Does NOT throw on a stuck/failed load (the
   * backend can 502 — see the provenance block) so callers can skip cleanly.
   */
  async waitForTableSettled(timeout = 20_000) {
    await this.page
      .locator('table tbody tr, mat-row, [role="row"], text=/no results found|there are no perks added yet/i')
      .first()
      .waitFor({ state: 'visible', timeout })
      .catch(() => {});
    const rowCount = await this._rows().count().catch(() => 0);
    const empty    = await this.emptyState.isVisible().catch(() => false);
    return { ready: rowCount > 0 || empty, rowCount, empty };
  }

  /** Internal: the table's data rows (excludes the header row). */
  _rows() {
    return this.page
      .locator('table tbody tr, mat-table mat-row, [role="row"]')
      .filter({ has: this.page.locator('td, mat-cell, [role="cell"]') });
  }

  /** Internal: the mat-select for a labelled filter (Type / Category / Status). */
  _filterSelect(label) {
    return this.page
      .locator('mat-form-field', { hasText: new RegExp(label, 'i') })
      .locator('mat-select')
      .first()
      .or(this.page.getByRole('combobox', { name: new RegExp(label, 'i') }));
  }

  /** Internal: open a labelled filter dropdown and return its option locator. */
  async _openFilter(label) {
    const sel = this._filterSelect(label);
    await sel.scrollIntoViewIfNeeded().catch(() => {});
    await sel.click();
    const opts = this.page.locator('mat-option, [role="option"]');
    await opts.first().waitFor({ state: 'visible', timeout: 8_000 });
    return opts;
  }

  // ── AC-01: Type & Category filters ──────────────────────────────────────────

  /** Open the Type filter and return its option labels (AC-01). */
  async getTypeFilterOptions() {
    const opts  = await this._openFilter('Type');
    const texts = (await opts.allInnerTexts()).map((t) => t.trim()).filter(Boolean);
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(200);
    return texts;
  }

  /** Select a Type filter option by visible text (AC-01). */
  async selectTypeFilter(type) {
    const opts = await this._openFilter('Type');
    await opts.filter({ hasText: new RegExp(type, 'i') }).first().click();
    await this.page.waitForTimeout(200);
  }

  /** Open the Category filter and return its option labels (AC-01). */
  async getCategoryFilterOptions() {
    const opts  = await this._openFilter('Category');
    const texts = (await opts.allInnerTexts()).map((t) => t.trim()).filter(Boolean);
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(200);
    return texts;
  }

  /** Select a Category filter option by visible text (AC-01). Returns the label. */
  async selectCategoryFilter(category) {
    const opts = await this._openFilter('Category');
    const opt  = category
      ? opts.filter({ hasText: new RegExp(category, 'i') }).first()
      : opts.first();
    const label = ((await opt.innerText().catch(() => '')) || '').trim();
    await opt.click();
    await this.page.waitForTimeout(200);
    return label;
  }

  /** Select a Status filter option by visible text (existing filter, AC-01 combo). */
  async selectStatusFilter(status) {
    const opts = await this._openFilter('Status');
    await opts.filter({ hasText: new RegExp(status, 'i') }).first().click();
    await this.page.waitForTimeout(200);
  }

  /** Read the Category filter's current selected value (AC-05 auto-filter check). */
  async getActiveCategoryFilterValue() {
    return ((await this._filterSelect('Category').innerText().catch(() => '')) || '').trim();
  }

  /** Click the pink "Search" button to apply the selected filters (AC-01). */
  async applyFilters() {
    await this.searchFilterButton.click();
    await this.waitForTableSettled();
  }

  /** Clear all applied filters (empty-state subtext: "Clear filters ..."). */
  async clearFilters() {
    const clearBtn = this.page.locator('button', { hasText: /clear (filters|all)?/i }).first();
    if (await clearBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await clearBtn.click();
      await this.waitForTableSettled();
    }
  }

  // ── AC-02: Type & Category columns ────────────────────────────────────────────

  /** Ordered list of table column-header labels (AC-02, AC-06). */
  async getTableColumnHeaders() {
    return (await this.tableHeaderCells.allInnerTexts()).map((t) => t.trim()).filter(Boolean);
  }

  /** Number of data rows currently rendered. */
  async getRowCount() {
    return this._rows().count();
  }

  /**
   * Read every data-row cell under the column whose header matches `headerName`
   * (AC-02 per-row Type/Category values; also reused as readColumnOrder). Returns
   * [] when the column is absent.
   *
   * The index MUST come from the raw header list, not getTableColumnHeaders(), which drops
   * blank labels: the perks table opens with TWO unlabelled columns (drag handle + perk logo),
   * so a filtered index is 2 short and silently reads the wrong column — "Title" returned the
   * Category values on every row (live 2026-07-27, B10-57393, a false test failure on a perk
   * that had in fact been created).
   */
  async getColumnValues(headerName) {
    const headers = (await this.tableHeaderCells.allInnerTexts()).map((t) => t.trim());
    const idx = headers.findIndex((h) => new RegExp(headerName, 'i').test(h));
    if (idx < 0) return [];
    const rows = this._rows();
    const n = await rows.count();
    const out = [];
    for (let i = 0; i < n; i++) {
      const cells = rows.nth(i).locator('td, mat-cell, [role="cell"]');
      out.push((((await cells.nth(idx).innerText().catch(() => '')) || '')).trim());
    }
    return out;
  }

  /** Alias for getColumnValues — the ordered values of a column (AC-04 sort check). */
  async readColumnOrder(col) {
    return this.getColumnValues(col);
  }

  // ── AC-03/04: category-scoped sorting (realized as drag-reorder) ──────────────

  /**
   * True when the category-scoped reorder/sort affordance is present. Per the
   * design this is the row drag-handle (shown only in a category view); a
   * column-header sort control is also accepted as a fallback signal.
   */
  async isSortingAvailable() {
    const handles = await this.dragHandles.count().catch(() => 0);
    const sortHeaders = await this.page
      .locator('[mat-sort-header], th.mat-sort-header, [aria-sort]')
      .count()
      .catch(() => 0);
    return handles > 0 || sortHeaders > 0;
  }

  /** Labels of any column-header sort controls (empty when sorting is drag-only). */
  async getSortableColumns() {
    const cols = this.page.locator('[mat-sort-header], th.mat-sort-header, [aria-sort]');
    return (await cols.allInnerTexts().catch(() => [])).map((t) => t.trim()).filter(Boolean);
  }

  /** Click a column header to toggle a column sort (AC-04, when column sort exists). */
  async clickSortColumn(col) {
    await this.tableHeaderCells.filter({ hasText: new RegExp(col, 'i') }).first().click();
    await this.page.waitForTimeout(600);
  }

  /**
   * Drag a row from one index to another using its drag handle (AC-11 reorder).
   * Falls back to dragging the whole row when no handle is present.
   */
  async reorderRow(fromIndex, toIndex) {
    const rows = this._rows();
    const from = rows.nth(fromIndex);
    const to   = rows.nth(toIndex);
    const handle = from.locator(
      '.cdk-drag-handle, [cdkDragHandle], [class*="drag"], mat-icon:has-text("drag_indicator")'
    ).first();
    const source = (await handle.count().catch(() => 0)) > 0 ? handle : from;
    await source.scrollIntoViewIfNeeded().catch(() => {});
    await source.dragTo(to);
    await this.page.waitForTimeout(600);
  }

  // ── AC-11/12: Save order (batched persistence) ────────────────────────────────

  /** True if the "Save order" button is currently visible (AC-11). */
  async isSaveOrderButtonVisible() {
    return this.saveOrderButton.isVisible({ timeout: 2_000 }).catch(() => false);
  }

  /**
   * Click "Save order" and CAPTURE the single batched order-save request/response
   * (AC-12 — persistence must be one request, not per-move). Matches a
   * PUT/PATCH/POST on a /card/perks/… URL whose path implies ordering.
   * @returns {Promise<{status:number|null, body:string, method:string|null}>}
   */
  async clickSaveOrderAndCapture() {
    const respPromise = this.page
      .waitForResponse(
        (r) =>
          /\/card\/perks\//i.test(r.url()) &&
          /(order|rank|sort|reorder|arrange)/i.test(r.url()) &&
          ['PUT', 'PATCH', 'POST'].includes(r.request().method()),
        { timeout: 30_000 }
      )
      .catch(() => null);
    await this.saveOrderButton.click();
    const resp = await respPromise;
    await this.page.waitForTimeout(1_000);
    if (!resp) return { status: null, body: '', method: null };
    let body = '';
    try { body = await resp.text(); } catch { /* ignore */ }
    return { status: resp.status(), body, method: resp.request().method() };
  }

  // ── AC-06/07/08: row Actions (View / Delete) + delete confirmation ────────────

  /** Open a row's "•••" Actions popover (AC-06). */
  async openRowActions(rowIndex) {
    const row = this._rows().nth(rowIndex);
    const trigger = row.locator(
      'button[aria-label*="action" i], button[aria-label*="menu" i], ' +
      'button:has(mat-icon:has-text("more_vert")), button:has-text("⋮"), ' +
      '.actions button, td:last-child button'
    ).first();
    await trigger.scrollIntoViewIfNeeded().catch(() => {});
    await trigger.click();
    await this.page
      .locator('[role="menuitem"], .mat-mdc-menu-item, .mat-menu-item, .cdk-overlay-pane button')
      .first()
      .waitFor({ state: 'visible', timeout: 5_000 })
      .catch(() => {});
  }

  /** Internal: the currently-open Actions menu item locator. */
  _menuItems() {
    return this.page.locator('[role="menuitem"], .mat-mdc-menu-item, .mat-menu-item, .cdk-overlay-pane button');
  }

  /** Labels of the actions exposed in a row's popover (AC-06 → View + Delete). */
  async getRowActionLabels(rowIndex) {
    await this.openRowActions(rowIndex);
    const texts = (await this._menuItems().allInnerTexts()).map((t) => t.trim()).filter(Boolean);
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(200);
    return texts;
  }

  /** Click "View" on a row → navigate to the perk detail page (AC-06). */
  async clickViewAction(rowIndex) {
    await this.openRowActions(rowIndex);
    await this._menuItems().filter({ hasText: /view/i }).first().click();
    await this.page.waitForTimeout(800);
  }

  /**
   * Whether the Delete action is enabled for a row (AC-07). Reads disabled /
   * aria-disabled / disabled-class / pointer-events:none / low opacity. NOTE:
   * figma-analysis flags that the TABLE menu Delete may not be status-gated in
   * the current design (gating is only shown on the detail page) — this method
   * reports the real state so the spec can assert AC-07 truthfully.
   */
  async isDeleteEnabled(rowIndex) {
    await this.openRowActions(rowIndex);
    const del = this._menuItems().filter({ hasText: /delete/i }).first();
    await del.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
    const disabledAttr = (await del.getAttribute('disabled').catch(() => null)) !== null;
    const ariaDisabled = (await del.getAttribute('aria-disabled').catch(() => null)) === 'true';
    const styleDisabled = await del
      .evaluate((el) => {
        const cs = getComputedStyle(el);
        return (
          el.classList.contains('disabled') ||
          el.classList.contains('mat-mdc-menu-item-disabled') ||
          cs.pointerEvents === 'none' ||
          parseFloat(cs.opacity || '1') < 0.6
        );
      })
      .catch(() => false);
    const enabled = !(disabledAttr || ariaDisabled || styleDisabled);
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(200);
    return enabled;
  }

  /** Click "Delete" on a row → should open the confirmation modal (AC-08). */
  async clickDeleteAction(rowIndex) {
    await this.openRowActions(rowIndex);
    await this._menuItems().filter({ hasText: /delete/i }).first().click();
    await this.page.waitForTimeout(400);
  }

  /** True once the delete confirmation modal is shown (AC-08). */
  async isDeleteDialogVisible() {
    return this.deleteConfirmDialog.isVisible({ timeout: 5_000 }).catch(() => false);
  }

  /** The delete confirmation modal's message text (AC-08). */
  async getDeleteDialogText() {
    return ((await this.deleteConfirmDialog.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Confirm deletion ("Delete perk") and CAPTURE the delete API response
   * (AC-08). Asserting the HTTP call — not just row removal — is what proves the
   * deletion actually executed.
   * @returns {Promise<{status:number|null, body:string}>}
   */
  async confirmDeleteAndCapture() {
    const respPromise = this.page
      .waitForResponse(
        (r) => /\/card\/perks\//i.test(r.url()) &&
               (r.request().method() === 'DELETE' || /delete/i.test(r.url())),
        { timeout: 30_000 }
      )
      .catch(() => null);
    const confirmBtn = this.deleteConfirmDialog
      .locator('button')
      .filter({ hasText: /delete perk|^\s*delete\s*$|confirm|yes/i })
      .first();
    await confirmBtn.click();
    const resp = await respPromise;
    await this.page.waitForTimeout(1_200);
    if (!resp) return { status: null, body: '' };
    let body = '';
    try { body = await resp.text(); } catch { /* ignore */ }
    return { status: resp.status(), body };
  }

  /** Dismiss the delete confirmation modal without deleting (AC-08 cancel). */
  async cancelDeleteDialog() {
    const cancelBtn = this.deleteConfirmDialog
      .locator('button')
      .filter({ hasText: /cancel|no/i })
      .first();
    if (await cancelBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await cancelBtn.click();
    } else {
      await this.page.keyboard.press('Escape');
    }
    await this.deleteConfirmDialog.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
  }

  // ── AC-10: empty state ────────────────────────────────────────────────────────

  /** The in-table empty-state message text, or '' when rows are present (AC-10). */
  async getEmptyStateText() {
    if (!(await this.emptyState.isVisible({ timeout: 3_000 }).catch(() => false))) return '';
    return ((await this.emptyState.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  B10-56759 — EDIT-MODE FIELD-STATE READERS (extension, not a parallel POM).
  //  The Perk Details EDIT view reuses the creation form's controls, so these
  //  readers resolve fields by the SAME controlname/formcontrolname selectors
  //  already declared above (single source of truth — no selector duplication)
  //  and only ADD state-reading logic to assert the status/type editable-vs-
  //  locked matrix (AC-05/06/07/12/13/24).
  //
  //  Editable-vs-locked signal: Angular reactive forms render a disabled
  //  FormControl as the native `disabled` attribute on inputs and as
  //  `mat-select-disabled` / aria-disabled on mat-select; read-only fields carry
  //  `readonly`. We also treat pointer-events:none / low opacity / a
  //  disabled|readonly|locked|greyed class as locked. Selectors for controls the
  //  create form does not expose (Cashback limit, End date & time, Exclusions,
  //  Short duration description) are UNCONFIRMED live — reached via label match
  //  (_fieldByLabel) and flagged; re-confirm against the live edit DOM.
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Resolve a field by its reactive-form control name across the three control
   * shapes used on the form: app-bf-input (custom), textarea, plain input, and
   * mat-select. Returns the first match.
   * @param {string} control e.g. 'title_en', 'usage_description_en', 'type'
   */
  _fieldLocator(control) {
    return this.page
      .locator(
        `app-bf-input[controlname="${control}"] input, ` +
        `textarea[formcontrolname="${control}"], ` +
        `input[formcontrolname="${control}"], ` +
        `mat-select[formcontrolname="${control}"]`
      )
      .first();
  }

  /**
   * Resolve a control by a nearby label/placeholder for fields the create form
   * does not expose by a known controlname (Cashback limit / End date & time /
   * Exclusions / Short duration description). Tolerant: matches a mat-form-field
   * containing the label text, else a placeholder/aria-label match. UNCONFIRMED
   * against the live edit DOM — see the section header.
   * @param {RegExp} labelRe
   */
  _fieldByLabel(labelRe) {
    const src = labelRe.source;
    const flags = labelRe.flags.includes('i') ? labelRe.flags : labelRe.flags + 'i';
    const re = new RegExp(src, flags);
    return this.page
      .locator('mat-form-field', { hasText: re })
      .locator('input, textarea, mat-select')
      .first()
      .or(this.page.locator(`[placeholder*="${src}" i], [aria-label*="${src}" i]`).first());
  }

  /** Internal: read {present, editable, locked} for a resolved field locator. */
  async _readFieldState(locator) {
    const count = await locator.count().catch(() => 0);
    if (!count) return { present: false, editable: false, locked: false };
    if (!(await locator.isVisible({ timeout: 2_000 }).catch(() => false))) {
      return { present: false, editable: false, locked: false };
    }
    const s = await locator
      .evaluate((el) => {
        const cs = getComputedStyle(el);
        const tag = el.tagName.toLowerCase();
        const disabledAttr =
          el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
        const readonly =
          el.hasAttribute('readonly') || el.getAttribute('aria-readonly') === 'true';
        const cls = typeof el.className === 'string' ? el.className : '';
        const disabledClass =
          /(^|[\s-])(disabled|readonly|locked|greyed|grayed)([\s-]|$)/i.test(cls) ||
          (tag === 'mat-select' && /mat-select-disabled/i.test(cls));
        const pe  = cs.pointerEvents === 'none';
        const dim = parseFloat(cs.opacity || '1') < 0.6;
        return { disabledAttr, readonly, disabledClass, pe, dim };
      })
      .catch(() => null);
    if (!s) return { present: true, editable: false, locked: true };
    const editable = !(s.disabledAttr || s.readonly || s.disabledClass || s.pe || s.dim);
    return { present: true, editable, locked: !editable };
  }

  /** True if a control by name is rendered on the form at all. */
  async isFieldPresent(control) {
    return (await this._readFieldState(this._fieldLocator(control))).present;
  }

  /** True if a control by name is present AND editable (AC-05/06/07). */
  async isFieldEditable(control) {
    return (await this._readFieldState(this._fieldLocator(control))).editable;
  }

  /** True if a control by name is present AND locked/read-only (AC-12/13/24). */
  async isFieldLocked(control) {
    const s = await this._readFieldState(this._fieldLocator(control));
    return s.present && s.locked;
  }

  /** Label-based editable check for controls without a known controlname (AC-07/09/10/11). */
  async isFieldEditableByLabel(labelRe) {
    return (await this._readFieldState(this._fieldByLabel(labelRe))).editable;
  }

  /**
   * Read the editable/locked/present state of a set of controls at once and
   * return a map keyed by control name (AC-06/07/12/13). Use to assert the
   * whole permitted-vs-locked matrix in one pass.
   * @param {string[]} controls
   * @returns {Promise<Record<string,{present:boolean,editable:boolean,locked:boolean}>>}
   */
  async getEditableFieldMatrix(controls) {
    const out = {};
    for (const c of controls) out[c] = await this._readFieldState(this._fieldLocator(c));
    return out;
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  B10-57393 — complete the Create Perk form so "Preview & save" opens the
  //  "App preview" modal. Selectors captured LIVE 2026-07-27 (panel 2.4.5).
  //  Everything here composes the granular methods already above; nothing is
  //  re-implemented. Filling ORDER matters — see fillCompleteMerchantCashbackPerk.
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * The nested merchant mat-menu keeps a cdk-overlay-backdrop alive after a single
   * Escape, and that backdrop then swallows clicks on every field below it (observed
   * live: section_id was visible+enabled but unclickable for 30s). Press Escape until
   * the backdrop count reaches zero.
   */
  async dismissLingeringOverlays(tries = 5) {
    for (let i = 0; i < tries; i++) {
      if ((await this.page.locator('.cdk-overlay-backdrop').count()) === 0) return true;
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(350);
    }
    return (await this.page.locator('.cdk-overlay-backdrop').count()) === 0;
  }

  /**
   * Click "Preview & save" (the bottom one).
   *
   * A plain .click() is not enough AFTER a dialog has been closed: the CDK can leave an overlay
   * pane above the form that reports zero visible backdrops yet still owns the pointer, so the
   * click passes every actionability check and then burns the full 30s on the hit-target wait
   * (live 2026-07-27, B10-57393 — the X-close case). Clear overlays first, then fall back to a
   * DOM click, which dispatches on the element itself and cannot be intercepted.
   */
  async clickPreviewAndSave() {
    await this.dismissLingeringOverlays();
    await this.previewAndSaveButton.scrollIntoViewIfNeeded().catch(() => {});
    await this.previewAndSaveButton.click({ timeout: 8_000 })
      .catch(() => this.previewAndSaveButton.evaluate((el) => el.click()));
    await this.page.waitForTimeout(800);
  }

  /** Cashback limit + its duration are validated as a PAIR ("required together"). */
  async fillCashbackConsumptionLimit(limit = '100', interval = 'monthly') {
    const limitInput = this.page.locator('input[formcontrolname="consumption_limit"]');
    if (!(await limitInput.count())) return;
    await limitInput.fill(limit);
    const intervalSelect = this.page.locator('mat-select[formcontrolname="consumption_interval"]');
    await intervalSelect.scrollIntoViewIfNeeded().catch(() => {});
    await intervalSelect.click();
    await this.page.locator('mat-option', { hasText: interval }).first().click();
    await this.page.waitForTimeout(300);
  }

  async fillCashbackValueAndLimit(percentage = '15', limit = '100') {
    await this.page.locator('mat-radio-button', { hasText: 'Percentage' }).locator('label').click();
    await this.page.waitForTimeout(600);
    await this.page.locator('input[formcontrolname="cashback_value"]').fill(percentage);
    const capField = this.page.locator('input[formcontrolname="cash_back_limit"]');
    if (await capField.count()) await capField.fill(limit);
  }

  async fillDurationDescriptions(en, ar) {
    await this.page.locator('textarea[formcontrolname="short_duration_description_en"]').fill(en);
    await this.page.locator('textarea[formcontrolname="short_duration_description_ar"]').fill(ar);
  }

  /**
   * End date & time. The input is readonly, so the value can only be set via the
   * calendar. BOTH the start and end picker render a .dp-popup, so the VISIBLE one
   * must be targeted rather than the first in the DOM.
   */
  async setEndDate(monthsForward = 5, dayOfMonth = 31) {
    await this.page.locator('input.dp-picker-input').nth(1).click();
    await this.page.waitForTimeout(500);
    for (let i = 0; i < monthsForward; i++) {
      await this.page.locator('.dp-popup:visible').first()
        .locator('.dp-calendar-nav-right').click();
      await this.page.waitForTimeout(220);
    }
    await this.page.locator('.dp-popup:visible').first()
      .locator('button.dp-calendar-day').filter({ hasText: new RegExp(`^${dayOfMonth}$`) })
      .first().click();
    await this.page.waitForTimeout(400);
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(300);
  }

  /**
   * Upload all four slots: Cover EN, Cover AR (1080x1080), Logo EN, Logo AR (240x180).
   *
   * Always targets slot 0 because a filled slot stops rendering its "Add image" button, so the
   * remaining count IS the position in the sequence (4 left = Cover EN … 1 left = Logo AR).
   *
   * Driven as a loop rather than four straight calls: the upload dialog occasionally closes
   * without committing the file, which left slot 4 empty, and the four blind calls could not
   * notice. The form then blocked "Preview & save" on a required-image error and the test failed
   * far from the cause (live 2026-07-27, B10-57393). The loop simply retries the slot that did
   * not fill, and gives up loudly instead of walking into a mystery validation error.
   */
  async uploadAllFourPerkImages(maxAttempts = 8) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const remaining = await this.addImageButtons.count();
      if (remaining === 0) return;
      await this.uploadImage(0, remaining > 2 ? PHOTOS.coverSpec : PHOTOS.logoSpec);
    }
    const left = await this.addImageButtons.count();
    if (left > 0) {
      throw new Error(`${left} perk image slot(s) still empty after ${maxAttempts} upload attempts`);
    }
  }

  /**
   * Fill a COMPLETE valid Merchant-cashback perk so "Preview & save" opens the App
   * preview modal. Assumes the Create perk page is already open on no perk type.
   *
   * Order is load-bearing: the perk type must come first (the form is progressive),
   * the merchant picker must be followed by dismissLingeringOverlays(), and the
   * Section must be chosen BEFORE the subheaders — subheader_en/_ar only render once
   * a Section exists, and they are mandatory, so filling them earlier silently
   * leaves a required field empty and the preview never opens.
   *
   * A null optional description means "leave that section empty", so the preview
   * should omit it (used by the empty-optional-sections case).
   */
  async fillCompleteMerchantCashbackPerk(overrides = {}) {
    const d = {
      merchant: 'Breadfast Coffee',
      section: 'Breadfast',
      titleEn: '15% Cashback',
      titleAr: '١٥٪ كاش باك',
      subEn: 'Coffee & Bakery',
      subAr: 'قهوة ومخبوزات',
      descEn: 'Get 15% cashback on all Breadfast Coffee orders, capped at EGP 100.',
      descAr: 'استرجع ١٥٪ من قيمة مشترياتك من بريدفاست كوفي بحد أقصى ١٠٠ جنيه.',
      usageEn: 'Valid once per day at any Breadfast Coffee branch.',
      usageAr: 'صالح مرة واحدة يومياً في أي فرع من بريدفاست كوفي.',
      branchesEn: '- Promenade Mall\n- Rehab\n- Madinaty',
      branchesAr: '- بروميناد مول\n- الرحاب\n- مدينتي',
      cbEn: 'Cashback may take up to 14 days to reflect.',
      cbAr: 'قد يستغرق الكاش باك ١٤ يوماً حتى يظهر.',
      durEn: 'This offer expires on Dec 31st, 2026.',
      durAr: 'ينتهي هذا العرض في ٣١/١٢/٢٠٢٦',
      percentage: '15',
      cashbackLimit: '100',
      fundingType: 'Merchant funded',
      setEndDate: true,
      ...overrides,
    };

    await this.selectPerkTypeByName('Merchant cashback');
    await this.selectMerchantForPerk(d.merchant);
    await this.dismissLingeringOverlays();
    await this.selectSection(d.section);
    await this.fillTitles(d.titleEn, d.titleAr);
    await this.fillSubheaders(d.subEn, d.subAr);
    await this.fillCashbackValueAndLimit(d.percentage, d.cashbackLimit);
    await this.descEnTextarea.fill(d.descEn);
    await this.descArTextarea.fill(d.descAr);
    await this.fillUsage(d.usageEn, d.usageAr);
    if (d.branchesEn !== null) await this.fillBranches(d.branchesEn, d.branchesAr);
    if (d.cbEn !== null) await this.fillCashbackProcessing(d.cbEn, d.cbAr);
    if (d.durEn !== null) await this.fillDurationDescriptions(d.durEn, d.durAr);
    await this.selectFundingType(d.fundingType);
    await this.uploadAllFourPerkImages();
    if (d.setEndDate) await this.setEndDate();
    return d;
  }

  /**
   * Fill a COMPLETE valid Discount/coupon perk — the only type that renders the
   * Coupon code section. For this type the ARABIC description and usage are ALSO
   * mandatory, and "Coupon type" only renders after a coupon code is entered.
   */
  async fillCompleteDiscountCouponPerk(overrides = {}) {
    const d = {
      merchant: 'Breadfast Coffee',
      section: 'Breadfast',
      titleEn: '20% Off Coffee',
      titleAr: '٢٠٪ خصم قهوة',
      subEn: 'Coffee & Bakery',
      subAr: 'قهوة ومخبوزات',
      couponCode: 'BFCOFFEE20',
      couponType: 'Online',
      descEn: 'Get 20% off any coffee order at Breadfast Coffee branches.',
      descAr: 'احصل على خصم ٢٠٪ على أي طلب قهوة من فروع بريدفاست كوفي.',
      usageEn: 'Use the coupon once per day at checkout in the Breadfast app.',
      usageAr: 'استخدم الكوبون مرة واحدة يومياً عند الدفع في تطبيق بريدفاست.',
      branchesEn: '- Cairo Festival City\n- Point 90\n- City Stars',
      branchesAr: '- كايرو فيستيفال سيتي\n- بوينت ٩٠\n- سيتي ستارز',
      cbEn: 'Discount applies instantly at checkout.',
      cbAr: 'يطبق الخصم فوراً عند الدفع.',
      durEn: 'Valid till Dec 31st, 2026.',
      durAr: 'صالح حتى ٣١/١٢/٢٠٢٦',
      fundingType: 'Merchant funded',
      ...overrides,
    };

    await this.selectPerkTypeByName('Discount/coupon');
    await this.selectMerchantForPerk(d.merchant);
    await this.dismissLingeringOverlays();
    await this.selectSection(d.section);
    await this.fillTitles(d.titleEn, d.titleAr);
    await this.fillSubheaders(d.subEn, d.subAr);
    await this.fillCouponCode(d.couponCode);
    if (await this.isCouponTypeVisible()) await this.selectCouponType(d.couponType);
    await this.descEnTextarea.fill(d.descEn);
    await this.descArTextarea.fill(d.descAr);
    await this.fillUsage(d.usageEn, d.usageAr);
    await this.fillBranches(d.branchesEn, d.branchesAr);
    await this.fillCashbackProcessing(d.cbEn, d.cbAr);
    await this.fillDurationDescriptions(d.durEn, d.durAr);
    await this.selectFundingType(d.fundingType);
    await this.uploadAllFourPerkImages();
    return d;
  }

  /** Content sitting exactly ON each documented cap (title 20, subheader 30, desc 80,
   *  usage 200, cashback 45, duration 40). The form REJECTS anything longer and blocks
   *  Preview & save, so a max-length RENDER test must sit at the cap, not above it. */
  static maxLengthContent() {
    const fit = (s, n) => s.slice(0, n);
    return {
      titleEn: fit('Mega Cashback Bonanza Deal', 20),
      subEn: fit('Coffee, Bakery, Pastry & Desserts', 30),
      descEn: fit('Enjoy an unlimited 25% cashback on every single order placed at any branch nationwide', 80),
      usageEn: fit('Valid once per calendar day at any participating Breadfast Coffee branch nationwide.'
        + ' Cashback is credited to your Breadfast Pay wallet and is capped at EGP 100 per calendar month.'
        + ' Excludes gift cards.', 200),
      branchesEn: '- Promenade Mall\n- Rehab\n- Madinaty\n- Mivida\n- Cairo Festival City\n- Point 90'
        + '\n- Mall of Egypt\n- Arkan Plaza\n- Zamalek\n- Maadi Degla\n- Heliopolis Korba\n- New Cairo Village',
      cbEn: fit('Cashback may take up to 14 working days to appear in full', 45),
      durEn: fit('This limited offer expires on December 31st 2026', 40),
    };
  }

  /**
   * Toast/snackbar text currently rendered ANYWHERE in the document.
   *
   * Document-scoped on purpose: Material puts a snack-bar in .cdk-overlay-container as a sibling of
   * mat-dialog-container, so a dialog-scoped read cannot see it. Reading only the dialog is what
   * produced the false "the panel rejects wrong-sized images silently" finding — it does not; it
   * toasts "Image resolution is invalid. Should be (1080 x 1080)" immediately
   * (verified 2026-07-28, B10-57393/automation/probe_image_spec.js).
   */
  async getUploadFeedbackToasts() {
    return this.page.evaluate(() => [...document.querySelectorAll(
      '.cdk-overlay-container .mat-snack-bar-container, snack-bar-container, simple-snack-bar,'
      + ' .mat-mdc-snack-bar-container, .toast, [class*="toastr"], [role="alert"], [role="status"]'
    )].map((n) => (n.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean)).catch(() => []);
  }

  /** Every validation message currently rendered on the create form. */
  async getFormValidationErrors() {
    const errors = await this.page.locator('app-perk-form mat-error, app-perk-form .text-danger')
      .allInnerTexts().catch(() => []);
    return [...new Set(errors.map((e) => e.trim()).filter(Boolean))];
  }
}

module.exports = PerksPage;
// Expose the image-asset map so specs can reference the exact-spec assets
// (coverSpec/logoSpec) and the known-rejected composites (coverEn/logoEn) for
// AC5 positive/negative upload tests without re-deriving paths.
module.exports.PHOTOS = PHOTOS;
