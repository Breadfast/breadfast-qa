'use strict';

/**
 * B10-56337 — CERTIFICATION visual-parity suite (first-class).
 *
 * Drives each screen/state, captures the actual Playwright screenshot, exports the matching Figma
 * frame (file tvvGnEaxVjJvMWOTl4zjZC node 1-211, scale=2) via VisualComparisonHelper, and emits
 * Actual / Expected / side-by-side artifacts plus a coverage-matrix index.html for the story report.
 *
 * Screens covered: Popup 1 (default / dropdown open / store selected with Branch ID), the store
 * "This field is required." error, the "You have to insert mandatory customer details" error,
 * Popup 2 package-number entry, and the rendered generated KYC A4 PDF.
 *
 * The verdict per screen defaults to REVIEW (reviewer's visual judgement in the report); the test
 * asserts the artifacts were reliably produced. Figma export degrades gracefully without a token.
 */

const path = require('path');
const fs   = require('fs');
const FW = process.env.BF_AUTOMATION_DIR || path.resolve(__dirname, '..', '..');

const { test, expect }        = require('@playwright/test');
const config                  = require(path.join(FW, 'helpers', 'ConfigReader'));
const CardUserFactory         = require(path.join(FW, 'helpers', 'CardUserFactory'));
const VisualComparisonHelper  = require(path.join(FW, 'helpers', 'VisualComparisonHelper'));
const LoginPage               = require(path.join(FW, 'pages', 'LoginPage'));
const EditCustomerPage        = require(path.join(FW, 'pages', 'EditCustomerPage'));
const CollectDialogPage       = require(path.join(FW, 'pages', 'CollectDialogPage'));

const STORE = 'Breadfast Coffee city';
const VISUAL_DIR   = path.resolve(__dirname, '../../../B10-56337/evidence/visual');
const EVIDENCE_DIR = path.resolve(__dirname, '../../../B10-56337/evidence');

const factory = new CardUserFactory();

test('Figma visual parity across all B10-56337 screens and the generated KYC PDF TC-50661', async ({ page }) => {
  await new LoginPage(page).fillLoginFormAndSubmit(config.getAdminUserName(), config.getAdminPassword());

  const visual = new VisualComparisonHelper({ outDir: VISUAL_DIR });
  const incomplete = await factory.provision();      // Registered, no KYC → error/popup-1 states
  const complete   = await factory.provision();      // completed KYC → popup 2 + PDF
  console.log(`[provision] visual users incomplete=${incomplete.phone} complete=${complete.phone}`);

  try {
    const edit = new EditCustomerPage(page);
    const collect = new CollectDialogPage(page);

    await test.step('Popup 1 — default (store not selected)', async () => {
      await edit.openCustomerView(incomplete.searchMobile);
      await collect.openCollect();
      await visual.compareScreen(page, 'Popup 1 - default (no store)');
    });

    await test.step('Popup 1 — Store Location dropdown open', async () => {
      await collect.storeCombobox.click();
      await page.waitForTimeout(400);
      await visual.compareScreen(page, 'Popup 1 - dropdown open');
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(200);
    });

    await test.step('Popup 1 — store selected with Branch ID', async () => {
      await collect.selectStore(STORE);
      await visual.compareScreen(page, 'Popup 1 - store selected with branch');
    });

    await test.step('Popup 1 — "This field is required." (store)', async () => {
      await edit.openCustomerView(incomplete.searchMobile);
      await collect.openCollect();
      await collect.touchStoreWithoutSelecting();
      await visual.compareScreen(page, 'Popup 1 - store required error');
    });

    await test.step('Popup 1 — "You have to insert mandatory customer details"', async () => {
      await collect.selectStore(STORE);
      await collect.printAndCapture(); // 400 for incomplete KYC; error renders on Popup 1
      await visual.compareScreen(page, 'Popup 1 - insert mandatory customer details');
    });

    await test.step('Popup 2 — package-number entry', async () => {
      await edit.openCustomerEdit(complete.searchMobile);
      await edit.fillAllValid();
      await edit.submitExpectSuccess();
      await edit.openCustomerView(complete.searchMobile);
      await collect.openCollect();
      await collect.selectStore(STORE);
      await collect.continueWithoutPrinting();
      await expect(collect.packageInput).toBeVisible();
      await visual.compareScreen(page, 'Popup 2 - package number entry');
    });

    await test.step('Generated KYC A4 PDF (rendered)', async () => {
      // collect the customer so the non-consuming header print is available, then render the PDF
      let recv = null, pkg = null;
      for (let i = 0; i < 5; i++) {
        pkg = await factory.claimPackageFromPool();
        recv = await factory.collectViaApi(complete.searchMobile, pkg);
        if (recv.status === 200) break;
        if (recv.status === 400 && /already assigned/i.test(recv.message)) continue;
        break;
      }
      expect(recv.status, `/received should succeed. msg="${recv && recv.message}"`).toBe(200);

      await edit.openCustomerView(complete.searchMobile);
      const r = await collect.printKycFromHeaderAndCapture();
      expect(r.status, 'PDF generation should succeed').toBe(200);
      fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
      const pdfPath = path.join(EVIDENCE_DIR, `kyc_visual_${complete.localPhone}.pdf`);
      fs.writeFileSync(pdfPath, r.body);
      await page.goto('file://' + pdfPath.replace(/\\/g, '/'), { waitUntil: 'load' });
      await page.waitForTimeout(1500); // let the Chromium PDF viewer render
      await visual.compareScreen(page, 'Generated KYC A4 PDF', { fullPage: true });
    });

    await test.step('Write the visual coverage matrix + manifest and verify all artifacts', async () => {
      const report = visual.writeReport();
      console.log(`[visual] wrote ${report.count} screens → ${report.indexPath}`);
      expect(report.count, 'all screens captured').toBe(7);
      for (const rec of visual.records) {
        const actualPath = path.join(VISUAL_DIR, rec.actual);
        expect(fs.existsSync(actualPath), `actual screenshot exists for "${rec.screen}"`).toBe(true);
        expect(fs.statSync(actualPath).size, `actual screenshot non-trivial for "${rec.screen}"`).toBeGreaterThan(1000);
        expect(fs.existsSync(path.join(VISUAL_DIR, rec.sideBySide)), `side-by-side page for "${rec.screen}"`).toBe(true);
        if (rec.expected) {
          expect(fs.statSync(path.join(VISUAL_DIR, rec.expected)).size, `Figma expected non-trivial for "${rec.screen}"`).toBeGreaterThan(1000);
        }
      }
      expect(fs.existsSync(report.indexPath), 'coverage-matrix index.html written').toBe(true);
    });
  } finally {
    for (const u of [incomplete, complete]) {
      const r = await factory.destroy(u.phone);
      console.log(`[teardown] destroyed visual user ${u.phone} (affectedRows=${r && r.affectedRows})`);
    }
  }
});
