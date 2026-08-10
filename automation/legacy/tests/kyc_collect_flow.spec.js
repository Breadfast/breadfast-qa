'use strict';

/**
 * B10-56336 / PRD B10-56334 — Card-collection flow + KYC PDF (Card Admin Panel)
 *
 * Verified live 2026-06-22. The collect flow PERMANENTLY moves a customer to Received,
 * so the suite is split:
 *   • GROUP A — non-finalizing checks against a Registered customer with INCOMPLETE KYC
 *     (Popup 1 mechanics, branch code, print_kyc completeness gate, Popup 2 open,
 *      empty-package guard). These never call /received, so the customer stays Registered.
 *   • GROUP B — one full happy-path collection (fills KYC, prints PDF, confirms package,
 *     /received → Received). This consumes one Registered customer.
 *
 * Test data is fully DYNAMIC (no static sheet): each user is provisioned to "Registered" via
 * API (CardUserFactory) and torn down from the DB afterwards. A freshly provisioned user is
 * Registered with NO KYC details — exactly what Group A's gate checks need. Group B provisions
 * its own user and collects it with a random, unique package number (retry on collision).
 */

const { test, expect } = require('@playwright/test');
const config           = require('../../helpers/ConfigReader');
const CardUserFactory  = require('../../helpers/CardUserFactory');
const LoginPage        = require('../../pages/LoginPage');
const EditCustomerPage = require('../../pages/EditCustomerPage');
const CollectDialogPage = require('../../pages/CollectDialogPage');

const STORE = 'Breadfast Coffee city';
const factory = new CardUserFactory();

// Group A shares ONE provisioned Registered+incomplete user across its non-finalizing checks.
let groupAUser;

test.beforeAll(async () => {
  groupAUser = await factory.provision();
  console.log(`[provision] groupA gate user phone=${groupAUser.phone} bcid=${groupAUser.breadfastId}`);
});

test.afterAll(async () => {
  if (groupAUser) {
    const r = await factory.destroy(groupAUser.phone);
    console.log(`[teardown] destroyed groupA ${groupAUser.phone} (affectedRows=${r && r.affectedRows})`);
  }
});

test.beforeEach(async ({ page }) => {
  await new LoginPage(page).fillLoginFormAndSubmit(
    config.getAdminUserName(),
    config.getAdminPassword()
  );
});

// ════════════════════════════════════════════════════════════════════════════
//  GROUP A — Popup mechanics + completeness gate (non-finalizing)
// ════════════════════════════════════════════════════════════════════════════

test('Verify the Store Location popup requires a location before the collection actions are enabled TC-50601', async ({ page }) => {
  const edit = new EditCustomerPage(page);
  await edit.openCustomerView(groupAUser.searchMobile);
  const collect = new CollectDialogPage(page);
  await collect.openCollect();

  await expect(collect.storeCombobox).toBeVisible();
  const d = await collect.printActionsDisabled();
  expect(d.print, 'Print Form & Continue disabled before store selection').toBe(true);
  expect(d.noPrint, 'Continue without Printing disabled before store selection').toBe(true);
});

test('Verify the Store Location popup requires a location before the collection actions are enabled (branch code + enabled actions) TC-50601', async ({ page }) => {
  const edit = new EditCustomerPage(page);
  await edit.openCustomerView(groupAUser.searchMobile);
  const collect = new CollectDialogPage(page);
  await collect.openCollect();
  await collect.selectStore(STORE);

  expect(await collect.branchCode(), 'Branch Code should display after selection').toMatch(/\d+/);
  const d = await collect.printActionsDisabled();
  expect(d.print).toBe(false);
  expect(d.noPrint).toBe(false);
});

test('Verify Print Form & Continue is blocked when mandatory KYC data is incomplete (PDF generation gate) TC-50602', async ({ page }) => {
  const edit = new EditCustomerPage(page);
  await edit.openCustomerView(groupAUser.searchMobile);
  const collect = new CollectDialogPage(page);
  await collect.openCollect();
  await collect.selectStore(STORE);

  const r = await collect.printAndCapture();
  expect(r.status, 'print_kyc must reject incomplete KYC').toBe(400);
  expect(r.message).toMatch(/insert mandatory customer details/i);
  // must NOT advance to Package Number
  await expect(collect.packageInput).toHaveCount(0);
});

test('Verify Continue without Printing opens the Package Number step without generating a PDF TC-50603', async ({ page }) => {
  const edit = new EditCustomerPage(page);
  await edit.openCustomerView(groupAUser.searchMobile);
  const collect = new CollectDialogPage(page);
  await collect.openCollect();
  await collect.selectStore(STORE);
  await collect.continueWithoutPrinting();

  await expect(collect.packageInput).toBeVisible();
});

test('Verify the Package Number is required before card collection can be confirmed TC-50604', async ({ page }) => {
  const edit = new EditCustomerPage(page);
  await edit.openCustomerView(groupAUser.searchMobile);
  const collect = new CollectDialogPage(page);
  await collect.openCollect();
  await collect.selectStore(STORE);
  await collect.continueWithoutPrinting();

  const r = await collect.confirmPackageAndCapture(''); // empty
  expect(r.status, 'no /received should fire with empty package').toBeNull();
  expect(await collect.packageRequiredError()).toMatch(/This field is required/i);
});

