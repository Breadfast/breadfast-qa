'use strict';

class BasePage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page            = page;
    this.DEFAULT_TIMEOUT = 60000;
  }

  async waitForVisible(locator) {
    await locator.waitFor({ state: 'visible', timeout: this.DEFAULT_TIMEOUT });
  }

  async isElementDisplayed(locator) {
    try {
      await locator.waitFor({ state: 'visible', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  async goToUrl(url) {
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
}

module.exports = BasePage;
