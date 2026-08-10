'use strict';

/**
 * Records a screen video of bug B10-56609 reproduction.
 *
 * Flow (Card Admin Panel — Create General Spend Cashback perk):
 *   1. Fill all required fields.
 *   2. Select elaraby (190) + Breadfast Coffee (16) = 206 MIDs (> 200).
 *   3. Preview & Save → save → server rejects (HTTP 400, > 200) → Cancel.
 *   4. Deselect Breadfast Coffee → UI now shows only elaraby (190 MIDs, < 200).
 *   5. Preview & Save → save again → STILL rejected because the stale 206-MID
 *      list is re-submitted instead of the corrected 190-MID list (the bug).
 *
 * Output: a .webm video saved under ./videos/ — path printed at the end.
 *
 * Run:  node record_bug_b10_56609.js
 */

const { chromium } = require('@playwright/test');
const path   = require('path');
const config = require('../helpers/ConfigReader');
const LoginPage = require('../pages/LoginPage');
const PerksPage = require('../pages/PerksPage');

const VIDEO_DIR = path.join(__dirname, 'videos');

async function main() {
  const browser = await chromium.launch({ slowMo: 350 }); // slowMo makes the video watchable
  const context = await browser.newContext({
    baseURL: config.getCardServicesAdminPanelBaseURL(),
    viewport: { width: 1366, height: 900 },
    recordVideo: { dir: VIDEO_DIR, size: { width: 1366, height: 900 } },
  });
  const page = await context.newPage();

  // Log every create call so the video timeline lines up with the payload sizes
  page.on('response', (resp) => {
    if (resp.url().includes('/card/perks/create')) {
      let midCount = '?';
      try {
        const body = JSON.parse(resp.request().postData() || '{}');
        midCount = (body?.perk_attributes?.excluded_merchants_ids || []).length;
      } catch { /* ignore */ }
      console.log(`[B10-56609] create -> HTTP ${resp.status()}, MIDs sent=${midCount}`);
    }
  });

  try {
    const login = new LoginPage(page);
    await login.fillLoginFormAndSubmit(config.getAdminUserName(), config.getAdminPassword());

    const perks = new PerksPage(page);
    await perks.goToPerksPage();
    await perks.clickAddPerk();
    await perks.selectGeneralSpendCashbackType();
    await perks.fillMandatoryFields({ titleEn: 'B10-56609 Repro — MID desync' });

    // Step 1 — over-limit selection (206 MIDs)
    await perks.selectMerchantsByName(['elaraby', 'Breadfast Coffee']);
    await page.waitForTimeout(1200);

    // Step 2 — submit → rejected (> 200) → Cancel the preview
    await perks.submitPerkExpectFailure();
    await page.waitForTimeout(1500);

    // Step 3 — correct the selection: deselect Breadfast Coffee → only elaraby (190) remains
    await perks.deselectMerchantsByName(['Breadfast Coffee']);
    await page.waitForTimeout(1500);

    // Step 4 — re-save; with the UI showing 190 MIDs the save SHOULD succeed,
    // but the stale 206-MID list is re-submitted and it is rejected again (the bug).
    await perks.submitPerkExpectSuccess().catch((e) => {
      console.log(`[B10-56609] second save did NOT succeed (expected — this is the bug): ${e.message}`);
    });
    await page.waitForTimeout(2000);
  } finally {
    await context.close();   // finalizes the video file
    const videoPath = await page.video().path().catch(() => null);
    await browser.close();
    console.log(`\nVIDEO_SAVED: ${videoPath}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
