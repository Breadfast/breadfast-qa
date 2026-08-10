'use strict';

/**
 * gen_browserstack_csv_b10_56336.js
 * BrowserStack Test Management import CSV for B10-56336 "Extend Admin Portal with All
 * KYC Fields" (+ PRD B10-56334 collect-flow / KYC PDF).
 *
 * STRUCTURE LOCKED to the canonical export `test_cases_BCard Squad (1).csv`
 * (folder 48895703): 24-column header, one row per step, EVERY step paired with its own
 * Expected Result, granular steps starting from a login/open step (login → Search Cards →
 * More Details → Edit → action → verify). See browserstack-process.md §10.
 *
 * Import note: when importing into a PRESELECTED folder (?folder=<id>), set the
 * "Folder Path" field mapping to "Ignore This Field" at the Map Fields step, otherwise a
 * duplicate nested folder is created.
 */

const fs = require('fs');
const path = require('path');

// ── Destination ──────────────────────────────────────────────────────────────
const FOLDER_ID   = '50396881';
const FOLDER_PATH = 'Card.Core.Sprint.3>Extend Admin Portal with All KYC Fields';
const PROJECT  = 'BCard Squad';
const ISSUE    = 'B10-56336';
const OWNER    = 'Fintech';
const TAGS     = 'ai-created';

const ALLOWED_TYPES = ['Acceptance', 'Regression', 'Functional', 'Usability', 'Smoke & Sanity'];
const TYPE_MAP = { Boundary: 'Functional', Validation: 'Functional', Security: 'Functional' };
const normType = t => TYPE_MAP[t] || (ALLOWED_TYPES.includes(t) ? t : 'Functional');

const HEADER = [
  'Test Case ID','Title','Folder ID','Folder Path','State','Owner','Priority',
  'Type of Test Case','Automation Status','Description','Preconditions','Template',
  'Steps','Expected Result','Issues','Tags','Status (latest)','Attachments',
  'Created At','Created By','Last Updated At','Last Updated By','Project Name','Test Case URL'
];

// ── Preconditions ──────────────────────────────────────────────────────────────
const PRE_EDIT = 'Agent has valid Admin Portal credentials (card-panel-testing.breadfast.tech). A customer record is accessible via Card Users > Search Cards.';
const PRE_REG_INCOMPLETE = 'Agent has valid Admin Portal credentials. A Registered (not-yet-collected) customer whose KYC details are NOT yet complete is available. A valid store/pickup location exists.';
const PRE_REG_COMPLETE = 'Agent has valid Admin Portal credentials. A Registered (not-yet-collected) customer with COMPLETE, valid KYC details is available. A valid store/pickup location and an UNUSED package number exist.';
const PRE_RECEIVED = 'Agent has valid Admin Portal credentials. A customer in Received status (card already collected) with a generated KYC file number is available.';

// ── Reusable granular preambles (each step has its own expected result) ──────────
const OPEN_EDIT = [
  ['Log in to the Admin Portal with valid agent credentials', 'Agent is successfully logged in and the dashboard is displayed'],
  ['Navigate to Card Users > Search Cards and search for a customer by mobile number', 'The customer record is found and displayed in the results'],
  ["Click 'More Details' to open the customer details page", 'The customer details page is displayed'],
  ["Click 'Edit' to open the Edit Customer Details form", 'The Edit Customer Details modal is displayed with all fields'],
];
const OPEN_VIEW_REG = [
  ['Log in to the Admin Portal with valid agent credentials', 'Agent is successfully logged in and the dashboard is displayed'],
  ['Navigate to Card Users > Search Cards and search for a Registered customer by mobile number', 'The customer record is found with status Registered'],
  ["Click 'More Details' to open the customer details page", "The customer details page is displayed with a 'Card Collected' button"],
];
const OPEN_VIEW_RECEIVED = [
  ['Log in to the Admin Portal with valid agent credentials', 'Agent is successfully logged in and the dashboard is displayed'],
  ['Navigate to Card Users > Search Cards and search for a Received customer by mobile number', 'The customer record is found with status Received'],
  ["Click 'More Details' to open the customer details page", 'The customer details page is displayed'],
];

