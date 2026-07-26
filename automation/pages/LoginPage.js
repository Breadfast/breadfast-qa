'use strict';

const BasePage = require('./BasePage');
const config   = require('../helpers/ConfigReader');

class LoginPage extends BasePage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    super(page);
    this.usernameField = page.locator('input[placeholder="Username Name"]');
    this.passwordField = page.locator('input[type="password"]');
    this.submitButton  = page.locator('button[type="submit"]');
  }

  async fillLoginFormAndSubmit(username, password) {
    // Build an absolute URL from config so login works regardless of cwd /
    // whether Playwright loaded the story config's baseURL. A relative goto
    // throws "Cannot navigate to invalid URL" when baseURL is unset (e.g. the
    // run was launched from the repo root instead of the story folder).
    const baseURL = config.getCardServicesAdminPanelBaseURL().replace(/\/+$/, '');
    await this.goToUrl(`${baseURL}/#/pages/login`);
    await this.waitForVisible(this.usernameField);
    await this.usernameField.fill(username);
    await this.passwordField.fill(password);
    await this.submitButton.click();
    await this.page.waitForURL('**/#/dashboard', { timeout: 30000 });
    await this.page.waitForTimeout(1000);
  }
}

module.exports = LoginPage;