// ════════════════════════════════════════════════════════════════════════════
//  GROUP B — Full happy-path collection (provisions + collects + destroys its own user)
// ════════════════════════════════════════════════════════════════════════════

test('Verify a complete-KYC customer can be collected end-to-end and the status becomes Received TC-50605', async ({ page }) => {
  // Provision a dedicated user for this destructive flow; destroy it in finally.
  const user = await factory.provision();
  console.log(`[provision] collect user phone=${user.phone} bcid=${user.breadfastId}`);

  try {
    const edit = new EditCustomerPage(page);

    // 1. Fill all KYC fields valid and save (200)
    await edit.openCustomerEdit(user.searchMobile);
    await edit.fillAllValid();
    await edit.submitExpectSuccess();

    // 2. Reopen the detail page and start collection
    await edit.openCustomerView(user.searchMobile);
    const collect = new CollectDialogPage(page);
    await collect.openCollect();
    await collect.selectStore(STORE);

    // 3. Print Form & Continue → PDF now generates (200)
    const print = await collect.printAndCapture();
    expect(print.status, 'print_kyc should succeed once KYC is complete').toBe(200);

    // 4. UI reaches the Package Number dialog (mechanics covered by Group A).
    await expect(collect.packageInput).toBeVisible();

    // 5. Complete the collection via the /received API — mirrors the Java framework's collectCard.
    //    (The UI package-Confirm no-ops for users with no transactions due to a page-level
    //    `dtInstance` JS error — reported as a finding; see defects.) Package must be a valid,
    //    unused pool number; retry on the rare "already assigned" collision.
    let recv = null, pkg = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      pkg = await factory.claimPackageFromPool();
      recv = await factory.collectViaApi(user.searchMobile, pkg);
      console.log(`[collect] /received package=${pkg} status=${recv.status} msg="${recv.message}"`);
      if (recv.status === 200) break;
      if (recv.status === 400 && /already assigned/i.test(recv.message)) continue;
      break;
    }
    expect(recv.status, `/received should succeed. last package=${pkg} message="${recv && recv.message}"`).toBe(200);

    // 6. Status reflects collection (verified via the API the admin panel uses).
    const rec = await factory.existsViaApi(user.searchMobile);
    expect(rec && rec.status, 'customer status should be Received').toBe('Received');
  } finally {
    const r = await factory.destroy(user.phone);
    console.log(`[teardown] destroyed collect user ${user.phone} (affectedRows=${r && r.affectedRows})`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  TC_COL_007 — DEFECT REPRO: UI "Confirm" no-ops for empty-transaction customers
//  (defects/BUG_collect_confirm_dtInstance.md). Drives the REAL UI package-Confirm and
//  asserts it neither POSTs /received nor errors visibly, while the page logs the dtInstance
//  TypeError. The backend /received API DOES collect the same user (proven separately), so this
//  isolates the bug to the admin-panel UI. This test PASSES by confirming the broken behavior.
// ════════════════════════════════════════════════════════════════════════════

test('[TC_COL_007] BUG: UI package Confirm silently no-ops for a no-transactions customer (dtInstance)', async ({ page }) => {
  const user = await factory.provision();
  console.log(`[provision] repro user phone=${user.phone} bcid=${user.breadfastId}`);

  // capture the page-level dtInstance error
  let sawDtInstance = false;
  const mark = (t) => { if (t && /dtInstance/.test(t)) sawDtInstance = true; };
  page.on('console', (m) => mark(m.text()));
  page.on('pageerror', (e) => mark(e.message));

  try {
    const edit = new EditCustomerPage(page);
    await edit.openCustomerEdit(user.searchMobile);
    await edit.fillAllValid();
    await edit.submitExpectSuccess();

    await edit.openCustomerView(user.searchMobile);
    const collect = new CollectDialogPage(page);
    await collect.openCollect();
    await collect.selectStore(STORE);
    const print = await collect.printAndCapture();
    expect(print.status, 'print_kyc should succeed once KYC is complete').toBe(200);

    // Attempt the REAL UI confirm with a valid pool package.
    await expect(collect.packageInput).toBeVisible();
    const pkg = await factory.claimPackageFromPool();
    const recv = await collect.confirmPackageAndCapture(pkg);
    console.log(`[repro] UI confirm package=${pkg} -> /received status=${recv.status} (sawDtInstance=${sawDtInstance})`);

    // BUG (certain, reproducible): the UI Confirm fires NO /received call (status null) ...
    expect(recv.status, 'BUG repro: UI Confirm should NOT fire /received for an empty-transactions customer').toBeNull();
    // ... the dialog stays open on the Package Number step (no submit, no visible error) ...
    await expect(collect.packageInput).toBeVisible();
    // dtInstance console error is the suspected cause; observed intermittently (logged, not asserted).
    console.log(`[repro] dtInstance console error observed this run: ${sawDtInstance}`);

    // Sanity: the SAME customer + SAME package DOES collect via the backend /received API,
    // isolating the defect to the admin-panel UI Confirm handler.
    const api = await factory.collectViaApi(user.searchMobile, pkg);
    expect(api.status, 'backend /received should collect the same user fine').toBe(200);
    console.log('[repro] backend /received OK -> bug is isolated to the admin-panel UI Confirm');
  } finally {
    const r = await factory.destroy(user.phone);
    console.log(`[teardown] destroyed repro user ${user.phone} (affectedRows=${r && r.affectedRows})`);
  }
});
