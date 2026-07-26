'use strict';

/**
 * PerkDetailsPage — Card Admin Panel  (#/perks/<id> detail view)
 *
 * NEW page object for B10-56759 (Perk Details lifecycle management: header
 * Delete + Edit buttons, status-aware button state, and status/type-aware
 * EDIT mode). No detail-page POM existed before this story.
 *
 * REUSE-BEFORE-BUILD (CLAUDE.md §1):
 *   - Navigation to a specific perk's detail page reuses the existing
 *     PerksPage table methods (goToPerksTable / getColumnValues /
 *     clickViewAction) via a composed PerksPage instance (`this.perks`).
 *   - The delete-confirmation modal is NOT re-declared here — clickDelete()
 *     opens it and the confirm/cancel/read flow delegates to PerksPage's
 *     existing delete-modal methods (deleteConfirmDialog / isDeleteDialogVisible
 *     / getDeleteDialogText / confirmDeleteAndCapture / cancelDeleteDialog),
 *     which operate on the same page and modal selector.
 *   - Edit-mode field-state reading lives on PerksPage as an extension
 *     (isFieldEditable / isFieldLocked / getEditableFieldMatrix) so the
 *     already-declared controlname/formcontrolname selectors stay the single
 *     source of truth. This page object only owns the DETAIL HEADER.
 *
 * ── SELECTOR PROVENANCE (read before editing) ──────────────────────────────
 * The live Perk Details header + edit-mode locked-field markers could NOT be
 * captured while authoring this POM (same card-panel-testing backend outage
 * that blocked the B10-56757 table capture — POST /card/perks/list 502). The
 * header Delete/Edit locators here are grounded in (a) the story's exported
 * Figma "Perk Details" frames (node-id 5893-378873 — a header with a magenta
 * "Delete" button + an "Edit" button, dimmed per status) and (b) the portal's
 * proven Angular Material button conventions already used across PerksPage.
 * They are made tolerant (role/text + header-region scoping) and MUST be
 * re-confirmed against the live detail DOM once the backend recovers, then
 * tightened. Same open-dependency pattern as the B10-56757 table block.
 */

const { expect } = require('@playwright/test');
const BasePage = require('./BasePage');
const PerksPage = require('./PerksPage');