// ── Test cases ────────────────────────────────────────────────────────────────
const CASES = [
  // ===== A. Rendering / defaults / conditional =====
  { t:'Verify the Edit Customer Details modal shows all new KYC fields grouped in sections in the Admin Portal',
    pr:'High', ty:'Functional', au:'Automated', pre:PRE_EDIT,
    d:'The Edit Customer Details modal renders the new KYC fields grouped under Personal info, Identity info and Background info per the design.',
    steps:[ ...OPEN_EDIT,
      ['Review the fields displayed under the Personal info, Identity info and Background info sections',
       'All new KYC fields are present and grouped: Nationality, Other Nationalities, Other Nationality Details, Issuing Authority, Issuing Date, Existing ADIB Customer, Occupation, Address and City of birth'],
    ]},
  { t:'Verify Nationality defaults to the Arabic value "مصري" when the Edit Customer Details modal opens',
    pr:'Medium', ty:'Functional', au:'Automated', pre:PRE_EDIT,
    d:'Nationality is a free-text field that pre-fills with "مصري".',
    steps:[ ...OPEN_EDIT,
      ['Locate the Nationality field and read its pre-filled value', 'The Nationality field is pre-filled with "مصري"'],
    ]},
  { t:'Verify "Specify other nationalities" field is hidden when Other Nationalities = No and shown when = Yes',
    pr:'High', ty:'Functional', au:'Automated', pre:PRE_EDIT,
    d:'The Other Nationality Details field is conditional on the Yes/No radio.',
    steps:[ ...OPEN_EDIT,
      ['Select "No" for "Does the customer have other nationalities?"', 'The "Specify other nationalities" field is not displayed'],
      ['Select "Yes" for "Does the customer have other nationalities?"', 'The "Specify other nationalities" text field is displayed and marked required (*)'],
    ]},
  { t:'Verify City of birth is a dropdown of Egyptian governorates in Arabic',
    pr:'Medium', ty:'Functional', au:'Automated', pre:PRE_EDIT,
    d:'Place/City of birth is a required dropdown listing Egyptian governorates in Arabic.',
    steps:[ ...OPEN_EDIT,
      ['Open the City of birth dropdown and review the available options',
       'The dropdown lists Egyptian governorates in Arabic (e.g. القاهرة, الجيزة, الإسكندرية … أخرى) with no Latin governorate labels'],
    ]},

  // ===== B. Mandatory-field validation =====
  { t:'Verify Occupation is mandatory — confirming with it empty returns "occupation is required"',
    pr:'High', ty:'Functional', au:'Automated', pre:PRE_EDIT,
    d:'Occupation is now required; the inline error renders under the field and the update API returns 400.',
    steps:[ ...OPEN_EDIT,
      ['Fill all other required fields with valid Arabic values and a past Issuing Date, then clear the Occupation field', 'The Occupation field is empty while all other required fields are valid'],
      ["Click 'Confirm'", 'The save is rejected (HTTP 400); the inline error "occupation is required" appears under the Occupation field and the record is not saved'],
    ]},
  { t:'Verify Issuing Authority is mandatory — confirming with it empty returns "issuing authority is required"',
    pr:'High', ty:'Functional', au:'Automated', pre:PRE_EDIT,
    d:'Issuing Authority is required.',
    steps:[ ...OPEN_EDIT,
      ['Fill all other required fields validly and clear the Issuing Authority field', 'The Issuing Authority field is empty while all other fields are valid'],
      ["Click 'Confirm'", 'The save is rejected (HTTP 400) with "issuing authority is required" shown under the Issuing Authority field'],
    ]},
  { t:'Verify Other Nationality Details is required only when Other Nationalities = Yes',
    pr:'Medium', ty:'Functional', au:'Automated', pre:PRE_EDIT,
    d:'When Other Nationalities = Yes, the details field becomes required.',
    steps:[ ...OPEN_EDIT,
      ['Set "Does the customer have other nationalities?" to "Yes" and leave "Specify other nationalities" empty', 'The "Specify other nationalities" field is shown and empty'],
      ["Fill all other required fields validly and click 'Confirm'", 'The save is rejected (HTTP 400) with a required-field error on the other nationalities details'],
    ]},
  { t:'Verify Existing ADIB Customer and Other Nationalities are mandatory selections on Confirm',
    pr:'Medium', ty:'Functional', au:'Not Automated', pre:PRE_EDIT,
    d:'Both Yes/No questions must be answered before a successful save.',
    steps:[ ...OPEN_EDIT,
      ['Leave the "Existing ADIB customer" and "Other nationalities" questions unanswered and fill all other fields validly', 'Both Yes/No questions remain unselected'],
      ["Click 'Confirm'", 'The save is rejected; the unanswered mandatory questions are flagged as required'],
    ]},

  // ===== C. Arabic-only validation =====
  { t:'Verify Occupation rejects Latin characters with "Please enter Arabic characters only"',
    pr:'High', ty:'Functional', au:'Automated', pre:PRE_EDIT,
    d:'Arabic-only validation on Occupation.',
    steps:[ ...OPEN_EDIT,
      ['Enter Latin text "doctor" in the Occupation field, with all other fields valid', 'The Occupation field contains "doctor"'],
      ["Click 'Confirm'", 'The save is rejected (HTTP 400) with "Please enter Arabic characters only" shown under the Occupation field'],
    ]},
  { t:'Verify Nationality rejects Latin characters with "Please enter Arabic characters only"',
    pr:'High', ty:'Functional', au:'Automated', pre:PRE_EDIT,
    d:'Arabic-only validation on Nationality.',
    steps:[ ...OPEN_EDIT,
      ['Enter Latin text "Egyptian" in the Nationality field, with all other fields valid', 'The Nationality field contains "Egyptian"'],
      ["Click 'Confirm'", 'The save is rejected with "Please enter Arabic characters only" shown under the Nationality field'],
    ]},
  { t:'Verify Address rejects Latin characters with "Please enter Arabic characters only"',
    pr:'High', ty:'Functional', au:'Automated', pre:PRE_EDIT,
    d:'Address now has Arabic-only validation.',
    steps:[ ...OPEN_EDIT,
      ['Enter Latin text "alex street 5" in the Address field, with all other fields valid', 'The Address field contains Latin text'],
      ["Click 'Confirm'", 'The save is rejected with "Please enter Arabic characters only" shown under the Address field'],
    ]},
  { t:'Verify Address accepts Arabic text containing digits (building/apartment numbers)',
    pr:'High', ty:'Functional', au:'Automated', pre:PRE_EDIT,
    d:'Arabic-only allows Arabic letters plus digits (Arabic-Indic and ASCII) and spaces.',
    steps:[ ...OPEN_EDIT,
      ['Enter an Arabic address containing digits, e.g. "القاهرة المعادي شارع ٩ مبنى 12", with all other fields valid', 'The Address field accepts the Arabic-plus-digits value'],
      ["Click 'Confirm'", 'No Arabic-only validation error is raised for the Address field; the value is accepted'],
    ]},
  { t:'Verify Issuing Authority rejects Latin characters with "Please enter Arabic characters only"',
    pr:'Medium', ty:'Functional', au:'Not Automated', pre:PRE_EDIT,
    d:'Arabic-only validation on Issuing Authority.',
    steps:[ ...OPEN_EDIT,
      ['Enter Latin text in the Issuing Authority field, with all other fields valid', 'The Issuing Authority field contains Latin text'],
      ["Click 'Confirm'", 'The save is rejected with "Please enter Arabic characters only" shown under the Issuing Authority field'],
    ]},

  // ===== D. Issuing Date rule =====
  { t:'Verify Issuing Date in the future is rejected with "Date cannot be today or a future date"',
    pr:'High', ty:'Functional', au:'Automated', pre:PRE_EDIT,
    d:'Issuing Date must be strictly in the past.',
    steps:[ ...OPEN_EDIT,
      ['Set the Issuing Date to a future date, with all other fields valid', 'The Issuing Date field shows the future date'],
      ["Click 'Confirm'", 'The save is rejected (HTTP 400) with the error "Date cannot be today or a future date"'],
    ]},
  { t:'Verify Issuing Date equal to today is rejected',
    pr:'Medium', ty:'Functional', au:'Automated', pre:PRE_EDIT,
    d:"Today's date is excluded (must be in the past).",
    steps:[ ...OPEN_EDIT,
      ["Set the Issuing Date to today's date, with all other fields valid", "The Issuing Date field shows today's date"],
      ["Click 'Confirm'", 'The save is rejected with the error "Date cannot be today or a future date"'],
    ]},
  { t:'Verify Issuing Date in the past is accepted',
    pr:'Medium', ty:'Functional', au:'Automated', pre:PRE_EDIT,
    d:'A past issuing date passes validation.',
    steps:[ ...OPEN_EDIT,
      ['Set the Issuing Date to a valid past date, with all other fields valid', 'The Issuing Date field shows the past date'],
      ["Click 'Confirm'", 'No issuing-date validation error is raised; the date is accepted'],
    ]},

  // ===== E. Persistence / legacy data =====
  { t:'Verify saving with all KYC fields valid persists the new fields to the customer record',
    pr:'High', ty:'Acceptance', au:'Automated', pre:PRE_EDIT,
    d:'On a fully valid Confirm, all new KYC fields are saved (update returns 200 and the payload carries them).',
    steps:[ ...OPEN_EDIT,
      ['Fill every required field with valid Arabic data and a past Issuing Date', 'All required fields contain valid values'],
      ["Click 'Confirm'", 'The form is submitted successfully (HTTP 200) and the modal closes'],
      ['Re-open the Edit Customer Details modal for the same customer', 'Nationality, Issuing Authority, Issuing Date, Other Nationalities, ADIB flag and Occupation reflect the saved values'],
    ]},
  { t:'Verify editing a legacy customer with English Address is blocked until the Address is re-entered in Arabic',
    pr:'Medium', ty:'Functional', au:'Not Automated', pre:PRE_EDIT,
    d:'NEEDS PO DECISION: existing English/legacy data is re-validated, not grandfathered — an existing English address blocks the save until rewritten in Arabic.',
    steps:[ ...OPEN_EDIT,
      ['For an existing customer whose Address is stored in English, fill the new required fields and click \'Confirm\'', 'The save is rejected with "Please enter Arabic characters only" under the Address field'],
      ["Re-enter the Address in Arabic and click 'Confirm'", 'The save succeeds (confirm with PO whether legacy data should be grandfathered)'],
    ]},

  // ===== F. Card collection flow =====
  { t:'Verify the Store Location popup requires a location before the collection actions are enabled',
    pr:'High', ty:'Functional', au:'Automated', pre:PRE_REG_COMPLETE,
    d:'Popup 1 of the collect flow gates both actions on a store selection and shows the Branch Code after selection.',
    steps:[ ...OPEN_VIEW_REG,
      ["Click the 'Card Collected' button", "The 'Select store location' popup is displayed with 'Print Form & Continue' and 'Continue without Printing' disabled"],
      ['Select a store location from the dropdown', 'The Branch Code for the selected location is displayed and both action buttons become enabled'],
    ]},
  { t:'Verify Print Form & Continue is blocked when mandatory KYC data is incomplete (PDF generation gate)',
    pr:'High', ty:'Functional', au:'Automated', pre:PRE_REG_INCOMPLETE,
    d:'PDF generation is blocked and the flow does not advance to Package Number when KYC is incomplete.',
    steps:[ ...OPEN_VIEW_REG,
      ["Click 'Card Collected' and select a store location", "The 'Select store location' popup shows the branch code and enabled actions"],
      ["Click 'Print Form & Continue'", "The PDF request is rejected with 'You have to insert mandatory customer details.' and the popup stays on the Store Location step (does not open the Package Number step)"],
    ]},
  { t:'Verify Continue without Printing opens the Package Number step without generating a PDF',
    pr:'Medium', ty:'Functional', au:'Automated', pre:PRE_REG_COMPLETE,
    d:'The no-print path skips PDF generation and opens Popup 2.',
    steps:[ ...OPEN_VIEW_REG,
      ["Click 'Card Collected' and select a store location", 'The store location is selected and the branch code is displayed'],
      ["Click 'Continue without Printing'", "The 'Confirm card collection by entering package number' popup opens and no PDF is generated"],
    ]},
  { t:'Verify the Package Number is required before card collection can be confirmed',
    pr:'High', ty:'Functional', au:'Automated', pre:PRE_REG_COMPLETE,
    d:'Confirming with an empty Package Number is blocked.',
    steps:[ ...OPEN_VIEW_REG,
      ["Click 'Card Collected', select a store location and click 'Continue without Printing'", 'The Package Number popup is displayed'],
      ["Leave the Package Number field empty and click 'Confirm'", "The inline error 'This field is required.' is shown and the collection is not submitted"],
    ]},
  { t:'Verify a complete-KYC customer can be collected end-to-end and the status becomes Received',
    pr:'High', ty:'Acceptance', au:'Automated', pre:PRE_REG_COMPLETE,
    d:'Full happy path: KYC complete -> PDF generated -> package confirmed -> status Received.',
    steps:[ ...OPEN_VIEW_REG,
      ["Click 'Card Collected', select a store location and click 'Print Form & Continue'", 'The KYC PDF is generated successfully and the Package Number popup opens'],
      ["Enter a valid unused package number and click 'Confirm'", 'The collection is confirmed successfully (HTTP 200, "Status has been successfully changed to Received")'],
      ['Observe the customer status and details', 'The status changes to Received and the Card Collection Date and Package Number are populated'],
    ]},
  { t:'Verify a package number already assigned to another user is rejected on collection',
    pr:'Medium', ty:'Validation', au:'Automated', pre:PRE_REG_COMPLETE,
    d:'Package numbers are unique; reusing one fails.',
    steps:[ ...OPEN_VIEW_REG,
      ["Click 'Card Collected', select a store location and proceed to the Package Number step", 'The Package Number popup is displayed'],
      ["Enter a package number already assigned to another customer and click 'Confirm'", "The collection is rejected with the error 'Package number already assigned before for another user'"],
    ]},

  // ===== G. KYC PDF =====
  { t:'Verify the generated KYC PDF renders Arabic data right-aligned with correct field mapping and blank signatures',
    pr:'High', ty:'Functional', au:'Not Automated', pre:PRE_REG_COMPLETE,
    d:'PDF content check: Arabic data, right-aligned, correct field mapping; signatures blank.',
    steps:[ ...OPEN_VIEW_REG,
      ["Click 'Card Collected', select a store location and click 'Print Form & Continue', then open the generated PDF", 'The KYC PDF opens using the official template with text rendered in Arabic and right-aligned'],
      ['Review the mapped fields on the PDF', 'All mapped fields show correct values: Arabic full name, address, nationality, DOB, place of birth, gender, national ID, issuing authority/date, expiry, mobile, occupation, ADIB flag, branch name/code, employee name/number and KYC file number'],
      ['Inspect the customer and employee signature areas', 'Both the customer and employee signature areas are blank'],
    ]},
  { t:'Verify the post-collection "Print KYC Form" action reprints using saved data and reuses the KYC file number',
    pr:'Medium', ty:'Functional', au:'Not Automated', pre:PRE_RECEIVED,
    d:'Reprint after collection uses the latest saved data and does not regenerate the KYC file number.',
    steps:[ ...OPEN_VIEW_RECEIVED,
      ['Open the actions menu for the Received customer', 'The "Print KYC Form" action is available'],
      ['Select "Print KYC Form"', 'The KYC PDF is regenerated/opened using the latest saved customer and pickup data'],
      ['Compare the KYC file number on the PDF with the one on the customer details', 'The same KYC file number is reused (not regenerated)'],
    ]},

  // ===== H. Permissions / regression =====
  { t:'Verify the Print KYC Form action is gated by its permission and recorded in the audit trail',
    pr:'Medium', ty:'Security', au:'Not Automated', pre:PRE_RECEIVED,
    d:'The print action is permission-protected (no maker-checker) and logged with the customer mobile.',
    steps:[
      ['Log in as a user WITHOUT the print-KYC permission and open a Received customer', 'The "Print KYC Form" action is hidden or access is denied'],
      ['Log in as a permitted user, open the same customer and use "Print KYC Form"', 'The KYC PDF is generated for the permitted user'],
      ['Open the audit log / actions log', 'A "print KYC form" entry is recorded with the customer mobile number and the creator and date'],
    ]},
  { t:'Verify existing Edit Customer save of legacy Arabic-valid records still works after the new validators (regression)',
    pr:'Medium', ty:'Regression', au:'Not Automated', pre:PRE_EDIT,
    d:'No regression to the existing edit-save for records whose data already satisfies the new rules.',
    steps:[ ...OPEN_EDIT,
      ["Without changing any field, click 'Confirm' for a customer whose existing data already satisfies the new rules", 'The save succeeds (HTTP 200) with no new validation errors'],
    ]},
];

