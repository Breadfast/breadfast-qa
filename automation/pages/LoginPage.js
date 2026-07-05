'use strict';

const BasePage = require('./BasePage');

class LoginPage extends BasePage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    super(page);
    this.usernameField = page.locator('input[placeholder="Username Name"]');
    this.passwordField = page.locator('input[type="password"]');
    this.submitButton  = page.locator('button[type="submit"]');
  }

  async fillLoginFormAndSubmit(username, password) {
    await this.goToUrl('/#/pages/login');
    await this.waitForVisible(this.usernameField);
    await this.usernameField.fill(username);
    await this.passwordField.fill(password);
    await this.submitButton.click();
    await this.page.waitForURL('**/#/dashboard', { timeout: 30000 });
    await this.page.waitForTimeout(1000);
  }
}

module.exports = LoginPage;
