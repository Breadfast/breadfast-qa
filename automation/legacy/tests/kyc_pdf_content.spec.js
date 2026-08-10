'use strict';

/**
 * B10-56336 — KYC PDF content assertion (HLS #31), with DYNAMIC test data.
 *
 * Mirrors the Java framework's "register via API → drive to the needed status → assert → delete
 * from DB" idea. Here we:
 *   1. provision a fresh user to "Registered" via API (CardUserFactory),
 *   2. fill the NEW B10-56336 KYC fields + collect via the UI so the customer reaches "Received"
 *      with a real KYC file number (the legacy Java editCustomerDetails API predates these fields,
 *      so the UI fill is what satisfies the new completeness gate),
 *   3. reprint the KYC form (non-consuming "Print KYC Form"), parse the PDF, and assert it
 *      contains all required field labels + the customer's data,
 *   4. delete the user from the DB (finally).
 */

const { test, expect } = require('@playwright/test');
const { PDFParse }     = require('pdf-parse');
const fs   = require('fs');
const path = require('path');
const config            = require('../../helpers/ConfigReader');
const CardUserFactory   = require('../../helpers/CardUserFactory');
const LoginPage         = require('../../pages/LoginPage');
const EditCustomerPage  = require('../../pages/EditCustomerPage');
const CollectDialogPage = require('../../pages/CollectDialogPage');

const STORE = 'Breadfast Coffee city';
const factory = new CardUserFactory();

test('Verify the post-collection "Print KYC Form" action reprints using saved data and reuses the KYC file number TC-50608', async ({ page }) => {
  const user = await factory.provision();
  console.log(`[provision] pdf user phone=${user.phone} bcid=${user.breadfastId}`);

  try {
    // ── drive the user to Received with complete (new-field) KYC ──
    await new LoginPage(page).fillLoginFormAndSubmit(config.getAdminUserName(), config.getAdminPassword());
    const edit = new EditCustomerPage(page);
    await edit.openCustomerEdit(user.searchMobile);
    await edit.fillAllValid();
    await edit.submitExpectSuccess();

    // collect via the /received API (mirrors the Java framework) → Received, so the KYC PDF can be reprinted
    let pkg = null, recv = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      pkg = await factory.claimPackageFromPool();
      recv = await factory.collectViaApi(user.searchMobile, pkg);
      if (recv.status === 200) break;
      if (recv.status === 400 && /already assigned/i.test(recv.message)) continue;
      break;
    }
    expect(recv.status, `/received should succeed. message="${recv && recv.message}"`).toBe(200);

    // reopen the now-Received customer's view to reprint the KYC form
    await edit.openCustomerView(user.searchMobile);
    const collect = new CollectDialogPage(page);

    // on-screen values to look for inside the PDF
    const shown = await page.evaluate(() => {
      const body = document.body.innerText;
      const grab = (label) => { const m = body.match(new RegExp(label + '\\s*([^\\n]+)')); return m ? m[1].trim() : null; };
      return {
        nationalId:    grab('National Id'),
        kycFileNumber: grab('KYC File Number'),
        mobile:        (body.match(/\+?20(\d{10})/) || [])[1] || null,
      };
    });
    console.log('[pdf-content] on-screen values:', JSON.stringify(shown));

    // ── reprint the KYC PDF (non-consuming) ──
    const r = await collect.printKycFromHeaderAndCapture();

    // structural validity (hard)
    expect(r.status, `print_kyc should return 200. message="${r.message}"`).toBe(200);
    expect(r.contentType).toMatch(/application\/pdf/i);
    expect(r.body, 'PDF bytes captured').toBeTruthy();
    expect(r.body.length, 'PDF is non-trivial').toBeGreaterThan(10_000);
    expect(r.body.slice(0, 5).toString('latin1')).toBe('%PDF-');

    const outDir = path.resolve(__dirname, '../../../B10-56336/evidence');
    try { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, `kyc_form_${user.localPhone}.pdf`), r.body); } catch { /* evidence best-effort */ }

    // extract text
    const parser = new PDFParse({ data: r.body });
    let text = '';
    try { const res = await parser.getText(); text = (res && res.text) || ''; } catch (e) { console.log('[pdf-content] getText error:', e.message); }
    try { await parser.destroy(); } catch { /* ignore */ }
    const norm    = text.normalize('NFKC');
    const compact = norm.replace(/\s+/g, '');

    // (A) HARD: every required KYC field label is present on the form
    const requiredFields = [
      'Full Name', 'other nationalities', 'Gender', 'Address', 'Nationality',
      'National Identification Number', 'ADIB', 'Occupation', 'Place Of Birth',
      'Issued By', 'Issued On', 'Expiry Date', 'Mobile Number', 'Birthdate',
      'KYC File Number', 'Employee',
    ];
    for (const label of requiredFields) {
      expect(norm, `KYC form must contain the field "${label}"`).toContain(label);
    }

    // (B) customer DATA values mapped into the PDF
    const coverage = {};
    for (const [name, val] of Object.entries({
      'National ID': shown.nationalId, 'KYC File Number': shown.kycFileNumber, 'Mobile': shown.mobile,
    })) {
      if (!val) { coverage[name] = 'n/a'; continue; }
      coverage[name] = compact.includes(val.replace(/\s+/g, '')) ? 'FOUND' : 'missing';
      expect.soft(compact, `PDF data should contain ${name} = "${val}"`).toContain(val.replace(/\s+/g, ''));
    }
    // (C) Arabic data values written by fillAllValid (nationality مصري, occupation طبيب)
    for (const [name, v] of Object.entries({ 'Nationality مصري': 'مصري', 'Occupation طبيب': 'طبيب' })) {
      coverage[name] = norm.includes(v) ? 'FOUND' : 'missing';
      expect.soft(norm, `PDF should contain ${name}`).toContain(v);
    }
    console.log('[pdf-content] data/value coverage:', JSON.stringify(coverage));
  } finally {
    const res = await factory.destroy(user.phone);
    console.log(`[teardown] destroyed pdf user ${user.phone} (affectedRows=${res && res.affectedRows})`);
  }
});
