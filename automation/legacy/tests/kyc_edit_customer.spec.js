'use strict';

/**
 * B10-56336 — Extend Admin Portal with All KYC Fields
 * Edit Customer Details — UI + validation suite (Card Admin Panel)
 *
 * Behaviour verified live 2026-06-22 against the testing panel. Validation is
 * server-side, one field at a time: each Confirm POSTs /wallet_users/update and a
 * 400 returns a single field's error (rendered inline). Tests therefore fill all
 * required fields valid and isolate ONE bad/blank field per negative case, asserting
 * on the real API response (status + validationErrors) — not on UI navigation.
 *
 * Test customer: dynamically provisioned to status "Registered" via API (CardUserFactory) —
 * a brand-new user with NO KYC details yet, so the Edit modal opens with the new fields blank.
 * One user is provisioned for the whole file and torn down from the DB afterwards (no static
 * test-data sheet). Negative tests never save (400); the happy-path test saves a valid Arabic record.
 */

const { test, expect }     = require('@playwright/test');
const config               = require('../../helpers/ConfigReader');
const CardUserFactory      = require('../../helpers/CardUserFactory');
const LoginPage            = require('../../pages/LoginPage');
const EditCustomerPage     = require('../../pages/EditCustomerPage');

const factory = new CardUserFactory();
let cardUser;   // { phone, searchMobile, ... }
let edit;

test.beforeAll(async () => {
  cardUser = await factory.provision();
  console.log(`[provision] edit-suite user phone=${cardUser.phone} bcid=${cardUser.breadfastId}`);
});

test.afterAll(async () => {
  if (cardUser) {
    const r = await factory.destroy(cardUser.phone);
    console.log(`[teardown] destroyed ${cardUser.phone} (affectedRows=${r && r.affectedRows})`);
  }
});

test.beforeEach(async ({ page }) => {
  await new LoginPage(page).fillLoginFormAndSubmit(
    config.getAdminUserName(),
    config.getAdminPassword()
  );
  edit = new EditCustomerPage(page);
  await edit.openCustomerEdit(cardUser.searchMobile);
});

// ════════════════════════════════════════════════════════════════════════════
//  GROUP A — Rendering, sections, defaults, conditional field
// ════════════════════════════════════════════════════════════════════════════

test('Verify the Edit Customer Details modal shows all new KYC fields grouped in sections in the Admin Portal TC-50583', async ({ page }) => {
  await expect(edit.editHeading).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Personal info' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Identity info' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Background info' })).toBeVisible();

  await expect(edit.nationality).toBeVisible();
  await expect(edit.issuingAuthority).toBeVisible();
  await expect(edit.occupation).toBeVisible();
  await expect(edit.citySelect).toBeVisible();
  await expect(page.locator('input[formcontrolname="has_other_nationalities"]').first()).toBeAttached();
  await expect(page.locator('input[formcontrolname="is_adib_customer"]').first()).toBeAttached();
});

test('Verify Nationality defaults to the Arabic value "مصري" when the Edit Customer Details modal opens TC-50584', async () => {
  await expect(edit.nationality).toHaveValue('مصري');
});

test('Verify "Specify other nationalities" field is hidden when Other Nationalities = No and shown when = Yes TC-50585', async () => {
  await edit.setOtherNationalities('No');
  expect(await edit.isOtherNatDetailsVisible(), 'hidden when No').toBe(false);

  await edit.setOtherNationalities('Yes');
  expect(await edit.isOtherNatDetailsVisible(), 'shown when Yes').toBe(true);
});

test('Verify City of birth is a dropdown of Egyptian governorates in Arabic TC-50586', async () => {
  const opts = (await edit.citySelect.locator('option').allTextContents()).map(o => o.trim());
  expect(opts).toEqual(expect.arrayContaining(['القاهرة', 'الجيزة', 'الإسكندرية']));
  // Governorate entries (excluding the "Select City of birth" placeholder) are Arabic, no Latin.
  const governorates = opts.filter(o => o && o !== 'Select City of birth');
  expect(governorates.every(o => !/[A-Za-z]/.test(o)), 'governorate labels are Arabic only').toBe(true);
});

// ════════════════════════════════════════════════════════════════════════════
//  GROUP B — Mandatory-field validation
// ════════════════════════════════════════════════════════════════════════════

