'use strict';

/**
 * EditCustomerPage — Card Admin Panel  (#/walletUsers/search → view-user → Edit Customer Details)
 *
 * Story: B10-56336 "Extend Admin Portal with All KYC Fields".
 *
 * Selectors + behaviour verified against the live testing panel (2026-06-22, customer
 * +201203365955 / محمد علي):
 *
 *   Edit modal = centered dialog, heading "Edit Customer Details", subtitle "Fill the
 *   fields in Arabic". Sections: Personal info / Identity info / Background info.
 *
 *   formcontrolname map:
 *     fname, lname, fname_en, lname_en            — names
 *     birthdate (date), expiry_date (date)        — DD-MM-YYYY pickers
 *     gender (radio male|female)
 *     address                                     — Arabic-only (digits allowed)
 *     city (select — Egyptian governorates, Arabic)  ← AC "Place/City of birth"
 *     email
 *     nationality (text, default "مصري", Arabic-only)
 *     national_id
 *     issuing_authority (Arabic-only)             — placeholder "Enter issuance place"
 *     issuing_date (date)                         — must be in the past (today + future rejected)
 *     has_other_nationalities (radio Yes|No)
 *     other_nationalities (text)                  — shown ONLY when has_other_nationalities = Yes
 *     occupation (Arabic-only, now mandatory)
 *     marital_status, religion (select)
 *     is_adib_customer (radio Yes|No)
 *
 *   Date pickers: two inputs share placeholder "DD-MM-YYYY" — index 0 birthdate,
 *   1 national-id expiry. Issuing date is a separate "MM/YYYY" month picker (changed
 *   2026-07-08). .fill() on the input binds the Angular control.
 *
 *   VALIDATION IS SERVER-SIDE, ONE FIELD AT A TIME. Each Confirm POSTs
 *   /api/v1/web/wallet_users/update; on failure the API returns HTTP 400 with
 *   { errors: { validationErrors: { <field>: [{message, field, validation}] } } } for a
 *   SINGLE field, which the FE renders inline under that field. Observed priority order:
 *   occupation → address → issuing_authority → issuing_date → … . Messages:
 *     required        → "<field> is required"            (e.g. "occupation is required")
 *     Arabic-only     → "Please enter Arabic characters only"
 *     issuing_date    → "Date cannot be today or a future date"
 */

const { expect } = require('@playwright/test');
const BasePage = require('./BasePage');

const UPDATE_URL = '/wallet_users/update';