// ── CSV emit (one row per step; every step has its Expected Result) ─────────────
function q(v){ const s = String(v==null?'':v); return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; }

const rows = [HEADER.join(',')];
for (const c of CASES) {
  c.steps.forEach((st, i) => {
    const first = i === 0;
    rows.push([
      '',                          // Test Case ID (system)
      first ? c.t : '',
      first ? FOLDER_ID : '',
      first ? FOLDER_PATH : '',
      first ? 'Active' : '',
      first ? OWNER : '',
      first ? c.pr : '',
      first ? normType(c.ty) : '',
      first ? c.au : '',
      first ? c.d : '',
      first ? c.pre : '',
      first ? 'Steps' : '',
      st[0],                       // Steps
      st[1],                       // Expected Result (every step)
      first ? ISSUE : '',
      first ? TAGS : '',
      '', '',                      // Status (latest), Attachments
      '', first ? OWNER : '', '', first ? OWNER : '',
      first ? PROJECT : '',
      '',
    ].map(q).join(','));
  });
}

const out = path.join(__dirname, 'B10-56336_browserstack_testcases.csv');
fs.writeFileSync(out, '﻿' + rows.join('\r\n'), 'utf8');
const stepCount = CASES.reduce((n,c)=>n+c.steps.length,0);
const noExpected = CASES.flatMap(c=>c.steps).filter(s=>!s[1] || !s[1].trim()).length;
console.log(`Wrote ${out}\nCases: ${CASES.length}  Steps: ${stepCount}  Rows(incl header): ${rows.length}  Steps missing expected: ${noExpected}`);
