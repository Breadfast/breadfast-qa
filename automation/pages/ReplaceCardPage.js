'use strict';

/**
 * ReplaceCardPage — Card Admin Panel: replacement-fee confirmation modals.
 *
 * Story: B10-48764 "Display Replacement Fees on 'Report Card Lost or Stolen' Screen".
 *
 * Covers two flows triggered from the customer card panel:
 *
 *   1. Replace Breadfast Card (Active / Linked / Received cards)
 *      Clicks "Replace Breadfast Card" action link → confirmation modal appears.
 *      Modal title:  "Are you sure you want to proceed with replacing the Breadfast Card?"
 *      Body asserts: card closed permanently, balance transferred to wallet, fee EGP 150.
 *      Warning box:  "Please review your decision carefully. Once confirmed, the replacement
 *                    cannot be undone."
 *      CTAs:         "Replace card" (primary/destructive) + "Cancel".
 *      API:          intercepted via waitForResponse matching /replace/ in the URL.
 *
 *   2. Reapply for Breadfast Card (customers with a previously-closed card)
 *      Clicks "Reapply for Breadfast Card" action link → confirmation modal.
 *      Modal title:  "Are you sure you want to reapply for this card?"
 *      Body asserts: customer can pick up new card from branch, fee EGP 150.
 *      CTAs:         "Reapply" + "Cancel".
 *      API:          intercepted via waitForResponse matching /reappl/ in the URL.
 *
 * Navigation: search by mobile → More Details → card panel view (same route as
 * EditCustomerPage: /#/walletUsers/search).
 *
 * API format assumed (not confirmed live — interceptor uses loose URL pattern):
 *   POST /api/.../cards/replace  or  /api/.../walletUsers/replace
 *   POST /api/.../cards/reapply  or  /api/.../walletUsers/reapply
 */

const { expect } = require('@playwright/test');
const BasePage   = require('./BasePage');

class ReplaceCardPage extends BasePage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    super(page);

    // ── Search / open ────────────────────────────────────────────────────────
    this.searchInput    = page.getByRole('textbox', { name: 'Search by Mobile number' });
    this.searchButton   = page.getByRole('button',  { name: 'Search' });
    this.moreDetailsBtn = page.getByRole('button',  { name: 'More Details' });

    // ── Card panel action links ───────────────────────────────────────────────
    this.replaceCardLink  = page.getByRole('link', { name: /Replace Breadfast Card/i });
    this.reapplyCardLink  = page.getByRole('link', { name: /Reapply for Breadfast Card/i });

    // ── Replace modal ─────────────────────────────────────────────────────────
    this.replaceModal        = page.locator('app-bf-modal, mat-dialog-container, [role="dialog"]').first();
    this.replaceConfirmBtn   = page.getByRole('button', { name: /Replace card/i });
    this.replaceCancelBtn    = page.getByRole('button', { name: /Cancel/i }).first();

    // ── Reapply modal ─────────────────────────────────────────────────────────
    this.reapplyConfirmBtn   = page.getByRole('button', { name: /Reapply/i });
    this.reapplyCancelBtn    = page.getByRole('button', { name: /Cancel/i }).first();
  }

  // ── Navigation ──────────────────────────────────────────────────────────────

  /** Open the card panel view for a customer by mobile number. */
  async openCustomerCardPanel(mobile) {
    await this.goToUrl('/#/walletUsers/search');
    await this.waitForVisible(this.searchInput);
    await this.searchInput.fill(mobile);
    await this.searchButton.click();
    await this.waitForVisible(this.moreDetailsBtn);
    await this.moreDetailsBtn.click();
    // Wait for the card panel to fully render (actions visible)
    await this.waitForVisible(this.replaceCardLink);
    await this.page.waitForTimeout(500);
  }

  // ── Replace Card flow ────────────────────────────────────────────────────────

  /** Click "Replace Breadfast Card" and wait for the confirmation modal to appear. */
  async openReplaceModal() {
    await this.replaceCardLink.click();
    await this.waitForVisible(this.replaceModal);
    await this.page.waitForTimeout(400);
  }

  /** Return the visible text content of the replace modal. */
  async getReplaceModalText() {
    return this.replaceModal.innerText();
  }

  /** Click the primary "Replace card" CTA and capture the API call.
   * @returns {Promise<{status:number|null, body:string, payload:object|null}>}
   */
  async confirmReplacement() {
    const respPromise = this.page
      .waitForResponse(r => /replace/i.test(r.url()) && r.request().method() === 'POST', { timeout: 30_000 })
      .catch(() => null);

    await this.replaceConfirmBtn.click();
    const resp = await respPromise;
    if (!resp) return { status: null, body: '', payload: null };

    const status  = resp.status();
    const body    = await resp.text().catch(() => '');
    const payload = JSON.parse(resp.request().postData() || 'null');
    console.log(`[replace] status=${status}`);
    return { status, body, payload };
  }

  /** Dismiss the replace modal via the Cancel button and verify the modal closes. */
  async cancelReplacement() {
    await this.replaceCancelBtn.click();
    await expect(this.replaceModal).not.toBeVisible({ timeout: 5000 });
  }

  /** Dismiss the replace modal by pressing Escape and verify the modal closes. */
  async dismissReplaceByEscape() {
    await this.page.keyboard.press('Escape');
    await expect(this.replaceModal).not.toBeVisible({ timeout: 5000 });
  }

  // ── Reapply flow ─────────────────────────────────────────────────────────────

  /** Click "Reapply for Breadfast Card" and wait for the confirmation modal to appear. */
  async openReapplyModal() {
    await this.reapplyCardLink.click();
    await this.waitForVisible(this.replaceModal); // same dialog container
    await this.page.waitForTimeout(400);
  }

  /** Return the visible text content of the reapply modal. */
  async getReapplyModalText() {
    return this.replaceModal.innerText();
  }

  /** Click the "Reapply" CTA and capture the API call.
   * @returns {Promise<{status:number|null, body:string, payload:object|null}>}
   */
  async confirmReapplication() {
    const respPromise = this.page
      .waitForResponse(r => /reappl/i.test(r.url()) && r.request().method() === 'POST', { timeout: 30_000 })
      .catch(() => null);

    await this.reapplyConfirmBtn.click();
    const resp = await respPromise;
    if (!resp) return { status: null, body: '', payload: null };

    const status  = resp.status();
    const body    = await resp.text().catch(() => '');
    const payload = JSON.parse(resp.request().postData() || 'null');
    console.log(`[reapply] status=${status}`);
    return { status, body, payload };
  }

  /** Dismiss the reapply modal via Cancel and verify it closes. */
  async cancelReapplication() {
    await this.reapplyCancelBtn.click();
    await expect(this.replaceModal).not.toBeVisible({ timeout: 5000 });
  }
}

module.exports = ReplaceCardPage;
