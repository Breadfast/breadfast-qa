'use strict';

/**
 * CollectDialogPage — Card Admin Panel card-collection flow (B10-56336 / PRD B10-56334)
 *
 * Verified live 2026-06-22 (registered customer +201199742559).
 *
 * Flow:
 *   [Card Collected] button (status Registered)
 *     → Popup 1 "Select store location": combobox "Store Location" (mat-autocomplete);
 *       selecting a location reveals "Branch Code"; buttons "Print Form & Continue" and
 *       "Continue without Printing" are DISABLED until a location is selected.
 *         • Print Form & Continue → POST /wallet_users/print_kyc
 *             - 400 "You have to insert mandatory customer details." if KYC incomplete (stays on Popup 1)
 *             - 200 (PDF) if complete → advances to Popup 2
 *         • Continue without Printing → Popup 2 (no PDF)
 *     → Popup 2 "Confirm card collection by entering package number": input "Package Number";
 *       Confirm shows inline "This field is required." when empty; valid → POST /wallet_users/received
 *         - 400 {message_code:"personal_info"} if KYC incomplete
 *         - 200 → status becomes Received, collection date + package saved
 */

const { expect } = require('@playwright/test');
const BasePage = require('./BasePage');

class CollectDialogPage extends BasePage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    super(page);
    this.cardCollectedBtn = page.getByRole('button', { name: 'Card Collected' });

    // Popup 1
    this.storeCombobox = page.getByRole('combobox', { name: 'Store Location' });
    this.printContinueBtn = page.getByRole('button', { name: 'Print Form & Continue' });
    this.continueNoPrintBtn = page.getByRole('button', { name: 'Continue without Printing' });

    // Popup 2 — Package Number is a custom <app-bf-input>; target the inner input by role.
    this.packageInput = page.getByRole('textbox', { name: 'Package Number' });
    // Popup 2 Confirm button (scoped to the dialog).
    this.confirmBtn = page.getByRole('dialog').getByRole('button', { name: /^Confirm$/ }).first();

    // Post-collection header actions ("more_horiz" 3-dots) + the "Print KYC Form" item.
    this.headerMenuBtn    = page.locator('button:has-text("more_horiz")').first();
    this.printKycMenuItem = page.getByText('Print KYC Form', { exact: true });
  }

  // ── Popup 1 ────────────────────────────────────────────────────────────────

  async openCollect() {
    await this.cardCollectedBtn.click();
    await this.waitForVisible(this.storeCombobox);
    await this.page.waitForTimeout(300);
  }

  /** Open the Store Location autocomplete panel if it isn't already showing options (used for
   *  LISTING the full, unfiltered set). A blind click() toggles it, so this is open-state-aware. */
  async ensureStoreDropdownOpen() {
    const anyOption = this.page.getByRole('option').first();
    if (await anyOption.isVisible().catch(() => false)) return;
    await this.storeCombobox.click();
    await anyOption.waitFor({ state: 'visible', timeout: this.DEFAULT_TIMEOUT }).catch(() => {});
  }

  /**
   * Select a store in the Store Location field. It is a keystroke-driven autocomplete, not a
   * plain dropdown, so:
   *  - fill() is avoided (it sets the value without the key events that open/filter the panel);
   *  - any PRIOR selection is cleared with real keys first, otherwise the leftover value filters
   *    the panel and hides the target branch (the failure mode when changing the store);
   *  - the full list is then opened (open-state-aware) and the exact-name option clicked.
   */
  async selectStore(name) {
    await this.storeCombobox.click();
    await this.storeCombobox.press('Control+a').catch(() => {});
    await this.storeCombobox.press('Delete').catch(() => {});
    await this.page.waitForTimeout(200);
    await this.ensureStoreDropdownOpen();
    const opt = this.page.getByRole('option', { name, exact: true }).first();
    await this.waitForVisible(opt);
    await opt.click();
    await this.page.waitForTimeout(400);
  }

  /** Visible Branch Code value after a store is selected, or '' if absent. */
  async branchCode() {
    const loc = this.page.locator('text=Branch Code').locator('xpath=following-sibling::*[1]');
    return (await loc.textContent().catch(() => '') || '').trim();
  }

  async printActionsDisabled() {
    return {
      print: await this.printContinueBtn.isDisabled().catch(() => null),
      noPrint: await this.continueNoPrintBtn.isDisabled().catch(() => null),
    };
  }

  /**
   * Click "Print Form & Continue" and capture the print_kyc call.
   * @returns {Promise<{status:number|null, body:string, message:string}>}
   */
  async printAndCapture() {
    const respPromise = this.page
      .waitForResponse(r => r.url().includes('/wallet_users/print_kyc'), { timeout: 30_000 })
      .catch(() => null);
    await this.printContinueBtn.click();
    const resp = await respPromise;
    let status = null, body = '', message = '';
    if (resp) {
      status = resp.status();
      try { body = await resp.text(); } catch { /* ignore */ }
      try { message = JSON.parse(body)?.message || ''; } catch { /* ignore */ }
    }
    console.log(`[print_kyc] status=${status} message="${message}"`);
    return { status, body, message };
  }

  async continueWithoutPrinting() {
    await this.continueNoPrintBtn.click();
    await this.waitForVisible(this.packageInput);
  }

  // ── Popup 2 ────────────────────────────────────────────────────────────────

  /** Click Confirm in Popup 2 and capture the /received call (null status if none fired). */
  async confirmPackageAndCapture(packageNumber) {
    if (packageNumber !== undefined) await this.packageInput.fill(packageNumber);
    const respPromise = this.page
      .waitForResponse(r => r.url().includes('/wallet_users/received'), { timeout: 20_000 })
      .catch(() => null);
    await this.page.getByRole('dialog').getByRole('button', { name: /^Confirm$/ }).first().click();
    const resp = await respPromise;
    let status = null, body = '', message = '';
    if (resp) {
      status = resp.status();
      try { body = await resp.text(); } catch { /* ignore */ }
      try { message = JSON.parse(body)?.message || ''; } catch { /* ignore */ }
    }
    console.log(`[received] status=${status} message="${message}"`);
    return { status, body, message };
  }

  /** Inline required-package error under Package Number (empty-submit guard). Per the updated
   *  AC (the "Confirm disabled until entered" line was struck through) and fixed defect
   *  B10-57363, the message is "Add a Package number to continue"; kept tolerant of wording. */
  async packageRequiredError() {
    const loc = this.page
      .getByText(/Add a Package number to continue|Package number.*(required|continue)|This field is required\./i)
      .first();
    return (await loc.textContent().catch(() => '') || '').trim();
  }

  // ── Post-collection reprint (header action) ─────────────────────────────────

  /**
   * From a Received customer's detail page: open the header actions menu, click
   * "Print KYC Form", and capture the generated PDF. Non-consuming (does not change
   * state). Returns the HTTP status, content-type, and the PDF bytes (Buffer) — from
   * the network response, with a download-event fallback for attachment responses.
   * @returns {Promise<{status:number|null, contentType:string, body:Buffer|null, message:string}>}
   */
  async printKycFromHeaderAndCapture() {
    const fs = require('fs');
    // open the header "more_horiz" actions menu
    await this.page.locator('button:has-text("more_horiz")').first().click();
    await this.page.waitForTimeout(300);

    const respPromise = this.page
      .waitForResponse(r => r.url().includes('/wallet_users/print_kyc'), { timeout: 30_000 })
      .catch(() => null);
    const downloadPromise = this.page.waitForEvent('download', { timeout: 30_000 }).catch(() => null);

    await this.page.getByText('Print KYC Form', { exact: true }).click();

    const resp = await respPromise;
    let status = null, contentType = '', body = null, message = '';
    if (resp) {
      status = resp.status();
      try { contentType = (await resp.headerValue('content-type')) || ''; } catch { /* ignore */ }
      try { body = await resp.body(); } catch { /* body may be consumed by a download */ }
      if (!body && status >= 400) { try { message = await resp.text(); } catch { /* ignore */ } }
    }
    if (!body) {
      const dl = await downloadPromise;
      if (dl) { try { body = fs.readFileSync(await dl.path()); } catch { /* ignore */ } }
    }
    console.log(`[print_kyc/header] status=${status} type="${contentType}" bytes=${body ? body.length : 0}`);
    return { status, contentType, body, message };
  }

  // ── Popup 1 extras (B10-56337) ──────────────────────────────────────────────

  /** All selectable Store Location option labels (branch reference data). */
  async listStoreOptions() {
    await this.ensureStoreDropdownOpen();
    const opts = this.page.getByRole('option');
    await opts.first().waitFor({ state: 'visible', timeout: this.DEFAULT_TIMEOUT }).catch(() => {});
    const names = (await opts.allTextContents()).map(s => s.trim()).filter(Boolean);
    // Leave the dropdown open — selectStore()/ensureStoreDropdownOpen() is open-state-aware, so
    // callers that list then select don't depend on this overlay closing on Escape (it doesn't).
    return names;
  }

  /**
   * Store option label that is a real branch, not injected/junk reference data. The testing
   * store list is polluted with template/formula-injection entries such as "{{7*7}}" and
   * "=CHAR(49)+55"; a genuine branch name never contains formula/template characters.
   */
  static isRealStoreName(name) {
    if (!name) return false;
    if (/^\s*select\b/i.test(name)) return false;      // placeholder option
    if (/[{}<>*=()+]|CHAR\s*\(/i.test(name)) return false; // {{7*7}}, =CHAR(49)+55, etc.
    return true;
  }

  /** Real, selectable Store Location branches only (junk/injected entries filtered out). */
  async listValidStoreOptions() {
    return (await this.listStoreOptions()).filter(n => CollectDialogPage.isRealStoreName(n));
  }

  /** Select a store and return the Branch Code it reveals (for the mapping/update checks). */
  async selectStoreAndGetBranch(name) {
    await this.selectStore(name);
    return this.branchCode();
  }

  /** Focus the Store Location field then leave it without choosing a value, to surface
   *  its required-field validation while both actions stay disabled (AC3 / HLS4). */
  async touchStoreWithoutSelecting() {
    await this.storeCombobox.click();
    await this.page.waitForTimeout(200);
    await this.page.keyboard.press('Escape').catch(() => {});
    await this.storeCombobox.blur().catch(() => {});
    await this.page.waitForTimeout(300);
  }

  /** Inline "This field is required." shown for the Store Location field (Popup 1). */
  async storeRequiredError() {
    return (await this.page.locator('text=This field is required.').first().textContent().catch(() => '') || '').trim();
  }

  // ── Popup 2 extras (B10-56337) ──────────────────────────────────────────────

  /** Whether the Popup 2 Confirm button is disabled (true until a package number is entered). */
  async confirmDisabled() {
    return this.confirmBtn.isDisabled().catch(() => null);
  }

  // ── Post-collection 3-dots menu (B10-56337) ─────────────────────────────────

  async openHeaderMenu() {
    await this.headerMenuBtn.click();
    await this.page.waitForTimeout(300);
  }

  /** Whether the "Print KYC Form" action is present in the 3-dots header menu.
   *  Opens the menu, reads visibility, then closes it (Escape) — non-consuming. */
  async isPrintKycActionAvailable() {
    await this.openHeaderMenu();
    const visible = await this.printKycMenuItem.isVisible().catch(() => false);
    await this.page.keyboard.press('Escape').catch(() => {});
    await this.page.waitForTimeout(200);
    return visible;
  }
}

module.exports = CollectDialogPage;