class EditCustomerPage extends BasePage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    super(page);

    // ── Search / open ───────────────────────────────────────────────────────
    // Search box is a custom <app-bf-input>; target the inner native input by role.
    this.searchInput     = page.getByRole('textbox', { name: 'Search by Mobile number' });
    this.searchButton    = page.getByRole('button', { name: 'Search' });
    this.moreDetailsBtn  = page.getByRole('button', { name: 'More Details' });
    this.editLink        = page.getByRole('link', { name: /^Edit/ });

    // ── Modal ────────────────────────────────────────────────────────────────
    this.editHeading   = page.getByRole('heading', { name: 'Edit Customer Details' });
    this.confirmButton = page.getByRole('button', { name: 'Confirm' });
    this.closeButton   = page.getByRole('button', { name: 'Close' });

    // ── Fields (by formcontrolname) ───────────────────────────────────────────
    this.nationality      = page.locator('input[formcontrolname="nationality"]');
    this.address          = page.locator('input[formcontrolname="address"]');
    this.issuingAuthority = page.locator('input[formcontrolname="issuing_authority"]');
    this.occupation       = page.locator('input[formcontrolname="occupation"]');
    this.otherNatDetails  = page.locator('input[formcontrolname="other_nationalities"]');
    this.citySelect       = page.locator('select[formcontrolname="city"]');
    this.dateInputs       = page.locator('input[placeholder="DD-MM-YYYY"]'); // 0 dob, 1 expiry
    // formcontrolname is no longer rendered on the date inputs in the live panel (verified
    // 2026-07-05 via DOM probe: the DD-MM-YYYY inputs report formcontrolname=null) —
    // use position-based locators instead.
    // 2026-07-08: the Issuing Date picker changed from a DD-MM-YYYY (3rd) input to a
    // dedicated MM/YYYY picker, so it is no longer part of dateInputs. Target it directly.
    this.dobInput         = this.dateInputs.nth(0); // Date of Birth (B10-55294)
    this.issuingDateInput = page.locator('input[placeholder="MM/YYYY"]'); // Issuing Date
  }

  // ── Navigation ──────────────────────────────────────────────────────────────

  /** Search a customer by mobile and open their detail (view-user) page. */
  async openCustomerView(mobile) {
    await this.goToUrl('/#/walletUsers/search');
    await this.waitForVisible(this.searchInput);
    await this.searchInput.fill(mobile);
    await this.searchButton.click();
    await this.waitForVisible(this.moreDetailsBtn);
    await this.moreDetailsBtn.click();
    await this.waitForVisible(this.editLink); // detail page rendered
    await this.page.waitForTimeout(400);
  }

  /** Search a customer by mobile and open the Edit Customer Details modal. */
  async openCustomerEdit(mobile) {
    await this.openCustomerView(mobile);
    await this.editLink.click();
    await this.waitForVisible(this.editHeading);
    await this.page.waitForTimeout(500);
  }

  /** Open Edit from the current detail page (when already on view-user). */
  async openEditFromView() {
    await this.editLink.click();
    await this.waitForVisible(this.editHeading);
    await this.page.waitForTimeout(500);
  }

  // ── Field setters ─────────────────────────────────────────────────────────

  async setText(locator, value) {
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    await locator.fill(value);
  }

  /** @param {'Yes'|'No'} value */
  async setOtherNationalities(value) {
    await this.page
      .locator(`input[formcontrolname="has_other_nationalities"][value="${value}"]`)
      .check({ force: true });
    await this.page.waitForTimeout(300); // let the conditional field render/remove
  }

  /** @param {'Yes'|'No'} value */
  async setAdibCustomer(value) {
    await this.page
      .locator(`input[formcontrolname="is_adib_customer"][value="${value}"]`)
      .check({ force: true });
  }

  /** City of birth (mandatory governorate dropdown). Selects by Arabic label, falling back to
   *  the first real option if the exact label isn't found. */
  async setCity(label = 'القاهرة') {
    try {
      await this.citySelect.selectOption({ label });
    } catch {
      await this.citySelect.selectOption({ index: 1 }); // skip the placeholder at index 0
    }
    await this.page.waitForTimeout(150);
  }

  /** Issuing date is a MM/YYYY month picker (changed from a DD-MM-YYYY day picker 2026-07-08).
   *  Accepts either a DD-MM-YYYY value (month+year are used) or a ready MM/YYYY string; pass ''
   *  to clear. Filling opens the calendar overlay, which would intercept the Confirm click —
   *  dismiss it by clicking the modal heading (Escape closes the modal). */
  async setIssuingDate(value) {
    await this.issuingDateInput.fill(this.constructor.toMonthYear(value));
    await this.editHeading.click({ timeout: 5000 }).catch(() => {});
    await this.page.waitForTimeout(200);
  }

  /** Normalise a date value to the MM/YYYY the Issuing Date picker now expects.
   *  '02-02-2015' → '02/2015', '02/2015' → '02/2015', '' → ''. */
  static toMonthYear(value) {
    if (!value) return '';
    const parts = String(value).trim().split(/[-/]/);
    let month, year;
    if (parts.length === 3)      { month = parts[1]; year = parts[2]; } // DD-MM-YYYY
    else if (parts.length === 2) { month = parts[0]; year = parts[1]; } // MM/YYYY (or MM-YYYY)
    else return String(value);
    return `${String(month).padStart(2, '0')}/${year}`;
  }

  /** True if the conditional "Specify other nationalities" field is in the DOM + visible. */
  async isOtherNatDetailsVisible() {
    return this.otherNatDetails.isVisible().catch(() => false);
  }

  /**
   * Fill every required field with a known-valid value so a single deliberately-bad
   * field can be isolated. Caller overrides one field, then submits.
   */
  async fillAllValid(overrides = {}) {
    const v = {
      nationality:      'مصري',
      address:          'القاهرة المعادي شارع ٩ مبنى 12',
      issuingAuthority: 'مصلحة الأحوال المدنية',
      occupation:       'طبيب',
      issuingDate:      '02-02-2015',
      city:             'القاهرة',
      otherNationalities: 'No',
      adib:             'No',
      ...overrides,
    };
    await this.setText(this.nationality, v.nationality);
    await this.setText(this.address, v.address);
    await this.setText(this.issuingAuthority, v.issuingAuthority);
    await this.setText(this.occupation, v.occupation);
    await this.setCity(v.city);
    await this.setIssuingDate(v.issuingDate);
    await this.setOtherNationalities(v.otherNationalities);
    if (v.otherNationalities === 'Yes' && v.otherNatDetails !== undefined) {
      await this.setText(this.otherNatDetails, v.otherNatDetails);
    }
    await this.setAdibCustomer(v.adib);
  }

  // ── Submit + capture ─────────────────────────────────────────────────────

  /**
   * Click Confirm and capture the real /wallet_users/update call: HTTP status, the
   * submitted payload, and the server validationErrors (keyed by field). Asserting on
   * this — not on UI navigation — is the source of truth for whether the save passed.
   *
   * @returns {Promise<{status:number|null, payload:object|null, validationErrors:object,
   *                     firstField:string|null, firstMessage:string|null, body:string}>}
   */
  async submitAndCapture() {
    const respPromise = this.page
      .waitForResponse(r => r.url().includes(UPDATE_URL) && r.request().method() === 'POST', { timeout: 30_000 })
      .catch(() => null);

    await this.confirmButton.click();
    const resp = await respPromise;

    let status = null, payload = null, body = '', validationErrors = {};
    if (resp) {
      status = resp.status();
      try { payload = JSON.parse(resp.request().postData() || 'null'); } catch { /* ignore */ }
      try { body = await resp.text(); } catch { /* ignore */ }
      try { validationErrors = JSON.parse(body)?.errors?.validationErrors || {}; } catch { /* ignore */ }
    }
    const firstField   = Object.keys(validationErrors)[0] || null;
    const firstMessage = firstField ? (validationErrors[firstField]?.[0]?.message || null) : null;

    console.log(`[update] status=${status} field=${firstField || '-'} msg="${firstMessage || ''}"`);
    return { status, payload, validationErrors, firstField, firstMessage, body };
  }

  /** Submit and assert the save succeeded (HTTP 200). Returns the captured result. */
  async submitExpectSuccess() {
    const r = await this.submitAndCapture();
    expect(
      r.status,
      `Save should return 200. Got ${r.status}, validationErrors=${JSON.stringify(r.validationErrors)}`
    ).toBe(200);
    return r;
  }

  /**
   * Submit and assert the save was rejected (400) because of `field` with `messageRe`.
   * @param {string} field        e.g. 'occupation'
   * @param {RegExp} messageRe     e.g. /is required/i
   */
  async submitExpectFieldError(field, messageRe) {
    const r = await this.submitAndCapture();
    expect(r.status, `Save should be rejected with 400 for "${field}". Got ${r.status}`).toBe(400);
    expect(
      r.validationErrors[field],
      `Expected a validation error on "${field}". Got: ${JSON.stringify(r.validationErrors)}`
    ).toBeTruthy();
    expect(r.validationErrors[field][0].message).toMatch(messageRe);
    return r;
  }

  /** Read the inline error text rendered under a field's container (AC: "<field> is required"). */
  async inlineErrorFor(locator) {
    return locator.evaluate(el => {
      const group = el.closest('div')?.parentElement || el.closest('div');
      const txt = (group?.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
      return txt.find(t => /required|Arabic characters only|future date/i.test(t)) || '';
    });
  }

  // ── Date of Birth min-age (B10-55294) ───────────────────────────────────────
  // Story B10-55294 lowers the Edit-Customer birthdate minimum age from 16 to 15.
  // The birthdate is the first DD-MM-YYYY picker; filling it opens the calendar
  // overlay, which is dismissed the same way as setIssuingDate. The min-age rule is
  // enforced server-side on /wallet_users/update: a birthdate under the threshold
  // returns 400 with validationErrors.birthdate = "Birthdate indicates age is less
  // than 15 years." and the FE renders it inline under the field.

  /** Set the Date of Birth field (DD-MM-YYYY). Pass '' to clear. */
  async setDateOfBirth(value) {
    await this.dobInput.scrollIntoViewIfNeeded().catch(() => {});
    await this.dobInput.fill(value);
    await this.editHeading.click({ timeout: 5000 }).catch(() => {}); // dismiss the date-picker overlay
    await this.page.waitForTimeout(200);
  }

  /** Read the inline min-age error rendered under the Date of Birth field ('' if none). */
  async getDobInlineError() {
    return this.dobInput.evaluate(el => {
      const group = el.closest('div')?.parentElement || el.closest('div');
      const txt = (group?.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
      return txt.find(t => /age is less than|birthdate/i.test(t)) || '';
    });
  }

  /** Submit and assert the save succeeded (HTTP 200) — semantic alias used by DOB specs. */
  async saveExpectSuccess() {
    return this.submitExpectSuccess();
  }

  /**
   * Submit and assert the DOB save was rejected (400) with a birthdate min-age error.
   * Returns the captured result plus `dobMessage` (the birthdate validation message).
   */
  async saveExpectDobError() {
    const r = await this.submitAndCapture();
    expect(
      r.status,
      `DOB save should be rejected with 400. Got ${r.status}, validationErrors=${JSON.stringify(r.validationErrors)}`
    ).toBe(400);
    const dobMessage = r.validationErrors.birthdate?.[0]?.message || '';
    expect(
      dobMessage,
      `Expected a birthdate min-age error. validationErrors=${JSON.stringify(r.validationErrors)}`
    ).toBeTruthy();
    return { ...r, dobMessage };
  }
}

module.exports = EditCustomerPage;