class PerkDetailsPage extends BasePage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    super(page);

    // Composed PerksPage — reused for table navigation + the delete modal.
    this.perks = new PerksPage(page);

    // ── Detail-page header ──────────────────────────────────────────────
    // The header is the toolbar/region above the perk form holding the two
    // lifecycle actions. Scope button lookups to that region where possible so
    // an "Edit"/"Delete" text elsewhere on the page can't be mistaken for the
    // header control; fall back to the first page-level match otherwise.
    this.header = page
      .locator('mat-toolbar, .page-header, .detail-header, .card-header, header')
      .first();
    this.deleteButton = this.header
      .locator('button:has-text("Delete")')
      .first()
      .or(page.locator('button:has-text("Delete")').first());
    this.editButton = this.header
      .locator('button:has-text("Edit")')
      .first()
      .or(page.locator('button:has-text("Edit")').first());

    // Perk-type control (locked in every edit mode — AC-05/24). Reuses the
    // create-form selector so it stays the single source of truth.
    this.perkTypeSelect = page.locator('mat-select[formcontrolname="type"]');
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  /**
   * Open the detail page of the first perk matching a status (and optionally a
   * perk type) by driving the existing perks TABLE: apply no filter, read the
   * Status/Type columns, and click that row's "View" action. Returns whether a
   * matching perk was found & opened so specs can `test.skip` cleanly when the
   * required fixture is absent in the environment (mirrors B10-56757's
   * status-driven row selection — no forced status transition needed).
   *
   * @param {string} status         'planned' | 'active' | 'expired'
   * @param {string} [type]         optional Type-column filter, e.g. 'coupon'
   * @returns {Promise<{opened:boolean, index:number}>}
   */
  async openPerkByStatus(status, type) {
    await this.perks.goToPerksTable();
    const index = await this._findRowIndex(status, type);
    if (index < 0) return { opened: false, index: -1 };
    await this.perks.clickViewAction(index);
    // Detail routes off the list (#/perks) to a per-perk URL (#/perks/<id>/…).
    await this.page.waitForURL(/#\/perks\/.+/, { timeout: 15_000 }).catch(() => {});
    return { opened: true, index };
  }

  /**
   * Open the detail page of the perk whose Title column contains `title` by
   * driving the perks TABLE. Used by B10-56759 specs to open the EXACT fixture
   * they created via ApiHelper.createPerk (so a destructive delete or a save
   * re-open acts on the right perk, not an arbitrary same-status row). Reloads
   * the table once if the freshly-created perk is not on the first render.
   * @param {string} title
   * @returns {Promise<{opened:boolean, index:number}>}
   */
  async openPerkByTitle(title) {
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.perks.goToPerksTable();
      const titles = await this.perks.getColumnValues('Title');
      const index = titles.findIndex((t) => (t || '').includes(title));
      if (index >= 0) {
        await this.perks.clickViewAction(index);
        await this.page.waitForURL(/#\/perks\/.+/, { timeout: 15_000 }).catch(() => {});
        return { opened: true, index };
      }
    }
    return { opened: false, index: -1 };
  }

  /** Index of the first table row matching status (+ optional type); −1 if none. */
  async _findRowIndex(status, type) {
    const statuses = await this.perks.getColumnValues('Status');
    const types    = type ? await this.perks.getColumnValues('Type') : null;
    for (let i = 0; i < statuses.length; i++) {
      if (!new RegExp(status, 'i').test(statuses[i])) continue;
      if (types && !new RegExp(type, 'i').test(types[i] || '')) continue;
      return i;
    }
    return -1;
  }

  // ── Header button presence / state ──────────────────────────────────────────

  /** True if a Delete button is rendered in the detail header (AC-01). */
  async isDeleteButtonPresent() {
    return this.deleteButton.isVisible({ timeout: 8_000 }).catch(() => false);
  }

  /** True if an Edit button is rendered in the detail header (AC-01). */
  async isEditButtonPresent() {
    return this.editButton.isVisible({ timeout: 8_000 }).catch(() => false);
  }

  /**
   * Whether a header button is interactive (NOT dimmed / disabled). Reads the
   * same signals used for the table Delete gating: disabled / aria-disabled /
   * disabled class / pointer-events:none / low opacity (AC-02/03/04).
   * @param {import('@playwright/test').Locator} button
   */
  async _isButtonInteractive(button) {
    if (!(await button.isVisible({ timeout: 5_000 }).catch(() => false))) return false;
    return button
      .evaluate((el) => {
        const cs = getComputedStyle(el);
        const disabledAttr = el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
        const cls = typeof el.className === 'string' ? el.className : '';
        const disabledClass = /disabled|dimmed|greyed|grayed/i.test(cls);
        const pe  = cs.pointerEvents === 'none';
        const dim = parseFloat(cs.opacity || '1') < 0.6;
        return !(disabledAttr || disabledClass || pe || dim);
      })
      .then((interactive) => interactive)
      .catch(() => false);
  }

  /** True when the header Delete button is active/clickable (AC-02 Planned). */
  async isDeleteButtonEnabled() {
    return this._isButtonInteractive(this.deleteButton);
  }

  /** True when the header Edit button is active/clickable (AC-05 Planned/Active). */
  async isEditButtonEnabled() {
    return this._isButtonInteractive(this.editButton);
  }

  /**
   * Read the Delete button's rendered text + background colour and classify it
   * as "magenta" (AC-02). Magenta = strong red & blue channels with a clearly
   * lower green channel (distinguishes it from grey/blue/red). Returns the raw
   * colour strings so a spec can attach them as evidence when the heuristic and
   * the Figma frame disagree. @returns {Promise<{color:string, background:string, isMagenta:boolean}>}
   */
  async getDeleteButtonStyle() {
    if (!(await this.deleteButton.isVisible({ timeout: 5_000 }).catch(() => false))) {
      return { color: '', background: '', isMagenta: false };
    }
    const raw = await this.deleteButton
      .evaluate((el) => {
        const cs = getComputedStyle(el);
        return { color: cs.color, background: cs.backgroundColor };
      })
      .catch(() => ({ color: '', background: '' }));

    const isMagenta = (rgb) => {
      const m = /rgba?\(([^)]+)\)/.exec(rgb || '');
      if (!m) return false;
      const [r, g, b] = m[1].split(',').map((n) => parseFloat(n));
      // magenta/pink: red & blue elevated, green clearly the lowest channel.
      return r > 120 && b > 60 && g < r - 40 && g < b + 20 && !(Math.abs(r - g) < 25 && Math.abs(g - b) < 25);
    };
    return {
      color: raw.color,
      background: raw.background,
      isMagenta: isMagenta(raw.background) || isMagenta(raw.color),
    };
  }

  // ── Delete flow (delegates to PerksPage's existing delete modal) ────────────

  /** Click the header Delete button (AC-02). */
  async clickDelete() {
    await this.deleteButton.click();
    await this.page.waitForTimeout(400);
  }

  /**
   * AC-03 — attempt to click Delete on a status where it should be
   * non-interactive and report whether ANY confirmation prompt appeared. A
   * dimmed button that swallows the click (pointer-events:none) leaves the
   * modal closed; { force:true } bypasses actionability so we truly exercise
   * "the click does nothing". @returns {Promise<{promptShown:boolean}>}
   */
  async attemptDeleteExpectNoPrompt() {
    await this.deleteButton.click({ force: true, timeout: 5_000 }).catch(() => {});
    await this.page.waitForTimeout(600);
    return { promptShown: await this.perks.isDeleteDialogVisible() };
  }

  // ── Edit mode ───────────────────────────────────────────────────────────────

  /** Click the header Edit button to enter edit mode (AC-05/06). */
  async clickEdit() {
    await this.editButton.click();
    await this.page.waitForTimeout(800);
  }

  /**
   * AC-04 — attempt to click a dimmed Edit button and report whether edit mode
   * was entered (it must NOT be). Uses force to bypass actionability so a
   * pointer-events:none button is genuinely clicked-through.
   * @returns {Promise<{enteredEditMode:boolean}>}
   */
  async attemptEditExpectNoEditMode() {
    await this.editButton.click({ force: true, timeout: 5_000 }).catch(() => {});
    await this.page.waitForTimeout(800);
    return { enteredEditMode: await this.isInEditMode() };
  }

  /**
   * True once the perk has opened in edit mode — detected by the creation-form
   * title field becoming an editable input, or a Save/Update action appearing.
   * (The detail READ view renders titles as static text, not inputs.)
   */
  async isInEditMode() {
    const titleInput = this.page.locator('app-bf-input[controlname="title_en"] input');
    if (await titleInput.isVisible({ timeout: 5_000 }).catch(() => false)) return true;
    return this.page
      .locator('button:has-text("Save"), button:has-text("Update"), button:has-text("Preview & Save")')
      .first()
      .isVisible({ timeout: 2_000 })
      .catch(() => false);
  }

  /** True if the Perk type control is locked/read-only in edit mode (AC-05/24). */
  async isPerkTypeLocked() {
    return this.perks.isFieldLocked('type');
  }

  /**
   * Best-effort read of the perk's status as shown on the detail page (AC-14).
   * Status is rendered as a badge/chip; returns '' when not found (spec then
   * skips the before/after comparison rather than asserting on nothing).
   */
  async getDisplayedStatus() {
    const badge = this.page
      .locator('.status, .badge, mat-chip, [class*="status"]')
      .filter({ hasText: /planned|active|expired/i })
      .first();
    if (!(await badge.isVisible({ timeout: 3_000 }).catch(() => false))) return '';
    return ((await badge.innerText().catch(() => '')) || '').trim();
  }

  /**
   * Best-effort read of the perk's start date value on the detail page (AC-14).
   * Start date is not an editable field in Active edit mode, so it may render as
   * static text or a read-only input; returns '' when not found.
   */
  async getStartDateValue() {
    const field = this.perks._fieldByLabel(/start date/i);
    const val = await field
      .first()
      .evaluate((el) => (el.value !== undefined ? el.value : el.textContent) || '')
      .catch(() => '');
    return (val || '').trim();
  }

  /** Assert both header lifecycle buttons are present (AC-01 helper). */
  async expectBothHeaderButtons() {
    expect(await this.isDeleteButtonPresent(), 'Delete button present in header').toBe(true);
    expect(await this.isEditButtonPresent(), 'Edit button present in header').toBe(true);
  }
}

module.exports = PerkDetailsPage;
