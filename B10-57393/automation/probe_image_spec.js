'use strict';

/**
 * B10-57393 — settle the TC-53973 disagreement between the two stacks.
 *
 * Selenium FAILS the case ("a 240x180 logo was accepted into the 1080x1080 Cover photo slot, so
 * image-spec validation regressed"); Playwright PASSES it. They disagree because they detect
 * "rejected" differently:
 *   Java       : rejected  <=> dialog still open AND its text contains "invalid"
 *   Playwright : rejected  <=> dialog still open showing the untouched drop-zone prompt
 * If the panel rejects SILENTLY, the Java detector cannot tell rejection from acceptance — both
 * roads lead to "accepted" — so its verdict would be an artefact, not a defect.
 *
 * Neither harness checks the fact that actually decides it: **is the slot filled afterwards?**
 * A filled slot renders an "Image Preview" img and loses its "Add image" button. This probe reads
 * that directly, for a wrong-sized image and (as a control) for a correct one.
 *
 * Usage: node probe_image_spec.js
 */
const { chromium } = require('@playwright/test');
const path = require('path');

const LoginPage = require('../../automation/pages/LoginPage');
const PerksPage = require('../../automation/pages/PerksPage');
const config = require('../../automation/helpers/ConfigReader');

const PHOTOS = PerksPage.PHOTOS;
const OUT = path.resolve(__dirname, '..', 'execution-reports', 'probe_image_spec.json');

/** Everything that distinguishes "accepted" from "silently rejected", read in one pass. */
async function readState(page) {
  const dialog = page.locator('mat-dialog-container');
  const open = await dialog.isVisible().catch(() => false);
  return {
    dialogOpen: open,
    dialogText: open ? ((await dialog.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim().slice(0, 300) : '',
    dialogMentionsInvalid: open ? /invalid/i.test(await dialog.innerText().catch(() => '')) : false,
    addImageButtonsLeft: await page.locator("button:has-text('Add Image')").count(),
    filledSlots: await page.locator('img[alt="Image Preview"]').count(),
  };
}

/**
 * Watch the WHOLE document for any toast/snackbar/error surface for `totalMs`.
 *
 * Document-wide and polled, deliberately. A Material snack-bar renders in .cdk-overlay-container as
 * a SIBLING of mat-dialog-container, so a check scoped to the dialog — which is what both JS upload
 * helpers and the first version of this probe did — cannot see it. And a toast that auto-dismisses
 * is invisible to a single read taken at the wrong moment, so every 250 ms is sampled and the union
 * of everything seen is reported.
 */
async function watchForToast(page, { totalMs = 10_000, stepMs = 250 } = {}) {
  const seen = new Map();
  for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
    const found = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll(
        '.cdk-overlay-container .mat-snack-bar-container, snack-bar-container, simple-snack-bar,'
        + ' .mat-mdc-snack-bar-container, .toast, .toast-container, [class*="toastr"],'
        + ' [class*="notification"], [role="alert"], [role="status"], [aria-live]'
      )];
      return nodes.map((n) => (n.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    }).catch(() => []);
    for (const text of found) if (!seen.has(text)) seen.set(text, elapsed);
    await page.waitForTimeout(stepMs);
  }
  return [...seen.entries()].map(([text, atMs]) => ({ atMs, text: text.slice(0, 300) }));
}

/** Any text anywhere on the page that looks like it is telling the admin about the image spec. */
async function specMessagesOnPage(page) {
  return page.evaluate(() => [...document.querySelectorAll('body *')]
    .filter((el) => el.children.length === 0)
    .map((el) => (el.innerText || '').replace(/\s+/g, ' ').trim())
    .filter((t) => t && /invalid|1080|resolution|aspect ratio|max size|not supported|too large/i.test(t))
    .filter((t, i, all) => all.indexOf(t) === i)
    .slice(0, 15)).catch(() => []);
}

