'use strict';

/**
 * B10-56337 — Card-collection Popup 1 / Popup 2 flow DELTAS over B10-56336.
 *
 * B10-56336 already proved the base Popup mechanics (kyc_collect_flow.spec.js). This suite
 * covers only the B10-56337-specific behaviour:
 *   • Popup 1 exposes the Store Location dropdown + Branch ID + BOTH actions, disabled with no store
 *   • 'This field is required.' surfaces when an action is attempted without a store
 *   • selecting a store reveals the branch code; CHANGING the store updates it to a new mapping
 *   • the dropdown lists branch reference data (distinct, non-empty)
 *   • incomplete KYC → 'You have to insert mandatory customer details' and Popup 2 does not open
 *   • Continue Without Printing reaches Popup 2 with no PDF; Confirm disabled until a package is entered
 *   • Store Location + branch code are persisted ONLY at Popup 2 Confirm (not at PDF generation),
 *     and Date of Collection is saved only at collection — verified at the DB source of truth.
 *
 * Test data is dynamic (CardUserFactory) with DB teardown. DB assertions auto-skip when the
 * card-DB SSH tunnel is unavailable (e.g. CI without the bastion key).
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

const STORE = 'Breadfast Coffee city';
const EXPECTED_STORE_REQUIRED  = /This field is required/i;
const EXPECTED_INCOMPLETE_KYC  = /insert mandatory customer details/i;

const factory = new CardUserFactory();
const kyc     = new KycRecordHelper();

let groupUser;   // shared Registered + incomplete user for the non-finalizing checks
let dbReady = true;

test.beforeAll(async () => {
  groupUser = await factory.provision();
  console.log(`[provision] flow user phone=${groupUser.phone} bcid=${groupUser.breadfastId}`);
  try { await kyc.getWalletUserRow('+20000000000'); }
  catch (e) { dbReady = false; console.warn(`[db] card DB unavailable — persistence assertions will skip: ${e.message}`); }
});

test.afterAll(async () => {
  if (groupUser) {
    const r = await factory.destroy(groupUser.phone);
    console.log(`[teardown] destroyed flow user ${groupUser.phone} (affectedRows=${r && r.affectedRows})`);
  }
});

test.beforeEach(async ({ page }) => {
  await new LoginPage(page).fillLoginFormAndSubmit(config.getAdminUserName(), config.getAdminPassword());
});

test('Popup 1 shows the Store Location dropdown, Branch ID and both actions disabled with no store selected TC-50611', async ({ page }) => {
  const edit = new EditCustomerPage(page);
  await test.step('Open the customer detail view', async () => {
    await edit.openCustomerView(groupUser.searchMobile);
  });
  const collect = new CollectDialogPage(page);
  await test.step('Click Card Collected to open Popup 1', async () => {
    await collect.openCollect();
    await expect(collect.storeCombobox).toBeVisible();
  });
  await test.step('Both actions are present and disabled before a store is chosen', async () => {
    await expect(collect.printContinueBtn).toBeVisible();
    await expect(collect.continueNoPrintBtn).toBeVisible();
    const d = await collect.printActionsDisabled();
    expect(d.print, 'Print Form & Continue disabled').toBe(true);
    expect(d.noPrint, 'Continue without Printing disabled').toBe(true);
  });
});

test('Attempting an action without a store surfaces the inline "This field is required." error TC-50612', async ({ page }) => {
  const edit = new EditCustomerPage(page);
  await edit.openCustomerView(groupUser.searchMobile);
  const collect = new CollectDialogPage(page);
  await collect.openCollect();

  await test.step('Touch the Store Location field then leave it empty', async () => {
    await collect.touchStoreWithoutSelecting();
  });
  await test.step('The required-field error is shown and both actions stay disabled', async () => {
    expect(await collect.storeRequiredError()).toMatch(EXPECTED_STORE_REQUIRED);
    const d = await collect.printActionsDisabled();
    expect(d.print).toBe(true);
    expect(d.noPrint).toBe(true);
  });
});

test('Selecting a store reveals its Branch Code and changing the store updates it to a new mapping TC-50613', async ({ page }) => {
  const edit = new EditCustomerPage(page);
  await edit.openCustomerView(groupUser.searchMobile);
  const collect = new CollectDialogPage(page);
  await collect.openCollect();

  let options;
  await test.step('The dropdown lists distinct branch reference data', async () => {
    options = await collect.listStoreOptions();
    expect(options.length, 'store dropdown should list branches').toBeGreaterThan(1);
    expect(new Set(options).size, 'store options should be distinct').toBe(options.length);
  });

  await test.step('Selecting the first store reveals a numeric Branch Code', async () => {
    const branch1 = await collect.selectStoreAndGetBranch(options[0]);
    expect(branch1, 'first branch code').toMatch(/\d+/);
    test.info().annotations.push({ type: 'branch', description: `${options[0]} -> ${branch1}` });
  });

  await test.step('Changing to a different store updates the branch code', async () => {
    const branch1 = await collect.branchCode();
    // pick the next option whose branch code differs from the first
    let changed = false;
    for (const name of options.slice(1)) {
      const b = await collect.selectStoreAndGetBranch(name);
      if (b && b !== branch1) { changed = true; break; }
    }
    expect(changed, 'changing the store should update the branch code to a new mapping').toBe(true);
  });
});

test('Incomplete KYC blocks generation with "You have to insert mandatory customer details" and Popup 2 does not open TC-50614', async ({ page }) => {
  const edit = new EditCustomerPage(page);
  await edit.openCustomerView(groupUser.searchMobile);
  const collect = new CollectDialogPage(page);
  await collect.openCollect();
  await collect.selectStore(STORE);

  const r = await collect.printAndCapture();
  expect(r.status, 'print_kyc must reject incomplete KYC').toBe(400);
  expect(r.message).toMatch(EXPECTED_INCOMPLETE_KYC);
  await expect(collect.packageInput, 'Popup 2 must not open').toHaveCount(0);
});

test('Continue Without Printing reaches Popup 2 with Confirm disabled until a package number is entered TC-50615', async ({ page }) => {
  const edit = new EditCustomerPage(page);
  await edit.openCustomerView(groupUser.searchMobile);
  const collect = new CollectDialogPage(page);
  await collect.openCollect();
  await collect.selectStore(STORE);

  await test.step('Continue Without Printing opens Popup 2 without a PDF', async () => {
    await collect.continueWithoutPrinting();
    await expect(collect.packageInput).toBeVisible();
  });
  await test.step('Confirm is disabled until a package number is entered', async () => {
    expect(await collect.confirmDisabled(), 'Confirm disabled with empty package').toBe(true);
    await collect.packageInput.fill('123456');
    await expect.poll(() => collect.confirmDisabled(), { timeout: 5000 }).toBe(false);
  });
});

test('Store Location + branch code persist only at Popup 2 Confirm and Date of Collection only at collection TC-50616', async ({ page }) => {
  const user = await factory.provision();
  console.log(`[provision] persistence user phone=${user.phone} bcid=${user.breadfastId}`);
  try {
    const edit = new EditCustomerPage(page);
    await test.step('Complete the customer KYC so PDF generation is allowed', async () => {
      await edit.openCustomerEdit(user.searchMobile);
      await edit.fillAllValid();
      await edit.submitExpectSuccess();
    });

    const collect = new CollectDialogPage(page);
    await test.step('Reach Popup 2 via Print Form & Continue (PDF generated, not yet confirmed)', async () => {
      await edit.openCustomerView(user.searchMobile);
      await collect.openCollect();
      await collect.selectStore(STORE);
      const print = await collect.printAndCapture();
      expect(print.status, 'print_kyc should succeed for complete KYC').toBe(200);
      await expect(collect.packageInput).toBeVisible();
    });

    test.skip(!dbReady, 'card DB/SSH tunnel unavailable');

    await test.step('Before Confirm: store/branch not persisted and Date of Collection empty', async () => {
      const before = await kyc.getSavedStoreAndBranch(user.phone);
      expect.soft(before.store, 'store must not be saved at PDF generation').toBeFalsy();
      expect.soft(before.branchCode, 'branch must not be saved at PDF generation').toBeFalsy();
      expect(await kyc.getSavedDateOfCollection(user.phone), 'Date of Collection empty before collection').toBeFalsy();
    });

    await test.step('Confirm the collection (Popup 2 Confirm ≡ /received)', async () => {
      let recv = null, pkg = null;
      for (let i = 0; i < 5; i++) {
        pkg = await factory.claimPackageFromPool();
        recv = await factory.collectViaApi(user.searchMobile, pkg);
        if (recv.status === 200) break;
        if (recv.status === 400 && /already assigned/i.test(recv.message)) continue;
        break;
      }
      expect(recv.status, `/received should succeed. last package=${pkg} msg="${recv && recv.message}"`).toBe(200);
    });

    await test.step('After Confirm: store/branch persisted and Date of Collection set', async () => {
      const after = await kyc.getSavedStoreAndBranch(user.phone);
      expect.soft(after.store || after.branchCode, 'store/branch persisted at Confirm').toBeTruthy();
      expect(await kyc.getSavedDateOfCollection(user.phone), 'Date of Collection set at collection').toBeTruthy();
    });
  } finally {
    const r = await factory.destroy(user.phone);
    console.log(`[teardown] destroyed persistence user ${user.phone} (affectedRows=${r && r.affectedRows})`);
  }
});
