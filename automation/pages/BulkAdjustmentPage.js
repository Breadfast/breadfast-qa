'use strict';

const BasePage = require('./BasePage');

/**
 * Bulk Balance Adjustment page — Card Portal (#/agent/adjustment/bulk).
 * Story B10-55570: adds a "Supercard type" selector above the Upload → Count →
 * Confirmation → Complete stepper. The single chosen card applies to the whole batch.
 */
class BulkAdjustmentPage extends BasePage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    super(page);
    this.heading       = page.getByRole('heading', { name: 'Balance adjustment' });
    this.supercardType = page.getByRole('combobox', { name: 'Select card' });
    this.chooseFile    = page.getByRole('button', { name: 'Choose File' });
    this.fileInput     = page.locator('input[type="file"]');
    this.exportButton  = page.getByRole('button', { name: 'Export' });
    this.nextButton    = page.getByRole('button', { name: 'Next' });
    this.confirmButton = page.getByRole('button', { name: 'Confirm' });
    this.backButton    = page.getByRole('button', { name: 'Back' });
  }

  async open() {
    await this.goToUrl('/#/agent/adjustment/bulk');
    await this.waitForVisible(this.heading);
  }

  async getSupercardOptions() {
    await this.supercardType.click();
    const opts = this.page.getByRole('option');
    await opts.first().waitFor({ state: 'visible', timeout: this.DEFAULT_TIMEOUT });
    const labels = await opts.allInnerTexts();
    await this.page.keyboard.press('Escape');
    return labels.map((t) => t.trim()).filter(Boolean);
  }

  async selectCard(optionName) {
    const opt = this.page.getByRole('option', { name: optionName });
    await this.supercardType.click();
    try {
      await opt.waitFor({ state: 'visible', timeout: 5000 });
    } catch {
      await this.supercardType.click();
      await opt.waitFor({ state: 'visible', timeout: this.DEFAULT_TIMEOUT });
    }
    await opt.click();
  }

  async chooseBulkFile(absPath) {
    await this.fileInput.setInputFiles(absPath);
  }

  async isNextEnabled() {
    return this.nextButton.isEnabled();
  }

  async next()    { await this.nextButton.click(); }
  async confirm() { await this.confirmButton.click(); }
  async back()    { await this.backButton.click(); }

  // ── stepper flow ──────────────────────────────────────────────
  /** Read the Count step's Valid/Invalid record counts. */
  async getCount() {
    return this.page.evaluate(() => {
      const h = [...document.querySelectorAll('h2')].find((e) => e.textContent.trim() === 'Total Count');
      if (!h) return null;
      const txt = h.parentElement.innerText;
      const v = (txt.match(/Valid\s*:\s*(\d+)/) || [])[1];
      const i = (txt.match(/Invalid\s*:\s*(\d+)/) || [])[1];
      return { valid: Number(v), invalid: Number(i) };
    });
  }

  countHeading()        { return this.page.getByRole('heading', { name: 'Total Count' }); }
  confirmationHeading() { return this.page.getByRole('heading', { name: /Please confirm the transfer/i }); }
  completeMessage()     { return this.page.getByText(/Bulk adjustment processed/i); }
  async getConfirmationText() { return (await this.confirmationHeading().innerText()).trim(); }

  /** Select card (optional) + choose file, then advance Upload->Count. */
  async uploadToCount({ card, file }) {
    if (card != null) await this.selectCard(card);
    await this.chooseBulkFile(file);
    await this.waitForVisible(this.nextButton);
    await this.nextButton.click();
    await this.countHeading().waitFor({ state: 'visible', timeout: this.DEFAULT_TIMEOUT });
  }

  /** From the Count step, advance to the Confirmation step. */
  async countToConfirmation() {
    await this.nextButton.click();
    await this.confirmationHeading().waitFor({ state: 'visible', timeout: this.DEFAULT_TIMEOUT });
  }

  /** From the Confirmation step, Confirm and wait for the Complete message. */
  async confirmBatch() {
    await this.confirmButton.click();
    await this.completeMessage().waitFor({ state: 'visible', timeout: this.DEFAULT_TIMEOUT });
  }
}

module.exports = BulkAdjustmentPage;
