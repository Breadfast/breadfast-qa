'use strict';

const BasePage = require('./BasePage');

/**
 * Single Balance Adjustment page — Card Portal (#/agent/adjustment/single).
 * Story B10-55570: adds the "Supercard type" selector + field rename to "Adjustment Type".
 * Comboboxes are ng-select style: click to open, then click the option by name.
 */
class SingleAdjustmentPage extends BasePage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    super(page);
    this.heading        = page.getByRole('heading', { name: 'Balance Adjustment' });
    this.bcidField      = page.getByRole('textbox', { name: 'BCID' });
    this.amountField    = page.getByRole('textbox', { name: 'Amount' });
    this.notesField     = page.getByRole('textbox', { name: 'Notes' });
    this.adjustmentType = page.getByRole('combobox', { name: 'Adjustment Type' });
    this.supercardType  = page.getByRole('combobox', { name: 'Supercard type' });
    this.submitButton   = page.getByRole('button', { name: 'Submit' });
    this.cardValidation = page.getByText('Select a card', { exact: false });
    // confirm dialog
    this.dialog         = page.getByRole('dialog');
    this.confirmButton  = page.getByRole('button', { name: 'Confirm' });
    this.cancelButton   = page.getByRole('button', { name: 'Cancel' });
  }

  async open() {
    await this.goToUrl('/#/agent/adjustment/single');
    await this.waitForVisible(this.heading);
  }

  async _selectOption(combobox, optionName) {
    const opt = this.page.getByRole('option', { name: optionName });
    await combobox.click();
    try {
      await opt.waitFor({ state: 'visible', timeout: 5000 });
    } catch {
      await combobox.click(); // re-open if the first click was swallowed
      await opt.waitFor({ state: 'visible', timeout: this.DEFAULT_TIMEOUT });
    }
    await opt.click();
  }

  /** Returns the option labels available in the Supercard type dropdown. */
  async getSupercardOptions() {
    await this.supercardType.click();
    const opts = this.page.getByRole('option');
    await opts.first().waitFor({ state: 'visible', timeout: this.DEFAULT_TIMEOUT });
    const labels = await opts.allInnerTexts();
    await this.page.keyboard.press('Escape');
    return labels.map((t) => t.trim()).filter(Boolean);
  }

  async getAdjustmentTypeOptions() {
    await this.adjustmentType.click();
    const opts = this.page.getByRole('option');
    await opts.first().waitFor({ state: 'visible', timeout: this.DEFAULT_TIMEOUT });
    const labels = await opts.allInnerTexts();
    await this.page.keyboard.press('Escape');
    return labels.map((t) => t.trim()).filter(Boolean);
  }

  async fill({ bcid, type, amount, card, notes }) {
    if (bcid != null)   await this.bcidField.fill(String(bcid));
    if (type != null)   await this._selectOption(this.adjustmentType, type);
    if (amount != null) await this.amountField.fill(String(amount));
    if (card != null)   await this._selectOption(this.supercardType, card);
    if (notes != null)  await this.notesField.fill(String(notes));
  }

  async submit() { await this.submitButton.click(); }

  /** Read the value rows shown in the Confirm Balance Adjustment dialog. */
  async getDialogSupercard() {
    return (await this.dialog.getByText('Super Card', { exact: false })
      .locator('xpath=following-sibling::*[1]').innerText().catch(() => '')).trim();
  }

  async confirm() { await this.confirmButton.click(); }
  async cancel()  { await this.cancelButton.click(); }
}

module.exports = SingleAdjustmentPage;
