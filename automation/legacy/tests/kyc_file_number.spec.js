'use strict';

/**
 * B10-56337 — KYC File Number lifecycle, verified at the DB source of truth (KycRecordHelper on
 * the wallet_users row):
 *   • auto-generated on first Print & Continue and persisted
 *   • reused (not regenerated) on a subsequent reprint (multiple triggers → same number)
 *   • still generated after collection even when printing is skipped (Continue Without Printing)
 *   • same number reused on card replacement (ReplaceCardPage) — when the replace action is available
 *
 * Dynamic users (CardUserFactory) with DB teardown. The whole suite requires the card-DB SSH
 * tunnel; it auto-skips when the tunnel is unavailable.
 */

const path = require('path');
const FW = process.env.BF_AUTOMATION_DIR || path.resolve(__dirname, '..', '..');

const { test, expect }  = require('@playwright/test');
const config            = require(path.join(FW, 'helpers', 'ConfigReader'));
const CardUserFactory   = require(path.join(FW, 'helpers', 'CardUserFactory'));
const KycRecordHelper   = require(path.join(FW, 'helpers', 'KycRecordHelper'));
const LoginPage         = require(path.join(FW, 'pages', 'LoginPage'));
const EditCustomerPage  = require(path.join(FW, 'pages', 'EditCustomerPage'));
const CollectDialogPage = require(path.join(FW, 'pages', 'CollectDialogPage'));
const ReplaceCardPage   = require(path.join(FW, 'pages', 'ReplaceCardPage'));

const STORE = 'Breadfast Coffee city';

const factory = new CardUserFactory();
const kyc     = new KycRecordHelper();

let dbReady = true;

test.beforeAll(async () => {
  try { await kyc.getWalletUserRow('+20000000000'); }
  catch (e) { dbReady = false; console.warn(`[db] card DB unavailable — KYC-file-number suite will skip: ${e.message}`); }
});

test.beforeEach(async ({ page }) => {
  test.skip(!dbReady, 'card DB/SSH tunnel unavailable');
  await new LoginPage(page).fillLoginFormAndSubmit(config.getAdminUserName(), config.getAdminPassword());
});

/** Provision a user, complete KYC, and drive to Received via API. Returns the user. */
async function provisionCompleteReceived(page) {
  const user = await factory.provision();
  const edit = new EditCustomerPage(page);
  await edit.openCustomerEdit(user.searchMobile);
  await edit.fillAllValid();
  await edit.submitExpectSuccess();
  let recv = null, pkg = null;
  for (let i = 0; i < 5; i++) {
    pkg = await factory.claimPackageFromPool();
    recv = await factory.collectViaApi(user.searchMobile, pkg);
    if (recv.status === 200) break;
    if (recv.status === 400 && /already assigned/i.test(recv.message)) continue;
    break;
  }
  expect(recv.status, `/received should succeed. msg="${recv && recv.message}"`).toBe(200);
  return user;
}

test('KYC File Number is auto-generated on the first Print & Continue and reused on a reprint TC-50621', async ({ page }) => {
  const user = await factory.provision();
  console.log(`[provision] file-number user phone=${user.phone}`);
  try {
    const edit = new EditCustomerPage(page);
    await test.step('Complete KYC', async () => {
      await edit.openCustomerEdit(user.searchMobile);
      await edit.fillAllValid();
      await edit.submitExpectSuccess();
    });

    const collect = new CollectDialogPage(page);
    let firstNumber;
    await test.step('First Print & Continue generates and persists a KYC File Number', async () => {
      await edit.openCustomerView(user.searchMobile);
      await collect.openCollect();
      await collect.selectStore(STORE);
      const print = await collect.printAndCapture();
      expect(print.status, 'first print should succeed').toBe(200);
      firstNumber = await kyc.getKycFileNumber(user.phone);
      expect(firstNumber, 'KYC File Number persisted after first print').toBeTruthy();
    });

    await test.step('Reprint uses the latest saved data and REUSES the same number', async () => {
      // finish the collection so the non-consuming header "Print KYC Form" is available
      let recv = null, pkg = null;
      for (let i = 0; i < 5; i++) {
        pkg = await factory.claimPackageFromPool();
        recv = await factory.collectViaApi(user.searchMobile, pkg);
        if (recv.status === 200) break;
        if (recv.status === 400 && /already assigned/i.test(recv.message)) continue;
        break;
      }
      expect(recv.status, `/received should succeed. msg="${recv && recv.message}"`).toBe(200);

      await edit.openCustomerView(user.searchMobile);
      const reprint = await collect.printKycFromHeaderAndCapture();
      expect(reprint.status, 'reprint should succeed').toBe(200);
      const secondNumber = await kyc.getKycFileNumber(user.phone);
      expect(secondNumber, 'KYC File Number reused (not regenerated) on reprint').toBe(firstNumber);
    });
  } finally {
    const r = await factory.destroy(user.phone);
    console.log(`[teardown] destroyed file-number user ${user.phone} (affectedRows=${r && r.affectedRows})`);
  }
});

test('KYC File Number is still generated after collection when printing is skipped TC-50622', async ({ page }) => {
  const user = await factory.provision();
  console.log(`[provision] skip-print user phone=${user.phone}`);
  try {
    const edit = new EditCustomerPage(page);
    await test.step('Complete KYC and skip printing via Continue Without Printing', async () => {
      await edit.openCustomerEdit(user.searchMobile);
      await edit.fillAllValid();
      await edit.submitExpectSuccess();
      await edit.openCustomerView(user.searchMobile);
      const collect = new CollectDialogPage(page);
      await collect.openCollect();
      await collect.selectStore(STORE);
      await collect.continueWithoutPrinting();
      await expect(collect.packageInput).toBeVisible();
    });

    await test.step('Confirm the collection', async () => {
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

    await test.step('A KYC File Number exists after collection despite skipping the print', async () => {
      expect(await kyc.getKycFileNumber(user.phone), 'KYC File Number generated after collection').toBeTruthy();
    });
  } finally {
    const r = await factory.destroy(user.phone);
    console.log(`[teardown] destroyed skip-print user ${user.phone} (affectedRows=${r && r.affectedRows})`);
  }
});

test('The same KYC File Number is reused on card replacement TC-50623', async ({ page }) => {
  const user = await provisionCompleteReceived(page);
  console.log(`[provision] replacement user phone=${user.phone}`);
  try {
    const before = await kyc.getKycFileNumber(user.phone);
    expect(before, 'KYC File Number set after collection').toBeTruthy();

    const replace = new ReplaceCardPage(page);
    await replace.openCustomerCardPanel(user.searchMobile);
    const canReplace = await replace.replaceCardLink.isVisible().catch(() => false);
    test.skip(!canReplace, 'Replace Breadfast Card action not available for this card state');

    await test.step('Perform the replacement', async () => {
      await replace.openReplaceModal();
      const r = await replace.confirmReplacement();
      expect(r.status, `replace should succeed. body=${r.body}`).toBe(200);
    });

    await test.step('The KYC File Number is unchanged after replacement', async () => {
      expect(await kyc.getKycFileNumber(user.phone), 'KYC File Number reused on replacement').toBe(before);
    });
  } finally {
    const r = await factory.destroy(user.phone);
    console.log(`[teardown] destroyed replacement user ${user.phone} (affectedRows=${r && r.affectedRows})`);
  }
});
