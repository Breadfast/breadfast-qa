'use strict';

/**
 * B10-56337 — Full KYC A4 PDF field-mapping coverage (KycPdfContentValidator) against the
 * "KYC Template A4 _ new layout-current version.pdf" layout.
 *
 * Provisions a complete-KYC customer, drives it to Received, reprints the KYC form (non-consuming),
 * parses the PDF, and asserts: every required field label present; customer data values mapped in;
 * Arabic (RTL) content rendered without garbling; Date of Collection = generation date; Customer +
 * Employee signatures empty; and the conditional "Other Nationalities" rule (renders when the flag
 * is Yes, blank when No).
 *
 * Dynamic users (CardUserFactory) with DB teardown.
 */

const path = require('path');
const fs   = require('fs');
const FW = process.env.BF_AUTOMATION_DIR || path.resolve(__dirname, '..', '..');

const { test, expect }      = require('@playwright/test');
const config                = require(path.join(FW, 'helpers', 'ConfigReader'));
const CardUserFactory       = require(path.join(FW, 'helpers', 'CardUserFactory'));
const KycPdfContentValidator = require(path.join(FW, 'helpers', 'KycPdfContentValidator'));
const LoginPage             = require(path.join(FW, 'pages', 'LoginPage'));
const EditCustomerPage      = require(path.join(FW, 'pages', 'EditCustomerPage'));
const CollectDialogPage     = require(path.join(FW, 'pages', 'CollectDialogPage'));

const STORE = 'Breadfast Coffee city';
const EVIDENCE_DIR = path.resolve(__dirname, '../../../B10-56337/evidence');

const factory = new CardUserFactory();

/** Complete KYC (with the given edit overrides), collect via API, and return the reprinted PDF. */
async function generateReceivedPdf(page, user, overrides) {
  const edit = new EditCustomerPage(page);
  await edit.openCustomerEdit(user.searchMobile);
  await edit.fillAllValid(overrides);
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

  await edit.openCustomerView(user.searchMobile);
  const shown = await page.evaluate(() => {
    const body = document.body.innerText;
    const grab = (label) => { const m = body.match(new RegExp(label + '\\s*([^\\n]+)')); return m ? m[1].trim() : null; };
    return {
      nationalId:    grab('National Id'),
      kycFileNumber: grab('KYC File Number'),
      mobile:        (body.match(/\+?20(\d{10})/) || [])[1] || null,
    };
  });
  const collect = new CollectDialogPage(page);
  const r = await collect.printKycFromHeaderAndCapture();
  return { pdf: r, shown };
}

test.beforeEach(async ({ page }) => {
  await new LoginPage(page).fillLoginFormAndSubmit(config.getAdminUserName(), config.getAdminPassword());
});

test('Generated KYC PDF maps all required fields with correct Arabic content and empty signatures TC-50631', async ({ page }) => {
  const user = await factory.provision();
  console.log(`[provision] mapping user phone=${user.phone}`);
  try {
    const { pdf, shown } = await generateReceivedPdf(page, user, { otherNationalities: 'No' });
    console.log('[pdf-content] on-screen values:', JSON.stringify(shown));

    await test.step('PDF is structurally valid', async () => {
      KycPdfContentValidator.assertStructural(pdf);
      fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
      fs.writeFileSync(path.join(EVIDENCE_DIR, `kyc_mapping_${user.localPhone}.pdf`), pdf.body);
    });

    const { norm, compact, lines } = await KycPdfContentValidator.extract(pdf.body);

    await test.step('Every required field label is present', async () => {
      KycPdfContentValidator.assertRequiredLabels(norm);
      KycPdfContentValidator.reportMappingLabels(norm);
    });

    await test.step('Customer data values are mapped into the PDF', async () => {
      const coverage = {
        'National ID':     KycPdfContentValidator.assertValue(compact, 'National ID', shown.nationalId, { soft: true }),
        'KYC File Number': KycPdfContentValidator.assertValue(compact, 'KYC File Number', shown.kycFileNumber, { soft: true }),
        'Mobile':          KycPdfContentValidator.assertValue(compact, 'Mobile', shown.mobile, { soft: true }),
      };
      console.log('[pdf-content] value coverage:', JSON.stringify(coverage));
    });

    await test.step('Arabic (RTL) values render without garbling', async () => {
      KycPdfContentValidator.assertArabicValues(norm, { Nationality: 'مصري', Occupation: 'طبيب' });
    });

    await test.step('Date of Collection equals the generation date', async () => {
      KycPdfContentValidator.assertDateOfCollectionIs(norm, new Date());
    });

    await test.step('Customer + Employee signatures are empty', async () => {
      KycPdfContentValidator.assertSignaturesEmpty(lines);
    });

    await test.step('Other Nationalities is blank when the flag is No', async () => {
      KycPdfContentValidator.assertOtherNationalitiesConditional(norm, 'No', '');
    });
  } finally {
    const r = await factory.destroy(user.phone);
    console.log(`[teardown] destroyed mapping user ${user.phone} (affectedRows=${r && r.affectedRows})`);
  }
});

test('Other Nationalities value renders on the PDF only when the flag is Yes TC-50632', async ({ page }) => {
  const OTHER_NAT = 'كندي';
  const user = await factory.provision();
  console.log(`[provision] other-nat user phone=${user.phone}`);
  try {
    const { pdf } = await generateReceivedPdf(page, user, { otherNationalities: 'Yes', otherNatDetails: OTHER_NAT });
    KycPdfContentValidator.assertStructural(pdf);
    const { norm } = await KycPdfContentValidator.extract(pdf.body);
    KycPdfContentValidator.assertOtherNationalitiesConditional(norm, 'Yes', OTHER_NAT);
  } finally {
    const r = await factory.destroy(user.phone);
    console.log(`[teardown] destroyed other-nat user ${user.phone} (affectedRows=${r && r.affectedRows})`);
  }
});
