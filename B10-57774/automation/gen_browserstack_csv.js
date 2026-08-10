'use strict';

/**
 * B10-57774 — BrowserStack Test Management CSV generator (Admin Portal · Perks Nav re-structure).
 *
 * Emits the canonical 24-column shape: the FIRST row of each case carries all metadata plus step 1;
 * every subsequent step is a row with only Steps + Expected Result populated
 * (docs/ai/browserstack-process.md §10.1–10.5). Tags carry the traceability pair `ac:AC-<n>` +
 * `screen:<id>` (§10.2a) so AC coverage is COMPUTED by `qa-cli testcase-lint`, not asserted.
 *
 * SHIFT-LEFT: the feature is NOT deployed. Verified 2026-08-10 — the sidebar renders one flat
 * `Card Perks → /perks` link, the Angular route table has no merchants/categories/mobile-sections child,
 * and `/#/perks/merchants` silently lands on Create perk.
 *
 * Every asserted string comes from one of four authorities, never from invention:
 *   • the AC (verbatim, Jira B10-57774: AC1 nav parent + 4 sub-links · AC2 Perks unchanged · AC3 three
 *     new standalone management screens)
 *   • the DESIGN — 42 frames captured at 2x on 2026-08-10 from the three sections the operator named
 *     (figma kyspsx61WsmZgAgjMpimcu · ../figma-analysis/analysis.md · frames/export/MANIFEST.json)
 *   • the LIVE environment probes of 2026-08-10 (../prerequisites.md, ../evidence/exploratory-notes.md)
 *   • the operator's scope decisions Q1–Q4 (../clarification/clarifications.md)
 *
 * Scope decisions applied here:
 *   Q1  Categories = card/perks/category (name + MCC) · Mobile sections = card/perks/section
 *   Q2  the three screens must support ADD and DELETE; the design is the oracle for their contents
 *   Q3  permissions are OUT OF SCOPE — this suite contains no authorization cases
 *   Q4  AC2 = list + reachability of every existing sub-route (not the in-form pickers)
 *
 * Run: node gen_browserstack_csv.js
 * Out: ../testcases/testcases.csv
 */

const fs = require('fs');
const path = require('path');

const HEADER = ['Test Case ID', 'Title', 'Folder ID', 'Folder Path', 'State', 'Owner', 'Priority',
  'Type of Test Case', 'Automation Status', 'Description', 'Preconditions', 'Template', 'Steps',
  'Expected Result', 'Issues', 'Tags', 'Status (latest)', 'Attachments', 'Created At', 'Created By',
  'Last Updated At', 'Last Updated By', 'Project Name', 'Test Case URL'];

const OWNER = 'Fintech';
const ISSUES = 'B10-57774';

// ── Import destination (operator-supplied 2026-08-10, resolved + verified against the TM API) ──
//   shared link → numeric project 2407303 · folder 54241929
//   project     → PR-5 "BCard Squad"
//   folder      → 54241929 "Admin Portal- Perks Nav re-structure"
//                 parent 54229450 "Card Ops.Sprint3.4" · cases_count 0 · sub_folders_count 0
const PROJECT = 'BCard Squad';
const FOLDER_PATH = 'Card Ops.Sprint3.4/Admin Portal- Perks Nav re-structure';
const BS_PROJECT_ID = 'PR-5';
const BS_FOLDER_ID = 54241929;

// ── Screens (the `screen:` tag vocabulary — pairs each case to captured design frames) ──
const S_NAV = 'card-perks-nav';        // the sidebar, visible in every frame
const S_PERKS = 'perks-list';          // the pre-existing perks list (AC2)
const S_MER_LIST = 'merchants-list';   // merchants_list / merchants_added_success
const S_MER_FORM = 'merchants-create'; // merchants_add_1/2, add_logo, add_error
const S_MER_DET = 'merchants-details'; // merchants_view / _connected_to_perk / _edit
const S_CAT_LIST = 'categories-list';
const S_CAT_FORM = 'categories-create';
const S_CAT_DET = 'categories-details';
const S_SEC_LIST = 'sections-list';
const S_SEC_FORM = 'sections-create';
const S_SEC_DET = 'sections-details';

// ── Live environment facts (probed 2026-08-10, ../prerequisites.md) ──
// merchant/list 200 (10 rows) · category/list 200 (10 rows) · section/list 200 (12 rows)
// create exists for all three (400-validates) · section/update exists · NO delete/get for any (404)
// perks list = 15 rows/page, newest-first · perk create form is progressive (Perk type first)
const APP_URL = 'https://card-panel-testing.breadfast.tech';

const PRE_BASE = `Admin/ops user has valid Breadfast Pay Admin Portal credentials (${APP_URL}). `
  + 'The Perks nav re-structure is deployed to the environment under test.';
const PRE_MER = `${PRE_BASE} At least one merchant exists whose "Added to a perk" value is No, and at `
  + 'least one whose value is Yes (seed via POST /api/v1/web/card/perks/merchant/create and by attaching '
  + 'one merchant to a perk, so both delete states are provable).';
const PRE_CAT = `${PRE_BASE} At least one category exists whose "Added to a perk" value is No, and at `
  + 'least one whose value is Yes. One known category name and one known category code are recorded so '
  + 'the duplicate-validation cases have a real collision to submit.';
const PRE_SEC = `${PRE_BASE} At least one mobile section exists with no perks in it and at least one `
  + 'with perks in it (12 sections exist on the environment; capture the chosen fixtures by id before '
  + 'the run because the list is a shared live oracle and can change mid-run).';
const PRE_PERKS = `${PRE_BASE} The perks list contains at least 16 perks so the first page is full and `
  + 'pagination is exercised, and the id of one existing perk is recorded for the edit/duplicate deep '
  + 'links.';

// ── Reusable step atoms ──
const LOGIN = ['Log in to the Breadfast Pay Admin Portal as an admin/ops user.',
  'The admin is authenticated and the Admin Portal dashboard is displayed with the left navigation.'];
const EXPAND = ['Click the "Card perks" item in the left navigation.',
  'The "Card perks" item expands and reveals its sub-links; its chevron points up to indicate the expanded state.'];
const gotoChild = (label, title) => [`Click the "${label}" sub-link under "Card perks".`,
  `The "${label}" screen is displayed and its page title reads "${title}".`];

const cases = [];

module.exports = { cases, HEADER, OWNER, ISSUES, PROJECT, FOLDER_PATH, BS_PROJECT_ID, BS_FOLDER_ID,
  S_NAV, S_PERKS, S_MER_LIST, S_MER_FORM, S_MER_DET, S_CAT_LIST, S_CAT_FORM, S_CAT_DET,
  S_SEC_LIST, S_SEC_FORM, S_SEC_DET,
  PRE_BASE, PRE_MER, PRE_CAT, PRE_SEC, PRE_PERKS, LOGIN, EXPAND, gotoChild, APP_URL };
