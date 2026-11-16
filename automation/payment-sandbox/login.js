'use strict';

/**
 * Sign in to the testing payment sandbox with an @breadfast.com Google account and save the session for
 * send_advice.js. Opens a visible browser on /auth/signin, waits up to 10 minutes for the sign-in to finish,
 * then writes the Playwright storageState to the gitignored .auth/payment-sandbox-auth.json.
 * The session expires daily, so run this again when send_advice.js answers 401.
 *
 * Usage: node automation/payment-sandbox/login.js
 */
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.PAYMENT_SANDBOX_URL || 'https://payment-sandbox-testing.breadfast.tech';
const SESSION = path.resolve(__dirname, '..', '..', '.auth', 'payment-sandbox-auth.json');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/auth/signin`);
  const end = Date.now() + 10 * 60 * 1000;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await ctx.request.get(`${BASE}/`, { failOnStatusCode: false }).catch(() => null);
    if (res && res.status() !== 401) {
      await ctx.storageState({ path: SESSION });
      console.log('SIGNED IN', res.status(), '->', SESSION);
      await browser.close();
      return;
    }
  }
  console.log('TIMEOUT: no sign-in within 10 minutes');
  await browser.close();
  process.exit(1);
})();
