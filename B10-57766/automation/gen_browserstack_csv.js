'use strict';

/**
 * B10-57766 — BrowserStack Test Management CSV generator (Homepage Perks Management).
 *
 * Emits the canonical 24-column shape: the FIRST row of each case carries all metadata plus
 * step 1; every subsequent step is a row with only Steps + Expected Result populated
 * (docs/ai/browserstack-process.md §10.1–10.5). Tags carry the traceability pair
 * `ac:AC-<n>` + `screen:<id>` (§10.2a) so AC coverage is COMPUTED by `qa-cli testcase-lint`.
 *
 * SHIFT-LEFT: the feature is NOT deployed (all homepage endpoints 404, 0 hits in 33 FE chunks).
 * Every string asserted below comes from one of three authorities, never from invention:
 *   • the AC (verbatim, Jira B10-57766)
 *   • the design frames captured 2026-08-10 (figma kyspsx61WsmZgAgjMpimcu, 5 frames @2x)
 *   • the LIVE environment probes of 2026-08-10 (../prerequisites.md, ../evidence/exploratory-notes.md)
 * Decisions D1–D4 and open items C-1…C-8: ../clarification/clarifications.md.
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
const ISSUES = 'B10-57766';

// ── Import destination (operator-supplied 2026-08-10, resolved + verified against the TM API) ──
//   shared link  → numeric project 2407303 · folder 54235790
//   project      → PR-5 "BCard Squad"
//   folder       → 54235790 "Admin Portal - Homepage Perks Management"
//                  parent 54229450 "Card Ops.Sprint3.4" · cases_count 0 (empty, created for this story)
// The numeric project id appears ONLY in `urls.self` on the paginated /projects list — GET /projects
// does not return it (browserstack_test_run.js §Traps).
const PROJECT = 'BCard Squad';
const FOLDER_PATH = 'Card Ops.Sprint3.4/Admin Portal - Homepage Perks Management';
const BS_PROJECT_ID = 'PR-5';
const BS_FOLDER_ID = 54235790;

// ── Screens (the `screen:` tag vocabulary — pairs each case to a captured design frame) ──
const S_LIST = 'perks-list';        // frame perks_list_all_perks_2x.png        node 6075:18311
const S_HOME = 'homepage-perks';    // frame homepage_perks_default_2x.png      node 5893:261810
const S_MODAL = 'replace-modal';    // frame homepage_perks_replace_modal_2x.png node 5893:262234
const S_TOAST = 'save-success';     // frame homepage_perks_save_success_2x.png node 5893:263160

// ── Live environment facts (probed 2026-08-10) ───────────────────────────────────────────
// 195 perks · types discount-coupon 65 / merchant-cashback 65 / general-cashback 47 /
// category-cashback 18 · active 103 / expired 90 / planned 2 · 12 sections, 7 perks section=null
// listPerks contract: { skip:<1-based page>, filter:{status,type,section_id} } · 15 rows/page
// Per-section type distribution verified live 2026-08-10 (probe over all 195 perks):
const SECTION_A = 'Breadfast';            // 77 perks, all 4 types (discount-coupon 12) — spans > 1 page
const SECTION_B = 'General Purchases';    // 35 perks, all 4 types
const SECTION_C = 'Coffee & Beverages';   // 5 perks, only 3 types — NO category-cashback ⇒ the verified
                                          //   no-match combination is SECTION_C + "Category cashback"
const TYPE_ABSENT_IN_C = 'Category cashback';

const PRE_BASE = 'Admin/ops user has valid Breadfast Pay Admin Portal credentials '
  + '(https://card-panel-testing.breadfast.tech) with the homepage-management permission. The Homepage '
  + 'Perks Management feature is deployed to the environment under test.';
const PRE_CURATED = `${PRE_BASE} The homepage currently holds a known, recorded set of 5 perks with a `
  + 'recorded order (capture it via the homepage list endpoint before the test so the before/after state '
  + 'is provable).';
const PRE_FIXTURES = `${PRE_CURATED} Seeded fixtures exist for this run: one active perk NOT currently on `
  + 'the homepage, one perk with start_date in the future (planned) and one perk with end_date in the past '
  + '(expired). Perk status is virtual (derived from dates), so seed these per run rather than reusing '
  + 'discovered rows.';

// ── Reusable step atoms ─────────────────────────────────────────────────────────────────
const LOGIN = ['Log in to the Breadfast Pay Admin Portal with an admin that has the homepage-management permission.',
  'The admin is authenticated and the Admin Portal dashboard is displayed.'];
const GOTO_PERKS = ['Navigate to the Card perks > Perks list.',
  'The Card perks list is displayed with its perk rows and the page header actions.'];
const GOTO_HOME = ['Click the "Manage homepage" button in the top-right of the Perks list.',
  'The "Homepage perks" screen is displayed, showing the curated homepage perks and a "Save" button in the top-right.'];
const openReplace = (n) => [`Click the "Replace" button on row ${n} of the Homepage perks table.`,
  'The "Select a perk to replace" modal opens over the Homepage perks screen.'];
const RELOAD_HOME = ['Reload the Homepage perks screen in the browser.',
  'The screen re-renders from the server.'];
// One action per step (canonical granularity): selecting a perk and confirming it are separate steps.
const selectPerk = (what) => [`Select the row selector for ${what} in the modal table.`,
  'That row becomes the single selected row in the table.'];
const CONFIRM_REPLACE = ['Click the "Replace" CTA in the modal.',
  'The modal closes and the Homepage perks screen is displayed again.'];
const CLICK_SAVE = ['Click the page-level "Save" button in the top-right.',
  'The save request is submitted and a green success message is displayed.'];
const setFilter = (label, value) => [`Select "${value}" in the "${label}" filter dropdown.`,
  `The "${label}" filter shows "${value}" as its selected value.`];
const clearFilter = (label) => [`Set the "${label}" filter back to its all/unfiltered option.`,
  `The "${label}" filter shows the all/unfiltered option as its selected value.`];
const APPLY = ['Click the "Search" button to apply the filters.',
  'The modal table reloads with the selected filters applied.'];

const cases = [];

// ══ HLS 1 · AC1 — entry point ═══════════════════════════════════════════════════════════
cases.push({
  title: 'Verify the Manage homepage button appears top-right of the Perks list next to Add perk',
  priority: 'Critical', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-1'], screens: [S_LIST],
  description: 'AC1 — the Perks list header exposes a "Manage homepage" button positioned top-right, '
    + 'adjacent to the pre-existing "Add perk" button.',
  pre: PRE_BASE,
  steps: [
    LOGIN,
    GOTO_PERKS,
    ['Inspect the top-right area of the Perks list page header.',
      'Two action buttons are displayed side by side in the top-right: "Manage homepage" and "Add perk".'],
    ['Read the label of the new button.',
      'The label reads exactly "Manage homepage".'],
    ['Confirm the position of "Manage homepage" relative to "Add perk".',
      '"Manage homepage" is adjacent to "Add perk" in the same top-right header group; neither button overlaps or displaces the other.'],
    ['Confirm the "Add perk" button is still present and enabled.',
      '"Add perk" remains present, enabled and unchanged in appearance.'],
  ],
});

cases.push({
  title: 'Verify the Manage homepage button navigates to the Homepage perks screen',
  priority: 'Critical', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-1'], screens: [S_LIST, S_HOME],
  description: 'AC1 — the "Manage homepage" button opens the dedicated Homepage perks screen.',
  pre: PRE_CURATED,
  steps: [
    LOGIN,
    GOTO_PERKS,
    ['Click the "Manage homepage" button.',
      'The application navigates away from the Perks list to a dedicated screen.'],
    ['Read the page title of the screen that opened.',
      'The page title reads "Homepage perks".'],
    ['Inspect the top-right of the Homepage perks screen.',
      'A single page-level "Save" button is displayed in the top-right.'],
  ],
});

// ══ HLS 2 · AC2 — rows and columns ══════════════════════════════════════════════════════
cases.push({
  title: 'Verify the Homepage perks screen renders at most 5 rows',
  priority: 'Critical', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-2'], screens: [S_HOME],
  description: 'AC2 — the curated homepage set is capped at 5. The screen must never render a 6th row.',
  pre: PRE_CURATED,
  steps: [
    LOGIN, GOTO_PERKS, GOTO_HOME,
    ['Count the perk rows rendered in the Homepage perks table.',
      'At most 5 perk rows are rendered; the count matches the curated set returned by the homepage list endpoint.'],
    ['Compare the rendered rows against the recorded curated set.',
      'Every rendered row corresponds to a perk in the curated set, in the same order, with no extra or missing row.'],
  ],
});

cases.push({
  title: 'Verify the Homepage perks table shows the columns ID, Category, Type, Title, Description and Status',
  priority: 'Critical', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-2'], screens: [S_HOME],
  description: 'AC2 — the six named columns are present, in the AC order.',
  pre: PRE_CURATED,
  steps: [
    LOGIN, GOTO_PERKS, GOTO_HOME,
    ['Read the column headers of the Homepage perks table from left to right.',
      'The headers include ID, Category, Type, Title, Description and Status, in that relative order.'],
    ['Read the values in the ID and Title columns of the first row.',
      'ID shows the perk identifier (for example "MC_3" / "DC_29" form) and Title shows that perk\'s English title.'],
    ['Read the values in the Type and Description columns of the first row.',
      'Type shows the perk type and Description shows that perk\'s English description; neither cell is empty for a perk that has those values.'],
  ],
});

cases.push({
  title: 'Verify every Homepage perks row exposes a drag handle and a Replace button',
  priority: 'Critical', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-2'], screens: [S_HOME],
  description: 'AC2 — per-row affordances: one drag handle and one "Replace" button on each row, plus '
    + 'exactly one page-level "Save" for the whole screen.',
  pre: PRE_CURATED,
  steps: [
    LOGIN, GOTO_PERKS, GOTO_HOME,
    ['Inspect the leading edge of each rendered row.',
      'Every row displays a drag handle control at its leading edge.'],
    ['Inspect the trailing edge of each rendered row.',
      'Every row displays a "Replace" button labelled exactly "Replace".'],
    ['Count the "Save" controls on the screen.',
      'Exactly one "Save" button exists, at page level in the top-right — there is no per-row Save.'],
    ['Confirm no per-row delete, remove or actions-menu control is present.',
      'No remove/delete affordance and no "..." actions menu is rendered on any row; Replace is the only row operation.'],
  ],
});

// ══ HLS 4 · AC2 — column data resolution ════════════════════════════════════════════════
cases.push({
  title: 'Verify the Homepage perks Status column reflects each perk live lifecycle state',
  priority: 'High', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-2'], screens: [S_HOME],
  description: 'AC2 — Status is a virtual value computed live from the perk\'s start_date/end_date '
    + '(planned / active / expired), not a stored field. A curated perk that has drifted out of its '
    + 'active window must still show its real state.',
  pre: PRE_FIXTURES,
  steps: [
    LOGIN, GOTO_PERKS, GOTO_HOME,
    ['Read the Status value of a curated perk whose start_date is in the past and end_date in the future.',
      'Status reads "Active".'],
    openReplace(5),
    selectPerk('the seeded planned perk (start_date in the future)'),
    CONFIRM_REPLACE,
    CLICK_SAVE,
    GOTO_HOME,
    ['Read the Status value of row 5.',
      'Row 5 holds the seeded planned perk and its Status reads "Planned".'],
    ['Using the perk-update API, move the end_date of the ACTIVE curated perk identified in step 4 to a date in the past, so it becomes expired while it sits on the homepage.',
      'The perk update succeeds.'],
    RELOAD_HOME,
    ['Read the row for that perk.',
      'The row is still present on the screen and its Status now reads "Expired" — the slot is not silently removed and not auto-refilled.'],
  ],
});

cases.push({
  title: 'Verify the Homepage perks Category column resolves to the perk mobile Section name',
  priority: 'High', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-2'], screens: [S_HOME],
  description: 'AC2 — "Category" is sourced from the perk\'s mobile Section (clarification D3). Includes '
    + 'the section-less edge case: 7 live perks have section = null.',
  pre: `${PRE_CURATED} At least one curated perk belongs to the "${SECTION_A}" section, and one seeded `
    + 'perk has no section assigned (section = null).',
  steps: [
    LOGIN, GOTO_PERKS, GOTO_HOME,
    [`Read the Category value of the curated perk that belongs to the "${SECTION_A}" section.`,
      `The Category cell reads "${SECTION_A}" — the perk's mobile Section name, matching the value the Perks list shows for the same perk.`],
    openReplace(4),
    selectPerk('the seeded perk that has no section assigned'),
    CONFIRM_REPLACE,
    CLICK_SAVE,
    GOTO_HOME,
    ['Read the Category cell of row 4.',
      'The row renders without error and its Category cell is empty or shows a neutral placeholder — it does not render the literal text "null" or "undefined", and the table layout is not broken.'],
  ],
});

// ══ HLS 5 · AC3 — modal opens ═══════════════════════════════════════════════════════════
cases.push({
  title: 'Verify clicking Replace opens the Select a perk to replace modal with Category and Type filters',
  priority: 'Critical', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-3'], screens: [S_HOME, S_MODAL],
  description: 'AC3 — the per-row Replace button opens a modal titled "Select a perk to replace" that '
    + 'exposes a Category filter, a Type filter and its own "Replace" CTA.',
  pre: PRE_CURATED,
  steps: [
    LOGIN, GOTO_PERKS, GOTO_HOME,
    openReplace(1),
    ['Read the modal title.',
      'The title reads exactly "Select a perk to replace".'],
    ['Inspect the filter controls at the top of the modal.',
      'Two filter dropdowns are displayed, labelled "Category" and "Type", plus a "Search" control that applies them.'],
    ['Inspect the modal for its confirm action.',
      'A "Replace" CTA is displayed in the modal.'],
    ['Inspect the modal for a perk table.',
      'A table of selectable perks is displayed with a pagination control beneath it.'],
  ],
});

cases.push({
  title: 'Verify the Replace modal table shows the columns ID, Category, Type, Title, Description, Status and Featured',
  priority: 'Critical', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-3'], screens: [S_MODAL],
  description: 'AC3 — the modal table exposes the seven named columns. NOTE: the "Featured" column has '
    + 'no backing data until B10-57764 ships (no `featured` field exists on any perk today). If the field '
    + 'is still absent at execution, report the Featured assertion as NOT VERIFIABLE with evidence — '
    + 'never as passed (clarifications B5).',
  pre: PRE_CURATED,
  steps: [
    LOGIN, GOTO_PERKS, GOTO_HOME,
    openReplace(1),
    ['Read the column headers of the modal table from left to right.',
      'The headers include ID, Category, Type, Title, Description, Status and Featured, in that relative order.'],
    ['Read the ID, Type and Status values of the first table row.',
      'ID shows the perk identifier, Type shows the perk type and Status shows the perk\'s live lifecycle state.'],
    ['Read the Featured value of the first table row.',
      'The Featured cell renders "Yes" or "No". If the underlying `featured` field does not exist in the environment, record the observed rendering and report this assertion as Not Verifiable rather than passed.'],
  ],
});

// ══ HLS 7 · AC3 — filters ═══════════════════════════════════════════════════════════════
cases.push({
  title: 'Verify the Replace modal Category filter narrows the perk list to the selected section',
  priority: 'High', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-3'], screens: [S_MODAL],
  description: 'AC3 — the Category filter restricts the table to perks in the chosen mobile Section. '
    + 'Filter values are live section names, never the design\'s placeholder values (clarification D3).',
  pre: `${PRE_CURATED} The environment has perks across multiple sections, including "${SECTION_A}" and "${SECTION_C}".`,
  steps: [
    LOGIN, GOTO_PERKS, GOTO_HOME,
    openReplace(1),
    ['Open the "Category" filter dropdown.',
      'The dropdown lists the environment\'s live mobile Section names (for example "Breadfast", "General Purchases", "Coffee & Beverages") plus an all/unfiltered option.'],
    setFilter('Category', SECTION_C),
    APPLY,
    ['Read the Category value of every rendered row.',
      `Every rendered row shows Category "${SECTION_C}"; no row from any other section is listed.`],
    clearFilter('Category'),
    APPLY,
    ['Read the Category values again.',
      'Rows from more than one section are listed again — the filter was cleared.'],
  ],
});

cases.push({
  title: 'Verify the Replace modal Type filter narrows the perk list to the selected perk type',
  priority: 'High', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-3'], screens: [S_MODAL],
  description: 'AC3 — the Type filter restricts the table to the chosen perk type. Four types exist live: '
    + 'discount-coupon, merchant-cashback, general-cashback, category-cashback.',
  pre: PRE_CURATED,
  steps: [
    LOGIN, GOTO_PERKS, GOTO_HOME,
    openReplace(1),
    ['Open the "Type" filter dropdown.',
      'The dropdown lists the available perk types plus an all/unfiltered option.'],
    setFilter('Type', 'General cashback'),
    APPLY,
    ['Read the Type value of every rendered row.',
      'Every rendered row shows Type "General cashback".'],
    setFilter('Type', 'Discount/Coupon'),
    APPLY,
    ['Read the Type value of every rendered row again.',
      'Every rendered row shows Type "Discount/Coupon" and no general-cashback row remains.'],
  ],
});

cases.push({
  title: 'Verify the Replace modal Category and Type filters narrow the perk list in combination',
  priority: 'Medium', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-3'], screens: [S_MODAL],
  description: 'AC3 — both filters apply together (verified supported by the underlying list contract, '
    + 'which accepts filter.section_id and filter.type simultaneously).',
  pre: `${PRE_CURATED} The "${SECTION_A}" section contains perks of more than one type.`,
  steps: [
    LOGIN, GOTO_PERKS, GOTO_HOME,
    openReplace(1),
    setFilter('Category', SECTION_A),
    APPLY,
    ['Record the number of rows and the perk IDs returned for the Category-only filter.',
      `Only perks whose Category is "${SECTION_A}" are listed, and the result is recorded.`],
    setFilter('Type', 'Discount/Coupon'),
    APPLY,
    ['Read the Category and Type values of every rendered row.',
      `Every rendered row shows Category "${SECTION_A}" AND Type "Discount/Coupon", and the result is a subset of the Category-only result recorded earlier.`],
    clearFilter('Type'),
    APPLY,
    ['Read the rendered rows again.',
      `All "${SECTION_A}" perks are listed again regardless of type, matching the Category-only result recorded earlier.`],
  ],
});

cases.push({
  title: 'Verify a Replace modal filter combination that matches no perk shows an empty result without an error',
  priority: 'Medium', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-3'], screens: [S_MODAL],
  description: 'AC3 — the no-match state. The underlying list returns HTTP 200 with zero rows for a '
    + 'non-matching filter, so the modal must render an empty table rather than an error.',
  pre: `${PRE_CURATED} Verified live on 2026-08-10: the "${SECTION_C}" section holds 5 perks across only `
    + `3 types and contains NO "${TYPE_ABSENT_IN_C}" perk, so that pairing is a genuine no-match. `
    + 'Re-confirm the pairing still returns zero rows before running, since perks are added continuously.',
  steps: [
    LOGIN, GOTO_PERKS, GOTO_HOME,
    openReplace(1),
    setFilter('Category', SECTION_C),
    setFilter('Type', TYPE_ABSENT_IN_C),
    APPLY,
    ['Count the perk rows rendered in the modal table.',
      'Zero perk rows are rendered.'],
    ['Inspect the modal for error output.',
      'No error toast, error banner or browser console error is shown — the empty result is presented as an ordinary empty table.'],
    clearFilter('Type'),
    APPLY,
    ['Count the perk rows rendered in the modal table.',
      `Rows are listed again for the "${SECTION_C}" section — the modal recovered from the empty result and remains usable.`],
  ],
});

// ══ HLS 8 · AC3 — pagination ════════════════════════════════════════════════════════════
cases.push({
  title: 'Verify the Replace modal pagination traverses pages and stops at the last page',
  priority: 'High', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-3'], screens: [S_MODAL],
  description: 'AC3 — the table is paginated. The underlying contract pages by a 1-based `skip` at 15 rows '
    + 'per page and returns NO total count, so the boundary is where a page returns zero rows. Do not '
    + 'assert the 7 rows the design mock draws.',
  pre: `${PRE_CURATED} The environment holds 195 perks, so an unfiltered list spans multiple pages.`,
  steps: [
    LOGIN, GOTO_PERKS, GOTO_HOME,
    openReplace(1),
    ['Record the perk IDs rendered on the first page of the modal table.',
      'A page of perk rows is displayed and its IDs are recorded.'],
    ['Advance to the next page using the pagination control.',
      'The table renders a different set of perk rows; none of the recorded first-page IDs appear.'],
    ['Return to the previous page using the pagination control.',
      'The table renders the originally recorded first-page IDs again, in the same order.'],
    ['Advance forward repeatedly until the last page of results is reached.',
      'The final page renders the remaining rows and the control does not advance past it — no empty page and no error is shown.'],
    [`Apply the Category filter "${SECTION_C}" (fewer perks than one page) and inspect the pagination control.`,
      'The result fits on a single page and the pagination control offers no further page to advance to.'],
  ],
});

// ══ HLS 9 · AC3 — single select ═════════════════════════════════════════════════════════
cases.push({
  title: 'Verify the Replace modal row selector is single-select',
  priority: 'Critical', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-3'], screens: [S_MODAL],
  description: 'AC3 — a single-select radio per row: exactly one perk can be chosen at a time, so '
    + 'selecting a second row must clear the first.',
  pre: PRE_CURATED,
  steps: [
    LOGIN, GOTO_PERKS, GOTO_HOME,
    openReplace(1),
    ['Select the row selector on the first perk row.',
      'The first row becomes selected and no other row is selected.'],
    ['Select the row selector on a different perk row.',
      'The newly chosen row becomes selected AND the previously selected row is deselected — exactly one row is selected.'],
    ['Count the selected row selectors in the table.',
      'Exactly one row selector is in the selected state.'],
    ['Change the Category filter, apply it, and inspect the selection state.',
      'The table reloads; the selection state is either cleared or preserved consistently, and in no case are two rows selected at once.'],
  ],
});

// ══ HLS 11 · AC4 — swap only the originating slot ═══════════════════════════════════════
cases.push({
  title: 'Verify confirming the modal Replace CTA swaps only the slot the modal was opened from',
  priority: 'Critical', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-4'], screens: [S_MODAL, S_HOME],
  description: 'AC4 — confirming a replacement swaps that slot\'s perk on the Homepage perks screen. The '
    + 'other four rows and their order must be untouched.',
  pre: PRE_FIXTURES,
  steps: [
    LOGIN, GOTO_PERKS, GOTO_HOME,
    ['Record the perk ID in each of the 5 Homepage perks rows, in order.',
      'The 5 perk IDs and their positions are recorded as the before-state.'],
    openReplace(3),
    selectPerk('the seeded active perk that is not currently on the homepage'),
    CONFIRM_REPLACE,
    ['Read the perk ID now shown in row 3.',
      'Row 3 shows the newly selected perk\'s ID; its Category, Type, Title, Description and Status cells all update to that perk\'s values.'],
    ['Compare rows 1, 2, 4 and 5 against the recorded before-state.',
      'Rows 1, 2, 4 and 5 hold exactly the same perk IDs in the same positions as before — only row 3 changed.'],
  ],
});

// ══ HLS 12 · AC4 — staged, not persisted ════════════════════════════════════════════════
cases.push({
  title: 'Verify a staged replacement is not persisted until Save is clicked',
  priority: 'Critical', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-4'], screens: [S_HOME],
  description: 'AC4 — the change is not persisted until "Save" is clicked on the parent screen. This is '
    + 'the story\'s central rule and its highest risk: non-persistence must be proven by reloading and by '
    + 'navigating away, NOT by the absence of a success message.',
  pre: PRE_FIXTURES,
  steps: [
    LOGIN, GOTO_PERKS, GOTO_HOME,
    ['Open the browser developer tools network panel and begin capturing requests.',
      'Network capture is active and recording requests for this page.'],
    ['Record the perk ID in each of the 5 rows, in order.',
      'The before-state is recorded.'],
    openReplace(2),
    selectPerk('the seeded active perk that is not currently on the homepage'),
    CONFIRM_REPLACE,
    ['Read the perk ID shown in row 2.',
      'Row 2 shows the newly selected perk.'],
    ['Inspect the captured network requests made since the modal was confirmed.',
      'No request that writes the homepage set (no homepage save call) has been issued — the change is client-side only.'],
    RELOAD_HOME,
    ['Read the perk ID in each of the 5 rows after the reload.',
      'All 5 rows match the recorded before-state — the staged replacement was discarded and nothing was persisted.'],
  ],
});

cases.push({
  title: 'Verify a staged replacement is discarded when the admin navigates away without saving',
  priority: 'High', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-4'], screens: [S_HOME, S_LIST],
  description: 'AC4 — leaving the screen without saving must not persist the staged change. Also records '
    + 'whether an unsaved-changes warning exists: none is specified in the AC or drawn in the design '
    + '(open item C-1 / design gap G-03), so its absence is recorded, not failed.',
  pre: PRE_FIXTURES,
  steps: [
    LOGIN, GOTO_PERKS, GOTO_HOME,
    ['Record the perk ID in each of the 5 rows, in order.',
      'The before-state is recorded.'],
    openReplace(4),
    selectPerk('a perk that is not currently on the homepage'),
    CONFIRM_REPLACE,
    ['Read the perk ID shown in row 4.',
      'Row 4 shows the newly selected perk.'],
    ['Navigate away to the Card perks > Perks list without clicking "Save".',
      'The Perks list is displayed. Record whether any unsaved-changes confirmation was presented — the AC and the design specify none, so either behaviour is recorded as an observation rather than a failure.'],
    GOTO_HOME,
    ['Read the perk ID in each of the 5 rows.',
      'All 5 rows match the recorded before-state — the staged replacement was not persisted.'],
  ],
});

// ══ HLS 13 · AC6 — drag reorder in the UI ═══════════════════════════════════════════════
cases.push({
  title: 'Verify dragging a row by its handle reorders the Homepage perks list in the UI',
  priority: 'Critical', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-6'], screens: [S_HOME],
  description: 'AC6 — homepage perks can be reordered via the drag handle.',
  pre: PRE_CURATED,
  steps: [
    LOGIN, GOTO_PERKS, GOTO_HOME,
    ['Record the perk ID in each of the 5 rows, in order.',
      'The before-order is recorded.'],
    ['Drag row 1 by its drag handle and drop it below row 3.',
      'The row moves to the new position and the intervening rows shift up by one; the table renders 5 rows in the new order.'],
    ['Read the perk ID in each of the 5 rows after the drag.',
      'The order matches the intended new order: the perk formerly in row 1 now occupies position 3, and no perk was duplicated or lost.'],
    ['Drag row 5 by its drag handle and drop it at position 1.',
      'The perk formerly in row 5 now occupies position 1 and the remaining rows shift down by one; the set still contains exactly the same 5 perk IDs.'],
  ],
});

cases.push({
  title: 'Verify a staged reorder is not persisted until Save is clicked',
  priority: 'Critical', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-6'], screens: [S_HOME],
  description: 'AC6 — reordering requires a subsequent Save to persist. Proven by reload, and by the '
    + 'absence of any write request before Save.',
  pre: PRE_CURATED,
  steps: [
    LOGIN, GOTO_PERKS, GOTO_HOME,
    ['Open the browser developer tools network panel and begin capturing requests.',
      'Network capture is active and recording requests for this page.'],
    ['Record the perk ID in each of the 5 rows, in order.',
      'The before-order is recorded.'],
    ['Drag row 1 by its drag handle and drop it at position 4, without clicking "Save".',
      'The table renders the perks in the new order.'],
    ['Inspect the captured network requests made since the drop.',
      'No request that writes the homepage order has been issued — the reorder is client-side only.'],
    RELOAD_HOME,
    ['Read the perk ID in each of the 5 rows after the reload.',
      'The order matches the recorded before-order exactly — the staged reorder was discarded.'],
  ],
});

// ══ HLS 15 · AC4 + AC6 — Save persists both ═════════════════════════════════════════════
cases.push({
  title: 'Verify Save persists a replacement and a reorder staged in the same session',
  priority: 'Critical', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-4', 'AC-6'], screens: [S_HOME],
  description: 'AC4 + AC6 — both staged mutations are committed by one Save, and the persisted order is '
    + 'the final displayed order. The interaction of the two staged mutations is the failure point.',
  pre: PRE_FIXTURES,
  steps: [
    LOGIN, GOTO_PERKS, GOTO_HOME,
    ['Record the perk ID in each of the 5 rows, in order.',
      'The before-state is recorded.'],
    openReplace(2),
    selectPerk('the seeded active perk that is not currently on the homepage'),
    CONFIRM_REPLACE,
    ['Read the perk ID shown in row 2.',
      'Row 2 shows the newly selected perk.'],
    ['Drag row 5 by its drag handle and drop it at position 1.',
      'The table renders the 5 perks in the new order, still including the replacement made in row 2.'],
    ['Record the final displayed order of all 5 perk IDs.',
      'The intended final order is recorded.'],
    CLICK_SAVE,
    ['Reopen the Homepage perks screen from the Perks list.',
      'The screen renders the 5 perks in exactly the recorded final order, including the replaced perk — both the replacement and the reorder were persisted.'],
    ['Read the persisted set from the homepage list endpoint.',
      'The endpoint returns the same 5 perk IDs in the same order as the screen, each with a distinct sequential display order.'],
  ],
});

// ══ HLS 16 · AC5 — banner + return ══════════════════════════════════════════════════════
cases.push({
  title: 'Verify Save shows the green success message Perks added to homepage and returns to the Card Perks List',
  priority: 'Critical', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-5'], screens: [S_HOME, S_TOAST, S_LIST],
  description: 'AC5 — on save, a green success message reading "Perks added to homepage." is shown and the '
    + 'admin is returned to the Card Perks List. The AC writes the string with an unbalanced closing '
    + 'quote; the design renders "Perks added to homepage." and that is the asserted string '
    + '(clarifications B1). The design uses a toast/snackbar component, so assert the text and the '
    + 'green success styling rather than the widget type (clarifications B2).',
  pre: PRE_FIXTURES,
  steps: [
    LOGIN, GOTO_PERKS, GOTO_HOME,
    openReplace(1),
    selectPerk('a perk that is not currently on the homepage'),
    CONFIRM_REPLACE,
    ['Read the perk ID shown in row 1.',
      'Row 1 shows the newly selected perk.'],
    ['Click the page-level "Save" button in the top-right.',
      'A success message appears, presented in the green/success style.'],
    ['Read the success message text character for character.',
      'The message reads exactly "Perks added to homepage." — capital P, lowercase "homepage", trailing full stop.'],
    ['Observe where the application lands after the save.',
      'The admin is returned to the Card Perks List screen.'],
    ['Reopen the Homepage perks screen.',
      'Row 1 holds the replaced perk — the saved set persisted.'],
  ],
});

// ══ HLS 17 · AC4 — invalid saves are rejected, prior set survives ═══════════════════════
cases.push({
  title: 'Verify the homepage save rejects more than 5 perks and a duplicate perk',
  priority: 'Critical', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-4'], screens: [S_HOME],
  description: 'AC4 / AC2 — the cap of 5 and the one-perk-one-slot rule (clarification D4) are enforced by '
    + 'the save, not only by the UI. The cap is application-enforced rather than a database constraint, so '
    + 'it must be exercised at the API layer where the UI cannot over-fill it.',
  pre: PRE_CURATED,
  steps: [
    LOGIN,
    ['Read the currently persisted homepage set from the homepage list endpoint and record it.',
      'The endpoint returns the curated set of at most 5 perks in order; this is the before-state.'],
    ['Call the homepage save endpoint with 6 valid, distinct perk IDs.',
      'The request is rejected with a validation error; no partial write occurs.'],
    ['Read the homepage set again from the list endpoint.',
      'The set is byte-for-byte the recorded before-state — the rejected save left the previous homepage intact and did not empty it.'],
    ['Call the homepage save endpoint with 5 perk IDs where the same perk ID appears twice.',
      'The request is rejected with a validation error naming the duplicate.'],
    ['Read the homepage set again from the list endpoint.',
      'The set still matches the recorded before-state.'],
    GOTO_PERKS, GOTO_HOME,
    ['Attempt through the UI to place a perk that already occupies another slot into a second slot.',
      'The modal either excludes/disables perks already on the homepage, or the subsequent Save is rejected with a clear error — the same perk never ends up in two slots.'],
  ],
});

cases.push({
  title: 'Verify the homepage save rejects a non-existent perk and an already-expired perk',
  priority: 'High', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-4'], screens: [S_HOME],
  description: 'AC4 — referential existence and the expired-perk guard. NOTE: the expired-perk rejection '
    + 'is specified only in the technical plan and in no AC (open item C-4); the observed behaviour is '
    + 'reported, and no defect is filed against a plan-only rule.',
  pre: PRE_FIXTURES,
  steps: [
    LOGIN,
    ['Read the currently persisted homepage set from the homepage list endpoint and record it.',
      'The before-state is recorded.'],
    ['Call the homepage save endpoint including a perk ID that does not exist.',
      'The request is rejected with a validation error; nothing is written.'],
    ['Read the homepage set again.',
      'The set matches the recorded before-state.'],
    ['Call the homepage save endpoint including the seeded already-expired perk.',
      'Record the response. Per the technical plan the request is expected to be rejected (error code homepage_perk_expired); the actual behaviour is recorded as an observation against a plan-only rule.'],
    ['Read the homepage set again.',
      'The set matches the recorded before-state, whichever way the expired perk was handled.'],
  ],
});

// ══ HLS 18 · AC2/AC4 — planned perk + perk deletion releases the slot ═══════════════════
cases.push({
  title: 'Verify a planned perk can be curated onto the homepage and deleting a curated perk releases its slot',
  priority: 'High', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-2', 'AC-4'], screens: [S_HOME],
  description: 'AC2 / AC4 — a planned perk is allowed onto the homepage so the rail can be scheduled '
    + 'ahead, and deleting the underlying perk must release its slot rather than leave a broken row. '
    + 'Only 2 planned perks exist live and status is date-derived, so the planned fixture is seeded.',
  pre: PRE_FIXTURES,
  steps: [
    LOGIN, GOTO_PERKS, GOTO_HOME,
    openReplace(5),
    selectPerk('the seeded planned perk (start_date in the future)'),
    CONFIRM_REPLACE,
    CLICK_SAVE,
    ['Read the success message text.',
      'The save succeeded and the message reads "Perks added to homepage." — a planned perk is accepted onto the homepage.'],
    ['Reopen the Homepage perks screen and read row 5.',
      'Row 5 holds the planned perk and its Status reads "Planned".'],
    ['Navigate to the Card perks > Perks list and delete that planned perk via its row actions menu.',
      'The perk deletion succeeds and the perk is removed from the Perks list.'],
    GOTO_HOME,
    ['Inspect the Homepage perks table.',
      'The screen renders without error, the deleted perk no longer occupies a slot, and no broken or blank row is left in its place.'],
    ['Read the homepage set from the homepage list endpoint.',
      'The returned set excludes the deleted perk and contains no orphaned entry referencing it.'],
  ],
});

// ══ HLS 19 · AC1 — permission gating ════════════════════════════════════════════════════
cases.push({
  title: 'Verify the Manage homepage button is hidden and the route guarded without the homepage permission',
  priority: 'High', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-1'], screens: [S_LIST, S_HOME],
  description: 'AC1 — permission gating of the entry point and the screen. The technical plan gates both '
    + 'on a new "Manage Homepage Perks" action. BLOCKED ON TEST DATA: no restricted admin account exists '
    + 'and no such action key is seeded yet (open item C-5) — the account named in the preconditions must '
    + 'be provisioned before this case can run.',
  pre: `${PRE_BASE} A SECOND admin account exists that does NOT hold the homepage-management permission. `
    + 'This account does not exist today — the only configured login holds every action — so it must be '
    + 'provisioned before execution.',
  steps: [
    ['Log in to the Breadfast Pay Admin Portal with the admin account that lacks the homepage-management permission.',
      'The admin is authenticated and the Admin Portal dashboard is displayed.'],
    GOTO_PERKS,
    ['Inspect the top-right of the Perks list page header.',
      'The "Manage homepage" button is not rendered; "Add perk" renders according to that account\'s own perk permissions.'],
    ['Navigate directly to the Homepage perks route by URL.',
      'Access is refused: the admin is redirected away from the screen and a permission message is shown; the curated homepage set is not displayed.'],
    ['Log in again with the permitted admin and open the Perks list.',
      'The "Manage homepage" button is rendered and opens the Homepage perks screen — confirming the gate discriminates on the permission and not on something else.'],
  ],
});

// ══ HLS 20 · AC1 — regression on the edited screen ══════════════════════════════════════
cases.push({
  title: 'Verify the Perks list row actions filters and pagination are unaffected by the new header button',
  priority: 'High', type: 'Regression', automation: 'Not Automated',
  acs: ['AC-1'], screens: [S_LIST],
  description: 'Regression — the Perks list is the only pre-existing screen this story edits (a second '
    + 'header button). Its row actions, three filters, pagination and "Add perk" entry point must be '
    + 'unchanged (impact.md R-1, R-2, R-3, R-5).',
  pre: PRE_BASE,
  steps: [
    LOGIN, GOTO_PERKS,
    ['Read the column headers and count the rows on the first page of the Perks list.',
      'The list renders its established columns and a full page of perk rows (15 per page).'],
    ['Open the "..." row actions menu on any perk row.',
      'The menu opens showing View, Duplicate and Delete — unchanged from before this story.'],
    ['Apply the Category filter, then the Type filter, then the Status filter, one at a time.',
      'Each filter narrows the list to matching perks only, and each can be cleared to restore the full list.'],
    ['Advance to the next page of the Perks list and then return to the previous page.',
      'Pagination moves forward and back correctly and the first page renders its original rows.'],
    ['Click the "Add perk" button.',
      'The Create perk form opens as before, unaffected by the adjacent new button.'],
  ],
});

cases.push({
  title: 'Verify the existing section view drag-reorder and Save order still work',
  priority: 'High', type: 'Regression', automation: 'Not Automated',
  acs: ['AC-6'], screens: [S_LIST],
  description: 'Regression — AC6 reuses the same CDK drag-and-drop the Perks list section view already '
    + 'uses for reordering perks within a section, so a shared change can break the pre-existing feature '
    + '(impact.md R-4). The existing flow persists via its own Save order action.',
  pre: `${PRE_BASE} A mobile section with at least three perks exists (for example "${SECTION_B}").`,
  steps: [
    LOGIN, GOTO_PERKS,
    [`Filter the Perks list to the "${SECTION_B}" section to enter the section view.`,
      'The list shows only that section\'s perks and the drag handles for reordering are available.'],
    ['Record the perk order, then drag a perk to a different position within the section.',
      'The perk moves to the new position and the list renders the new order.'],
    ['Save the new order using the section view\'s save-order action.',
      'A success message confirms the order was saved.'],
    ['Reload the Perks list and filter to the same section again.',
      'The perks render in the saved order — the pre-existing section reorder still persists correctly.'],
  ],
});

// ══════════════════════════════════════════════════════════════════════════════════════
// CSV emit
// ══════════════════════════════════════════════════════════════════════════════════════
const esc = (v) => {
  const s = String(v == null ? '' : v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function tagsFor(c) {
  return ['ai-created', ...c.acs.map((a) => `ac:${a}`), ...c.screens.map((s) => `screen:${s}`)].join(',');
}

function toCsv() {
  const rows = [HEADER];
  cases.forEach((c) => {
    // `Test Case ID` is a BrowserStack-owned column and MUST be blank on a new import
    // (browserstack-process §10.3). The real TC-xxxx ids are written back after the import,
    // which is what @TmsLink binds to. Local ordering is C-01… in coverage-notes.md only.
    c.steps.forEach(([step, result], si) => {
      if (si === 0) {
        rows.push(['', c.title, '', FOLDER_PATH, 'Active', OWNER, c.priority, c.type, c.automation,
          c.description, c.pre, 'Steps', step, result, ISSUES, tagsFor(c),
          '', '', '', '', '', '', PROJECT, '']);
      } else {
        rows.push(['', '', '', '', '', '', '', '', '', '', '', '', step, result,
          '', '', '', '', '', '', '', '', '', '']);
      }
    });
  });
  return rows.map((r) => r.map(esc).join(',')).join('\r\n');
}

if (require.main === module) {
  const out = path.join(__dirname, '..', 'testcases', 'testcases.csv');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, toCsv(), 'utf8');
  const steps = cases.reduce((n, c) => n + c.steps.length, 0);
  console.log(`${cases.length} cases · ${steps} steps → ${out}`);
  const byAc = {};
  const ref = (i) => `C-${String(i + 1).padStart(2, '0')}`;
  cases.forEach((c, i) => c.acs.forEach((a) => (byAc[a] = byAc[a] || []).push(ref(i))));
  cases.forEach((c, i) => console.log(`  ${ref(i)} [${c.priority.padEnd(8)}] [${c.type.padEnd(10)}] ${c.acs.join('+').padEnd(12)} ${c.title}`));
  console.log('\nAC coverage:');
  Object.keys(byAc).sort().forEach((a) => console.log(`  ${a}: ${byAc[a].join(', ')}`));
}

module.exports = { cases, ISSUES, PROJECT, FOLDER_PATH, BS_PROJECT_ID, BS_FOLDER_ID };
