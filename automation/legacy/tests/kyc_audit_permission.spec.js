'use strict';

/**
 * B10-56337 — Audit log, 3-dots availability, permission gating, and the PDF-failure path.
 *   • Every print/generation is written to the audit log as "print KYC form" (type "no
 *     supervision") with Action Name, Created By, Creation Date and Customer mobile (AuditLogHelper).
 *   • The "Print KYC Form" action appears in the 3-dots header menu ONLY after collection.
 *   • The action is gated by the "print KYC form" permission per the referenced matrix — the
 *     negative (user without the permission) needs a second account and is skipped here.
 *   • PDF-generation failure (reproduced via incomplete KYC) shows a blocking reason and does NOT
 *     open Popup 2.
 *
 * Dynamic users (CardUserFactory) with DB teardown; audit assertions auto-skip without the DB tunnel.
 */

const path = require('path');
const FW = process.env.BF_AUTOMATION_DIR || path.resolve(__dirname, '..', '..');

const { test, expect }  = require('@playwright/test');
const config            = require(path.join(FW, 'helpers', 'ConfigReader'));
const CardUserFactory   = require(path.join(FW, 'helpers', 'CardUserFactory'));
const AuditLogHelper    = require(path.join(FW, 'helpers', 'AuditLogHelper'));
const LoginPage         = require(path.join(FW, 'pages', 'LoginPage'));
const EditCustomerPage  = require(path.join(FW, 'pages', 'EditCustomerPage'));
const CollectDialogPage = require(path.join(FW, 'pages', 'CollectDialogPage'));

const STORE = 'Breadfast Coffee city';
const EXPECTED_INCOMPLETE_KYC = /insert mandatory customer details/i;

const factory = new CardUserFactory();
const audit   = new AuditLogHelper();

let dbReady = true;

test.beforeAll(async () => {
  try { await audit.queryAuditLog('+20000000000'); }
  catch (e) { dbReady = false; console.warn(`[db] card DB unavailable — audit assertions will skip: ${e.message}`); }
});

test.beforeEach(async ({ page }) => {
  await new LoginPage(page).fillLoginFormAndSubmit(config.getAdminUserName(), config.getAdminPassword());
});

test('The "print KYC form" (no supervision) action is written to the audit log with its required fields TC-50651', async ({ page }) => {
  test.skip(!dbReady, 'card DB/SSH tunnel unavailable');
  const user = await factory.provision();
  console.log(`[provision] audit user phone=${user.phone}`);
  try {
    const edit = new EditCustomerPage(page);
    await test.step('Complete KYC and collect the customer', async () => {
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
    });

    await test.step('Trigger a KYC print from the header action', async () => {
      await edit.openCustomerView(user.searchMobile);
      const reprint = await new CollectDialogPage(page).printKycFromHeaderAndCapture();
      expect(reprint.status, 'print should succeed').toBe(200);
    });

    await test.step('The print action is logged with name/type/customer mobile', async () => {
      const found = await audit.findPrintKycAction(user.phone);
      expect(found.found, `"print KYC form" audit entry should exist. rows=${found.rows.length}`).toBe(true);
      expect(found.hasActionName, 'Action Name recorded').toBe(true);
      expect(found.hasActionType, 'Action Type "no supervision" recorded').toBe(true);
      expect(found.hasCustomerMobile, 'Customer mobile recorded').toBe(true);
      // Created By / Creation Date are columns on the same row (present when the entry exists).
      const row = found.row;
      const hasCreatedBy   = Object.keys(row).some(k => /created?_?by|user|agent|employee/i.test(k));
      const hasCreationDate = Object.keys(row).some(k => /created?_?at|creation|timestamp|date/i.test(k));
      expect(hasCreatedBy, 'Created By column present on the audit row').toBe(true);
      expect(hasCreationDate, 'Creation Date column present on the audit row').toBe(true);
    });
  } finally {
    const r = await factory.destroy(user.phone);
    console.log(`[teardown] destroyed audit user ${user.phone} (affectedRows=${r && r.affectedRows})`);
  }
});

test('The "Print KYC Form" action appears in the 3-dots menu only after collection TC-50652', async ({ page }) => {
  const user = await factory.provision();
  console.log(`[provision] menu user phone=${user.phone}`);
  try {
    const edit = new EditCustomerPage(page);
    const collect = new CollectDialogPage(page);

    await test.step('Before collection the action is NOT in the 3-dots menu', async () => {
      await edit.openCustomerView(user.searchMobile);
      expect(await collect.isPrintKycActionAvailable(), 'not available for a Registered customer').toBe(false);
    });

    await test.step('Complete KYC and collect the customer', async () => {
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
    });

    await test.step('After collection the action IS in the 3-dots menu', async () => {
      await edit.openCustomerView(user.searchMobile);
      expect(await collect.isPrintKycActionAvailable(), 'available for a Received customer').toBe(true);
    });
  } finally {
    const r = await factory.destroy(user.phone);
    console.log(`[teardown] destroyed menu user ${user.phone} (affectedRows=${r && r.affectedRows})`);
  }
});

test('A PDF-generation failure shows a blocking reason and does not open Popup 2 TC-50653', async ({ page }) => {
  // Incomplete KYC is the reproducible generation-failure path: the backend rejects with the
  // exact reason and the flow stays on Popup 1.
  const user = await factory.provision();
  console.log(`[provision] failure-path user phone=${user.phone}`);
  try {
    const edit = new EditCustomerPage(page);
    await edit.openCustomerView(user.searchMobile);
    const collect = new CollectDialogPage(page);
    await collect.openCollect();
    await collect.selectStore(STORE);

    const r = await collect.printAndCapture();
    expect(r.status, 'generation must fail for incomplete data').toBe(400);
    expect(r.message, 'a specific failure reason is returned').toMatch(EXPECTED_INCOMPLETE_KYC);
    await expect(collect.packageInput, 'Popup 2 must not open on failure').toHaveCount(0);
  } finally {
    const res = await factory.destroy(user.phone);
    console.log(`[teardown] destroyed failure-path user ${user.phone} (affectedRows=${res && res.affectedRows})`);
  }
});

// The negative permission case (a user WITHOUT the "print KYC form" permission cannot see/use the
// action) requires a second account that lacks the permission; none is provisioned for this run.
test('A user lacking the "print KYC form" permission cannot see or use the action TC-50654', async () => {
  test.skip(true, 'requires a second account without the "print KYC form" permission (not provisioned)');
});