test('Verify Occupation is mandatory — confirming with it empty returns "occupation is required" TC-50587', async () => {
  await edit.fillAllValid({ occupation: '' });
  const r = await edit.submitExpectFieldError('occupation', /occupation is required/i);
  // AC: message renders inline under the field
  expect(await edit.inlineErrorFor(edit.occupation)).toMatch(/occupation is required/i);
});

test('Verify Issuing Authority is mandatory — confirming with it empty returns "issuing authority is required" TC-50588', async () => {
  await edit.fillAllValid({ issuingAuthority: '' });
  await edit.submitExpectFieldError('issuing_authority', /issuing authority is required/i);
});

test('Verify Other Nationality Details is required only when Other Nationalities = Yes TC-50589', async () => {
  await edit.fillAllValid({ otherNationalities: 'Yes', otherNatDetails: '' });
  await edit.submitExpectFieldError('other_nationalities', /required/i);
});

// ════════════════════════════════════════════════════════════════════════════
//  GROUP C — Arabic-only validation (Latin rejected; Arabic + digits accepted)
// ════════════════════════════════════════════════════════════════════════════

test('Verify Occupation rejects Latin characters with "Please enter Arabic characters only" TC-50591', async () => {
  await edit.fillAllValid({ occupation: 'doctor' });
  await edit.submitExpectFieldError('occupation', /Please enter Arabic characters only/i);
});

test('Verify Address rejects Latin characters with "Please enter Arabic characters only" TC-50593', async () => {
  await edit.fillAllValid({ address: 'alex street 5' });
  await edit.submitExpectFieldError('address', /Please enter Arabic characters only/i);
});

test('Verify Address accepts Arabic text containing digits (building/apartment numbers) TC-50594', async () => {
  // Arabic + Arabic-Indic + ASCII digits must NOT raise an address error.
  await edit.fillAllValid({ address: 'القاهرة المعادي شارع ٩ مبنى 12' });
  const r = await edit.submitAndCapture();
  expect(r.validationErrors.address, 'address with digits must be accepted').toBeFalsy();
});

test('Verify Nationality rejects Latin characters with "Please enter Arabic characters only" TC-50592', async () => {
  await edit.fillAllValid({ nationality: 'Egyptian' });
  await edit.submitExpectFieldError('nationality', /Please enter Arabic characters only/i);
});

test('Verify Issuing Authority rejects Latin characters with "Please enter Arabic characters only" TC-50595', async () => {
  await edit.fillAllValid({ issuingAuthority: 'Civil Affairs' });
  await edit.submitExpectFieldError('issuing_authority', /Please enter Arabic characters only/i);
});

// ════════════════════════════════════════════════════════════════════════════
//  GROUP D — Issuing Date rule (must be in the past)
// ════════════════════════════════════════════════════════════════════════════

test('Verify Issuing Date in the future is rejected with "Date cannot be today or a future date" TC-50596', async () => {
  await edit.fillAllValid({ issuingDate: '02-02-2030' });
  await edit.submitExpectFieldError('issuing_date', /today or a future date/i);
});

test('Verify Issuing Date equal to today is rejected TC-50597', async () => {
  const t = new Date();
  const dd = String(t.getDate()).padStart(2, '0');
  const mm = String(t.getMonth() + 1).padStart(2, '0');
  const today = `${dd}-${mm}-${t.getFullYear()}`;
  await edit.fillAllValid({ issuingDate: today });
  await edit.submitExpectFieldError('issuing_date', /today or a future date/i);
});

// ════════════════════════════════════════════════════════════════════════════
//  GROUP E — Happy path + persistence
// ════════════════════════════════════════════════════════════════════════════

test('Verify saving with all KYC fields valid persists the new fields to the customer record TC-50599', async () => {
  await edit.fillAllValid({ otherNationalities: 'Yes', otherNatDetails: 'سوري' });
  const r = await edit.submitExpectSuccess();

  expect(r.payload.nationality).toBe('مصري');
  expect(r.payload.issuing_authority).toBe('مصلحة الأحوال المدنية');
  expect(r.payload.issuing_date).toBe('02-02-2015');
  expect(r.payload.has_other_nationalities).toBe('Yes');
  expect(r.payload.other_nationalities).toBe('سوري');
  expect(r.payload.is_adib_customer).toBe('No');
  expect(r.payload.occupation).toBe('طبيب');
});