async function attempt(page, perks, label, imagePath) {
  const before = await readState(page);
  await perks.addImageButtons.nth(0).click();
  const dialog = page.locator('mat-dialog-container');
  await dialog.waitFor({ state: 'visible', timeout: 8_000 });
  await page.waitForTimeout(400);
  await dialog.locator('input[type="file"]').setInputFiles(imagePath);
  // Start watching BEFORE the state read, so an auto-dismissing toast cannot slip through the gap.
  const toasts = await watchForToast(page, { totalMs: 10_000, stepMs: 250 });
  const specTextOnPage = await specMessagesOnPage(page);
  const after = await readState(page);

  // Close the dialog if it stayed open, so the next attempt starts clean.
  if (after.dialogOpen) {
    const close = dialog.locator('mat-icon:has-text("close")').first();
    if (await close.isVisible().catch(() => false)) await close.click();
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
  }
  const settled = await readState(page);

  return {
    label,
    image: path.basename(imagePath),
    before: { addImageButtonsLeft: before.addImageButtonsLeft, filledSlots: before.filledSlots },
    after,
    settled: { addImageButtonsLeft: settled.addImageButtonsLeft, filledSlots: settled.filledSlots },
    // The verdict that neither harness reads: did the slot actually take the file?
    slotFilled: settled.filledSlots > before.filledSlots,
    // Was the admin TOLD anything? Watched document-wide, so a toast outside the dialog counts.
    toasts,
    anyToastShown: toasts.length > 0,
    specTextOnPage,
  };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  // baseURL must be set here — the page objects navigate with relative paths ('/#/perks'), which
  // the specs get from playwright.config.js. A standalone script has no config, so without this
  // every goto fails with "Cannot navigate to invalid URL".
  const page = await browser.newContext({
    baseURL: config.getCardServicesAdminPanelBaseURL(),
    viewport: { width: 1600, height: 1000 },
  }).then((c) => c.newPage());
  const result = { ticket: 'B10-57393', case: 'TC-53973', startedAt: new Date().toISOString(), attempts: [] };

  try {
    await new LoginPage(page).fillLoginFormAndSubmit(config.getAdminUserName(), config.getAdminPassword());
    const perks = new PerksPage(page);
    await perks.goToPerksPage();
    await perks.clickAddPerk();
    await perks.selectPerkTypeByName('Merchant cashback');

    // 1) the wrong-sized image the two stacks disagree about: a 240x180 logo into Cover photo EN
    result.attempts.push(await attempt(page, perks, 'wrong size (240x180 logo) into Cover photo EN', PHOTOS.logoSpec));
    // 2) control: the correct 1080x1080 cover into the same slot must be ACCEPTED
    result.attempts.push(await attempt(page, perks, 'correct size (1080x1080 cover) into Cover photo EN', PHOTOS.coverSpec));

    const wrong = result.attempts[0];
    const right = result.attempts[1];
    result.verdict = !wrong.slotFilled && right.slotFilled
      ? 'VALIDATION WORKS — the wrong-sized image did not fill the slot, the correct one did.'
      : wrong.slotFilled
        ? 'REAL DEFECT — the wrong-sized image filled the Cover photo slot.'
        : 'INCONCLUSIVE — the control image did not fill the slot either; the probe itself is suspect.';
    // The UX question, kept separate from the validation question: was the admin told anything at
    // all? Expected behaviour per QA: a toaster naming the required 1080*1080 spec.
    result.feedbackVerdict = wrong.anyToastShown
      ? 'FEEDBACK SHOWN — ' + JSON.stringify(wrong.toasts)
      : 'NO FEEDBACK — no toast/snackbar/alert anywhere in the document across 40 samples over 10s.';
    result.silentRejection = !wrong.slotFilled && !wrong.anyToastShown;
  } catch (err) {
    result.error = String(err.message || err).slice(0, 400);
  } finally {
    await browser.close();
  }

  require('fs').writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
})();
