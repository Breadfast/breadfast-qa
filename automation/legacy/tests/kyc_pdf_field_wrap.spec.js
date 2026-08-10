'use strict';

/**
 * B10-56337 — Added AC (execution instruction): KYC PDF free-text output that exceeds the
 * available line space must wrap into 2–3 rows at a maximum of 50 characters per line, with NO
 * character truncation (the full seeded string is recoverable across the wrapped lines).
 *
 * Seeds a deliberately long Arabic Address into the customer record, generates the KYC PDF, and
 * asserts the wrap rule with KycPdfContentValidator. Dynamic user with DB teardown.
 */

const path = require('path');
const fs   = require('fs');
const FW = process.env.BF_AUTOMATION_DIR || path.resolve(__dirname, '..', '..');

const { test, expect }       = require('@playwright/test');
const config                 = require(path.join(FW, 'helpers', 'ConfigReader'));
const CardUserFactory        = require(path.join(FW, 'helpers', 'CardUserFactory'));
const KycPdfContentValidator = require(path.join(FW, 'helpers', 'KycPdfContentValidator'));
const LoginPage              = require(path.join(FW, 'pages', 'LoginPage'));
const EditCustomerPage       = require(path.join(FW, 'pages', 'EditCustomerPage'));
const CollectDialogPage      = require(path.join(FW, 'pages', 'CollectDialogPage'));

const STORE = 'Breadfast Coffee city';
const EVIDENCE_DIR = path.resolve(__dirname, '../../../B10-56337/evidence');

// A long Arabic address (> 50 chars) that the A4 layout must wrap across multiple rows.
const LONG_ADDRESS =
  'القاهرة الجديدة التجمع الخامس شارع التسعين الشمالي عمارة رقم اثنا عشر الدور الثالث شقة خمسة بجوار مول كايرو فيستيفال';

const factory = new CardUserFactory();

test.beforeEach(async ({ page }) => {
  await new LoginPage(page).fillLoginFormAndSubmit(config.getAdminUserName(), config.getAdminPassword());
});

test('Long free-text field wraps to 2–3 rows, ≤50 chars per line, with no truncation TC-50641', async ({ page }) => {
  expect(LONG_ADDRESS.length, 'seeded address should overflow one line').toBeGreaterThan(50);

  const user = await factory.provision();
  console.log(`[provision] wrap user phone=${user.phone}`);
  try {
    const edit = new EditCustomerPage(page);
    await test.step('Seed the long Arabic address and complete KYC', async () => {
      await edit.openCustomerEdit(user.searchMobile);
      await edit.fillAllValid({ address: LONG_ADDRESS });
      await edit.submitExpectSuccess();
    });

    await test.step('Collect the customer so the KYC form can be generated', async () => {
      let recv = null, pkg = null;
      for (let i = 0; i < 5; i++) {
        pkg = await factory.claimPackageFromPool();
        recv = await factory.collectViaApi(user.searchMobile, pkg);
        if (recv.status === 200) break;
        if (recv.status === 400 && /already assigned/i.test(recv.message)) continue;
        break;
      }
      expect(recv.status, `/received should succeed. msg="${recv && recv.message}"`).toBe(200);
    });

    let pdf;
    await test.step('Generate the KYC PDF', async () => {
      await edit.openCustomerView(user.searchMobile);
      pdf = await new CollectDialogPage(page).printKycFromHeaderAndCapture();
      KycPdfContentValidator.assertStructural(pdf);
      fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
      fs.writeFileSync(path.join(EVIDENCE_DIR, `kyc_wrap_${user.localPhone}.pdf`), pdf.body);
    });

    await test.step('The long address wraps within the AC limits with no truncation', async () => {
      const { lines } = await KycPdfContentValidator.extract(pdf.body);
      const wrapRows = KycPdfContentValidator.assertLineWrap(lines, LONG_ADDRESS, { maxPerLine: 50, maxRows: 3 });
      console.log(`[wrap] address wrapped across ${wrapRows.length} rows:`, JSON.stringify(wrapRows));
    });
  } finally {
    const r = await factory.destroy(user.phone);
    console.log(`[teardown] destroyed wrap user ${user.phone} (affectedRows=${r && r.affectedRows})`);
  }
});
