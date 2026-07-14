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

    // Perk type
    this.perkTypeCombobox        = page.getByRole('combobox', { name: 'Select Type' });
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

  /** Open the Section dropdown and return the list of option labels (AC6). */
  async getSectionOptions() {
    await this.page.locator('mat-select[formcontrolname="section_id"]').click();
    await this.page.locator('mat-option').first().waitFor({ state: 'visible', timeout: 8_000 });
    const opts = await this.page.locator('mat-option').allInnerTexts();
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(300);
    return opts.map((t) => t.trim()).filter(Boolean);
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
    const texts = await this.page.locator('h4').allInnerTexts();
    return texts.map((t) => t.trim()).filter(Boolean);
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

  /** Category cashback perk: keyed on MCC / category selection.
   *  Category-specific picker selectors still need a live-DOM capture — kept a stub. */
  async fillCategoryPerk(/* { nameEn, mccs:[...] , cashback } */) {
    throw new Error(
      'fillCategoryPerk: category-perk MCC/category picker selectors not yet captured — capture from the live form and implement.'
    );
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
}

module.exports = PerksPage;
