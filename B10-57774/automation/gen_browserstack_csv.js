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
const S_NAV = 'card-perks-nav';        // the sidebar, visible in all 40 captured frames
const S_PERKS = 'perks-list';          // the pre-existing perks list (AC2)
const S_MER_LIST = 'merchants-list';   // merchants_list · merchants_added_success · *_list_state_*
const S_MER_FORM = 'merchants-create'; // merchants_add_1/2 · add_logo · add_error
const S_MER_DET = 'merchants-details'; // merchants_view · _connected_to_perk · _edit
const S_CAT_LIST = 'categories-list';
const S_CAT_FORM = 'categories-create';
const S_CAT_DET = 'categories-details';
const S_SEC_LIST = 'sections-list';
const S_SEC_FORM = 'sections-create';
const S_SEC_DET = 'sections-details';

const APP_URL = 'https://card-panel-testing.breadfast.tech';

// ── Preconditions ──
const PRE_BASE = `Admin/ops user has valid Breadfast Pay Admin Portal credentials (${APP_URL}). `
  + 'The Perks nav re-structure is deployed to the environment under test.';
const PRE_MER = `${PRE_BASE} At least one merchant exists whose "Added to a perk" value is No and at `
  + 'least one whose value is Yes, so both delete states are provable. Seed merchants via '
  + 'POST /api/v1/web/card/perks/merchant/create and attach one to a perk; record the chosen fixtures by '
  + 'id before the run, because the merchant list is a shared live oracle that can change mid-run.';
const PRE_MER_DUP = `${PRE_MER} The exact English name of one existing merchant is recorded, so the `
  + 'duplicate-name validation has a real collision to submit.';
const PRE_CAT = `${PRE_BASE} At least one category exists whose "Added to a perk" value is No and at `
  + 'least one whose value is Yes (10 categories exist on the environment). Record the chosen fixtures by '
  + 'id before the run.';
const PRE_CAT_DUP = `${PRE_CAT} The exact name and the exact category code of one existing category are `
  + 'recorded, so both duplicate validations have a real collision to submit.';
const PRE_SEC = `${PRE_BASE} At least one mobile section exists with no perks added and at least one `
  + 'with perks added (12 sections exist on the environment). Record the chosen fixtures by id before the '
  + 'run.';
const PRE_SEC_ORDER = `${PRE_SEC} The current order of the first three mobile sections is recorded `
  + 'before the test so the before/after order is provable.';
const PRE_PERKS = `${PRE_BASE} The perks list contains at least 16 perks so the first page is full and `
  + 'pagination is exercised, and the id of one existing perk is recorded for the details and duplicate '
  + 'deep links.';
const PRE_EMPTY = (thing, endpoint) => `${PRE_BASE} The environment contains ZERO ${thing} for the `
  + `duration of this case (verify with POST /api/v1/web/card/perks/${endpoint}/list before starting). `
  + 'The testing environment normally holds rows for this entity and there is no bulk-delete, so this '
  + 'case needs a dedicated empty environment or a database reset — see coverage-notes.md.';

// ── Reusable step atoms ──
const LOGIN = ['Log in to the Breadfast Pay Admin Portal as an admin/ops user.',
  'The admin is authenticated and the Admin Portal dashboard is displayed with the left navigation.'];
const EXPAND = ['Click the "Card perks" item in the left navigation.',
  'The "Card perks" item expands and its sub-links are displayed beneath it.'];
const gotoChild = (label, title) => [`Click the "${label}" sub-link under "Card perks".`,
  `The application navigates away from the current screen and the page title reads "${title}".`];
const openRowMenu = (what) => [`Click the actions ("...") control on the row of ${what}.`,
  'The row actions menu opens, showing the "View" and "Delete" items.'];

const cases = [];

// ══════════════════════════════════════════════════════════════════════════════
// AC1 — the nav re-structure
// ══════════════════════════════════════════════════════════════════════════════

// ── HLS 1 ──
cases.push({
  title: 'Verify the Card perks navigation item expands to reveal its sub-links',
  priority: 'Critical', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-1'], screens: [S_NAV],
  description: 'AC1 — "Card perks" is no longer a link to a page but an expandable parent. Collapsed, it '
    + 'shows no sub-links; clicking it reveals them.',
  pre: PRE_BASE,
  steps: [
    LOGIN,
    ['Locate the "Card perks" item in the left navigation and read its collapsed state.',
      'The "Card perks" item is displayed with a chevron affordance and no sub-links are rendered beneath it.'],
    ['Click the "Card perks" item.',
      'The item expands and a group of sub-links is rendered beneath it.'],
    ['Read the direction of the chevron on the "Card perks" row.',
      'The chevron indicates the expanded state (pointing up), matching the design.'],
    ['Confirm the sub-link group is visually grouped under the parent.',
      'The sub-links are rendered on the parent\'s sub-panel, indented under "Card perks", and the parent row remains visible above them.'],
  ],
});

cases.push({
  title: 'Verify the Card perks navigation item collapses and hides its sub-links',
  priority: 'High', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-1'], screens: [S_NAV],
  description: 'AC1 — the parent is expandable AND collapsible. Asserted against the AC: the design has '
    + 'no collapsed-state frame (see figma-analysis D-1), so the AC is the authority here.',
  pre: PRE_BASE,
  steps: [
    LOGIN,
    EXPAND,
    ['Click the "Card perks" item again.',
      'The item collapses and none of its four sub-links is rendered.'],
    ['Read the direction of the chevron on the "Card perks" row.',
      'The chevron indicates the collapsed state, the opposite direction from the expanded state.'],
    ['Click the "Card perks" item once more.',
      'The item expands again and the same four sub-links are rendered, so expand and collapse are repeatable.'],
  ],
});

// ── HLS 2 ──
cases.push({
  title: 'Verify the expanded Card perks parent shows the four sub-links Perks, Merchants, Categories and Mobile sections in order',
  priority: 'Critical', type: 'Acceptance', automation: 'Not Automated',
  acs: ['AC-1'], screens: [S_NAV],
  description: 'AC1 verbatim — exactly four sub-links with these labels. The label text is asserted '
    + 'case-insensitively because the running app renders the parent as "Card Perks" while the AC and the '
    + 'design both use "Card perks" (a pre-existing inconsistency, exploratory-notes §2).',
  pre: PRE_BASE,
  steps: [
    LOGIN,
    EXPAND,
    ['Count the sub-links rendered under "Card perks".',
      'Exactly four sub-links are rendered — no more and no fewer.'],
    ['Read the four sub-link labels from top to bottom.',
      'They read "Perks", "Merchants", "Categories" and "Mobile sections", in that order.'],
    ['Compare each label against the design frame text.',
      'Each label matches the design, including the sentence case of "Mobile sections".'],
    ['Confirm no additional perks-related item remains elsewhere in the left navigation.',
      'No separate top-level perks link exists outside the "Card perks" parent.'],
  ],
});

// ── HLS 3 ──
cases.push({
  title: 'Verify the active sub-link is indicated and the Card perks parent stays expanded on its child screen',
  priority: 'High', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-1'], screens: [S_NAV, S_MER_LIST],
  description: 'AC1 — the parent must remain expanded while one of its children is the active screen, and '
    + 'the active child must be distinguishable. In the design the active child is rendered in the accent '
    + 'colour and the parent stays expanded in every frame.',
  pre: PRE_BASE,
  steps: [
    LOGIN,
    EXPAND,
    gotoChild('Merchants', 'Merchants'),
    ['Read the state of the "Card perks" parent in the left navigation.',
      'The parent is still expanded and all four sub-links remain rendered.'],
    ['Compare the appearance of the "Merchants" sub-link with the other three.',
      'The "Merchants" sub-link is visually indicated as active and is distinguishable from the other three.'],
    ['Click the "Categories" sub-link.',
      'The "Categories" screen is displayed and the page title reads "Categories".'],
    ['Read the active indication again.',
      'The active indication has moved to "Categories" and "Merchants" is no longer indicated as active.'],
  ],
});

cases.push({
  title: 'Verify the Card perks parent stays expanded and the active sub-link stays indicated after a page reload',
  priority: 'High', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-1'], screens: [S_NAV, S_SEC_LIST],
  description: 'AC1 — navigation state must survive a reload, which is the standard failure mode for a '
    + 'newly introduced expandable group: the route restores but the parent renders collapsed.',
  pre: PRE_BASE,
  steps: [
    LOGIN,
    EXPAND,
    gotoChild('Mobile sections', 'Mobile sections'),
    ['Reload the page in the browser.',
      'The application re-bootstraps and the "Mobile sections" screen is displayed again, with its page title reading "Mobile sections".'],
    ['Read the state of the "Card perks" parent after the reload.',
      'The parent is expanded and its four sub-links are rendered without any further click.'],
    ['Read the active indication after the reload.',
      'The "Mobile sections" sub-link is still indicated as the active item.'],
  ],
});

// ── HLS 4 ──
cases.push({
  title: 'Verify each Card perks sub-link route renders its own screen when entered directly by URL',
  priority: 'Critical', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-1'], screens: [S_NAV, S_PERKS, S_MER_LIST, S_CAT_LIST, S_SEC_LIST],
  description: 'AC1 plus the implementation comment "add all of the new routes + perks inside the '
    + 'parent" — each sub-item must be its own addressable route, not only a click target. Every step '
    + 'asserts the PAGE TITLE rather than "no error": before this story all three new URLs resolve '
    + 'silently to Create perk (exploratory-notes §4), so an absence of errors proves nothing.',
  pre: PRE_BASE,
  steps: [
    LOGIN,
    EXPAND,
    ['Click the "Merchants" sub-link and record the browser URL.',
      'The Merchants screen is displayed and the URL contains its own distinct route segment, different from the perks list route.'],
    ['Open a new browser tab and enter the recorded Merchants URL directly.',
      'The Merchants screen is rendered and its page title reads "Merchants" — not "Create perk" and not the perks list.'],
    ['Repeat the direct-URL entry for the recorded Categories route.',
      'The Categories screen is rendered and its page title reads "Categories".'],
    ['Repeat the direct-URL entry for the recorded Mobile sections route.',
      'The Mobile sections screen is rendered and its page title reads "Mobile sections".'],
    ['Repeat the direct-URL entry for the recorded Perks route.',
      'The existing perks list is rendered with its perk rows.'],
  ],
});

// ── HLS 5 (regression) ──
cases.push({
  title: 'Verify the other left-navigation items and their expandable groups are unaffected by the Card perks re-structure',
  priority: 'Critical', type: 'Regression', automation: 'Not Automated',
  acs: ['AC-1'], screens: [S_NAV],
  description: 'Regression from the impact analysis (I-1/R-1): the sidebar is a shared component. The '
    + 'current build already renders 52 links of which 12 are expandable parents (Card Users, KYC '
    + 'Management, Reports, Administration, Logs, Organizations, Requests, Adjustments, Bulk, Service '
    + 'Management, FAQs), so converting one leaf into a parent must not disturb its siblings.',
  pre: `${PRE_BASE} The full list of left-navigation items and their sub-links is recorded from the `
    + 'pre-change build, so the before/after comparison is provable.',
  steps: [
    LOGIN,
    ['Read every item rendered in the left navigation and compare against the recorded pre-change list.',
      'Every previously present navigation item is still rendered, with no item missing and no item duplicated.'],
    ['Expand the "Service Management" group.',
      'It expands and shows its own sub-links, unchanged from the recorded list.'],
    ['Click one of its sub-links, for example "List Category".',
      'That screen is displayed, so an unrelated expandable group still navigates correctly.'],
    ['Expand the "Card Users" group.',
      'It expands and shows its own sub-links, unchanged from the recorded list.'],
    ['Click its "Search Cards" sub-link.',
      'The card search screen is displayed, so a second unrelated group is also unaffected.'],
    ['Expand "Card perks" while another group is already expanded.',
      'Both groups can be expanded; expanding "Card perks" does not collapse, hide or reorder the other group.'],
  ],
});

// ══════════════════════════════════════════════════════════════════════════════
// AC2 — the existing perks screens are unchanged
// ══════════════════════════════════════════════════════════════════════════════

cases.push({
  title: 'Verify the Perks sub-link renders the existing perks list with its rows and pagination unchanged',
  priority: 'Critical', type: 'Regression', automation: 'Not Automated',
  acs: ['AC-2'], screens: [S_NAV, S_PERKS],
  description: 'AC2 — "Perks" renders the existing perks list. The pre-change build serves this screen at '
    + 'the perks route with a page title of "Card perks", 15 rows per page, newest first.',
  pre: PRE_PERKS,
  steps: [
    LOGIN,
    EXPAND,
    ['Click the "Perks" sub-link.',
      'The existing perks list screen is displayed with its perk rows.'],
    ['Read the page title of the perks screen.',
      'The page title is the pre-existing perks list title and is unchanged from the pre-change build.'],
    ['Count the perk rows rendered on the first page.',
      '15 perk rows are rendered, matching the pre-existing page size.'],
    ['Read the column headers of the perks table.',
      'The column headers are the same set, in the same order, as the pre-change build.'],
    ['Navigate to the second page of the perks list.',
      'The next set of perk rows is rendered and the pagination control reflects page 2.'],
    ['Apply one of the pre-existing perks list filters and read the result.',
      'The list reloads with the filter applied, exactly as it did before the navigation change.'],
  ],
});

cases.push({
  title: 'Verify the existing Create perk screen remains reachable from the Perks list',
  priority: 'Critical', type: 'Regression', automation: 'Not Automated',
  acs: ['AC-2'], screens: [S_PERKS],
  description: 'AC2 reachability (operator decision Q4 — reachability, not field-level behaviour). The '
    + 'perk create form is progressive: it opens with only the perk-type selector, so only the screen '
    + 'identity is asserted here.',
  pre: PRE_PERKS,
  steps: [
    LOGIN,
    EXPAND,
    ['Click the "Perks" sub-link.',
      'The existing perks list screen is displayed.'],
    ['Click the action that opens the perk creation screen from the perks list header.',
      'The application navigates to the perk creation screen.'],
    ['Read the page title of the screen that opened.',
      'The page title reads "Create perk".'],
    ['Read the first field rendered on the form.',
      'The form renders the perk type selector as its first required field, unchanged from the pre-change build.'],
  ],
});

cases.push({
  title: 'Verify the existing perk details and duplicate screens remain reachable by URL',
  priority: 'High', type: 'Regression', automation: 'Not Automated',
  acs: ['AC-2'], screens: [S_PERKS],
  description: 'AC2 reachability for the two remaining pre-existing perks child routes — the perk '
    + 'details/edit route and the duplicate route (the latter delivered by B10-57771). Both are children '
    + 'of the perks route and are the routes most at risk from re-parenting.',
  pre: PRE_PERKS,
  steps: [
    LOGIN,
    EXPAND,
    ['Click the "Perks" sub-link.',
      'The existing perks list screen is displayed.'],
    ['Open the recorded perk from the list to reach its details screen.',
      'The perk details screen is rendered for that perk and shows that perk\'s values.'],
    ['Record the browser URL of the perk details screen.',
      'The URL is recorded and contains the perk identifier.'],
    ['Open a new browser tab and enter the recorded perk details URL directly.',
      'The same perk details screen is rendered, so the details route still resolves by URL.'],
    ['Return to the perks list.',
      'The perks list is displayed again with its perk rows.'],
    ['Trigger the duplicate action for the recorded perk.',
      'The duplicate perk screen is rendered and is pre-filled from the source perk, unchanged from the pre-change build.'],
  ],
});

cases.push({
  title: 'Verify a previously bookmarked perks URL still resolves to the perks list',
  priority: 'Critical', type: 'Regression', automation: 'Not Automated',
  acs: ['AC-2'], screens: [S_PERKS],
  description: 'Risk I-8 from the impact analysis — the perks list is reached today at a top-level route. '
    + 'If the re-structure introduces a new parent URL segment, every stored bookmark, audit-log link and '
    + 'shared link to the old URL breaks.',
  pre: `${PRE_BASE} The exact perks list URL from the pre-change build is recorded.`,
  steps: [
    LOGIN,
    ['Enter the recorded pre-change perks list URL directly in the browser.',
      'The perks list screen is rendered with its perk rows — the URL is not rejected and does not land on an error or a not-found screen.'],
    ['Read the state of the left navigation on the screen that resolved.',
      'The "Card perks" parent is expanded with "Perks" indicated as the active sub-link.'],
    ['Read the browser URL after the page has settled.',
      'Either the recorded URL is served as-is, or it redirects to the new perks route; in both cases the perks list is the screen displayed.'],
  ],
});

// ══════════════════════════════════════════════════════════════════════════════
// AC3 — Merchants
// ══════════════════════════════════════════════════════════════════════════════

cases.push({
  title: 'Verify the Merchants list renders the columns Merchant name EN, Merchant name AR, Branches, Added to a perk and Actions',
  priority: 'Critical', type: 'Acceptance', automation: 'Not Automated',
  acs: ['AC-3'], screens: [S_MER_LIST],
  description: 'AC3 — Merchants is a standalone management screen. Column set taken from the design '
    + 'frame merchants_added_success: a logo thumbnail, Merchant name EN, Merchant name AR, Branches, '
    + 'Added to a perk, Actions.',
  pre: PRE_MER,
  steps: [
    LOGIN,
    EXPAND,
    gotoChild('Merchants', 'Merchants'),
    ['Read the column headers of the merchants table from left to right.',
      'The headers read "Merchant name EN", "Merchant name AR", "Branches", "Added to a perk" and "Actions", preceded by an unlabelled logo column.'],
    ['Read the values in the first row.',
      'The row shows the merchant\'s logo thumbnail, its English name, its Arabic name, its branch count and its "Added to a perk" value.'],
    ['Read the Arabic name cell of a merchant that has one.',
      'The Arabic name is rendered in Arabic characters, right-to-left within its own cell, inside the otherwise left-to-right table.'],
    ['Read the "Added to a perk" cell values across the rendered rows.',
      'Each cell shows either "Yes" or "No".'],
    ['Read the "Branches" cell of the recorded merchant and compare it with its branch count from the merchant list endpoint.',
      'The cell shows that merchant\'s branch count, or "NA" where the design renders no count.'],
    ['Read the pagination control below the table.',
      'A pagination control with previous, page-number and next affordances is rendered.'],
    ['Read the label of the primary action in the top-right of the header.',
      'The label reads "Add merchant".'],
    ['Click that action.',
      'The merchant creation screen is displayed and its page title reads "Create merchant".'],
  ],
});

cases.push({
  title: 'Verify the Merchants row actions menu offers only View and Delete',
  priority: 'High', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-3'], screens: [S_MER_LIST],
  description: 'AC3 — per-row affordances. The design gives every row a "..." menu holding exactly two '
    + 'items, View and Delete; editing is reached from the details screen, not from the row.',
  pre: PRE_MER,
  steps: [
    LOGIN, EXPAND, gotoChild('Merchants', 'Merchants'),
    openRowMenu('the merchant whose "Added to a perk" value is No'),
    ['Count and read the items in the open menu.',
      'Exactly two items are rendered: "View" and "Delete"; there is no "Edit" item in the row menu.'],
    ['Read the appearance of the "Delete" item.',
      '"Delete" is rendered with a trash icon in the destructive colour and is enabled for this merchant.'],
    ['Click "View".',
      'The merchant details screen is displayed for that merchant.'],
  ],
});

cases.push({
  title: 'Verify the Merchants empty state is displayed with its message and Add merchant action',
  priority: 'Medium', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-3'], screens: [S_MER_LIST],
  description: 'AC3 — empty state from the design frame merchants_list. NOTE: the design sub-line reads '
    + '"You can merchants by tapping the add merchants button", which is missing a verb; the parallel '
    + 'Categories frame reads "You can add categories ...". The step below asserts the heading exactly '
    + 'and the sub-line loosely, so a copy fix does not fail the case and the typo does not get frozen '
    + 'into an expected result (figma-analysis D-2).',
  pre: PRE_EMPTY('perk merchants', 'merchant'),
  steps: [
    LOGIN, EXPAND, gotoChild('Merchants', 'Merchants'),
    ['Read the content of the merchants panel while no merchants exist.',
      'No table is rendered; an empty-state block is displayed centred in the panel.'],
    ['Read the empty-state heading.',
      'The heading reads "There are no merchants added yet".'],
    ['Read the empty-state sub-line.',
      'A sub-line is displayed beneath the heading directing the admin to the add-merchant action.'],
    ['Read the actions available in the empty state.',
      'An "Add merchant" button is rendered inside the empty state, in addition to the "Add merchant" button in the top-right of the header.'],
    ['Click the "Add merchant" button inside the empty state.',
      'The merchant creation screen is displayed with the page title "Create merchant".'],
  ],
});

cases.push({
  title: 'Verify a merchant is created with its required English and Arabic names and both logos',
  priority: 'Critical', type: 'Acceptance', automation: 'Not Automated',
  acs: ['AC-3'], screens: [S_MER_FORM, S_MER_LIST],
  description: 'AC3 — the "add" half of the operator\'s Q2 decision. The design marks Merchant name EN, '
    + 'Merchant name AR, Logo EN and Logo AR all required; branch name and MID are not marked required.',
  pre: PRE_BASE,
  steps: [
    LOGIN, EXPAND, gotoChild('Merchants', 'Merchants'),
    ['Click "Add merchant" in the top-right of the header.',
      'The merchant creation screen is displayed and its page title reads "Create merchant".'],
    ['Read the field labels in the "Basic details" section and note which carry a required marker.',
      '"Merchant name EN", "Merchant name AR", "Logo EN" and "Logo AR" are rendered, each with a required marker.'],
    ['Enter a unique English name in "Merchant name EN".',
      'The value is accepted and displayed in the field.'],
    ['Enter an Arabic name in "Merchant name AR".',
      'The Arabic value is accepted and rendered right-to-left inside that field.'],
    ['Upload an image for "Logo EN" using its Add Image control.',
      'The control is replaced by a thumbnail preview of the uploaded logo.'],
    ['Upload an image for "Logo AR" using its Add Image control.',
      'The control is replaced by a thumbnail preview of the uploaded Arabic logo.'],
    ['Read the state of the "Add merchant" submit button.',
      'The submit button is now enabled.'],
    ['Click "Add merchant".',
      'The merchant is created, the application returns to the Merchants list, and a success message reading "Merchant added successfully" is displayed in the header area.'],
    ['Locate the new merchant in the list by its English name.',
      'A row exists for the new merchant showing its English name, its Arabic name, its logo thumbnail and "No" in the "Added to a perk" column.'],
  ],
});

cases.push({
  title: 'Verify additional merchant branch rows are added with the Add more action and saved with the merchant',
  priority: 'High', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-3'], screens: [S_MER_FORM, S_MER_LIST],
  description: 'AC3 — the "Merchant branches/services" repeater from the design: a Branch or service name '
    + 'and a Merchant ID (MID) per row, with "+ Add more" appending a row. The Branches column on the '
    + 'list is the oracle for how many were saved.',
  pre: PRE_BASE,
  steps: [
    LOGIN, EXPAND, gotoChild('Merchants', 'Merchants'),
    ['Click "Add merchant" in the top-right of the header.',
      'The merchant creation screen is displayed and its page title reads "Create merchant".'],
    ['Complete the four required Basic details fields — English name, Arabic name, Logo EN and Logo AR — with unique values.',
      'All four values are accepted and the submit button becomes enabled.'],
    ['Read the "Merchant branches/services" section.',
      'One empty branch row is rendered, with a "Branch or service name" field and a "Merchant ID (MID)" field, and a "+ Add more" action beneath it.'],
    ['Enter a branch name and a MID in the first branch row.',
      'Both values are accepted and displayed in that row.'],
    ['Click "+ Add more".',
      'A second branch row is appended, with its own empty "Branch or service name" and "Merchant ID (MID)" fields.'],
    ['Enter a branch name and a MID in the second branch row.',
      'Both values are accepted and displayed in the second row.'],
    ['Click "+ Add more" again.',
      'A third branch row is appended with its own empty fields.'],
    ['Enter a branch name and a MID in the third branch row.',
      'Three branch rows are rendered, each holding the entered branch name and MID.'],
    ['Click "Add merchant".',
      'The merchant is created and the Merchants list is displayed with the success message "Merchant added successfully".'],
    ['Read the "Branches" cell of the newly created merchant.',
      'The cell reports 3 branches, matching the three rows that were entered.'],
    ['Open the new merchant\'s details screen.',
      'All three branch rows are rendered with the branch names and MIDs exactly as entered.'],
  ],
});

cases.push({
  title: 'Verify the Add merchant submit action is disabled until the required merchant fields are provided',
  priority: 'High', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-3'], screens: [S_MER_FORM],
  description: 'AC3 negative — in the design the "Create merchant" submit button is rendered disabled '
    + 'while the form is empty (merchants_add_1) and enabled once valid. This gating is specific to the '
    + 'merchant form: the category and section forms render their submit enabled while empty '
    + '(figma-analysis D-9), so it is asserted per screen and never generalised.',
  pre: PRE_BASE,
  steps: [
    LOGIN, EXPAND, gotoChild('Merchants', 'Merchants'),
    ['Click "Add merchant" to open the creation screen.',
      'The "Create merchant" screen is displayed with all fields empty.'],
    ['Read the state of the "Add merchant" submit button on the empty form.',
      'The submit button is rendered disabled.'],
    ['Enter a value only in "Merchant name EN" and read the submit button state.',
      'The submit button is still disabled, because the other required fields are empty.'],
    ['Enter a value in "Merchant name AR" as well and read the submit button state.',
      'The submit button is still disabled, because both logos are still missing.'],
    ['Upload "Logo EN" only and read the submit button state.',
      'The submit button is still disabled, because "Logo AR" is still missing.'],
    ['Upload "Logo AR" and read the submit button state.',
      'All four required fields are now provided and the submit button is enabled.'],
  ],
});

cases.push({
  title: 'Verify creating a merchant with an existing name is rejected with the duplicate merchant error',
  priority: 'High', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-3'], screens: [S_MER_FORM],
  description: 'AC3 negative — merchant name uniqueness. The design shows both name fields outlined in '
    + 'the error colour with the inline message "This merchant already exists" under Merchant name EN, '
    + 'and the submit button disabled (merchants_add_error).',
  pre: PRE_MER_DUP,
  steps: [
    LOGIN, EXPAND, gotoChild('Merchants', 'Merchants'),
    ['Click "Add merchant" to open the creation screen.',
      'The "Create merchant" screen is displayed.'],
    ['Enter the recorded name of the existing merchant in "Merchant name EN".',
      'The value is accepted into the field.'],
    ['Complete the remaining required fields — Arabic name, Logo EN and Logo AR.',
      'All remaining required values are accepted, so the merchant name is the only invalid input.'],
    ['Click "Add merchant" to submit the form.',
      'The merchant is not created and the admin remains on the "Create merchant" screen.'],
    ['Read the message rendered under "Merchant name EN".',
      'The inline message reads "This merchant already exists".'],
    ['Read the appearance of the name fields.',
      'The name fields are outlined in the error colour to mark the invalid input.'],
    ['Change "Merchant name EN" to a unique value.',
      'The duplicate message is cleared and the field returns to its normal appearance.'],
    ['Submit the form.',
      'The merchant is created and the Merchants list shows the success message "Merchant added successfully".'],
  ],
});

cases.push({
  title: 'Verify the first merchant branch row cannot be removed',
  priority: 'Medium', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-3'], screens: [S_MER_FORM, S_MER_DET],
  description: 'AC3 — a rule that exists only in the design: in every frame that shows multiple branch '
    + 'rows, rows 2..n each carry a delete control and the FIRST row never does, so a merchant always '
    + 'keeps at least one branch row (figma-analysis R-A).',
  pre: PRE_BASE,
  steps: [
    LOGIN, EXPAND, gotoChild('Merchants', 'Merchants'),
    ['Click "Add merchant" in the top-right of the header.',
      'The merchant creation screen is displayed and its page title reads "Create merchant".'],
    ['Complete the four required Basic details fields with unique values.',
      'All four values are accepted and the submit button becomes enabled.'],
    ['Append branch rows with "+ Add more" until four branch rows exist, filling a branch name and a MID in each.',
      'Four branch rows are rendered, each holding a branch name and a MID.'],
    ['Inspect the trailing edge of the first branch row.',
      'The first branch row has no delete control.'],
    ['Inspect the trailing edge of the second, third and fourth branch rows.',
      'Each of these rows carries a delete control rendered in the destructive colour.'],
    ['Click the delete control on the fourth branch row.',
      'That row is removed and three branch rows remain, the first still without a delete control.'],
    ['Delete the remaining removable rows one at a time.',
      'Rows are removed until only the first branch row remains, and that row still exposes no delete control, so the last branch row cannot be removed.'],
  ],
});

cases.push({
  title: 'Verify a merchant details screen is displayed read-only from the row View action',
  priority: 'High', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-3'], screens: [S_MER_LIST, S_MER_DET],
  description: 'AC3 — the details screen from the design (merchants_view): page title "Merchant details", '
    + 'values read-only, no "+ Add more" and no branch delete controls, with Delete and Edit in the '
    + 'header and a second Edit at the bottom of the card.',
  pre: PRE_MER,
  steps: [
    LOGIN, EXPAND, gotoChild('Merchants', 'Merchants'),
    openRowMenu('the merchant whose "Added to a perk" value is No'),
    ['Click "View".',
      'The merchant details screen is displayed.'],
    ['Read the page title.',
      'The page title reads "Merchant details".'],
    ['Read the values rendered on the screen and compare them with that merchant\'s stored values.',
      'The English name, Arabic name, both logos and every branch name and MID match the stored merchant, and the fields are not editable.'],
    ['Read the controls rendered in the header.',
      'A "Delete" action and an "Edit" action are rendered in the top-right.'],
    ['Read the controls rendered at the bottom of the details card.',
      'An "Edit" action is rendered at the bottom of the card, and no "+ Add more" and no branch delete controls are present in this read-only state.'],
  ],
});

cases.push({
  title: 'Verify a merchant is edited and the changes are saved',
  priority: 'Critical', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-3'], screens: [S_MER_DET, S_MER_LIST],
  description: 'AC3 — the design puts the merchant into an editable state via Edit, replacing the header '
    + 'Delete/Edit pair with a single Save and restoring "+ Add more" and the branch delete controls '
    + '(merchants_edit).',
  pre: PRE_MER,
  steps: [
    LOGIN, EXPAND, gotoChild('Merchants', 'Merchants'),
    openRowMenu('the merchant whose "Added to a perk" value is No'),
    ['Click "View" to open the merchant details screen.',
      'The merchant details screen is displayed in its read-only state.'],
    ['Click "Edit".',
      'The fields become editable, "+ Add more" is rendered again, and the header action becomes a single "Save".'],
    ['Change the value of "Merchant name EN" to a new unique value.',
      'The new value is accepted and displayed in the field.'],
    ['Click "Save".',
      'The change is saved and the merchant is displayed with its updated name in a read-only state again.'],
    ['Return to the Merchants list.',
      'The Merchants list is displayed again.'],
    ['Locate that merchant in the list and read its English name.',
      'The row shows the updated English name.'],
    ['Reload the Merchants list.',
      'The updated name persists after the reload, confirming it was stored and not only rendered.'],
  ],
});

cases.push({
  title: 'Verify deleting a merchant that is not added to a perk requires confirmation and removes it from the list',
  priority: 'Critical', type: 'Acceptance', automation: 'Not Automated',
  acs: ['AC-3'], screens: [S_MER_LIST],
  description: 'AC3 — the "delete" half of the operator\'s Q2 decision, for a merchant that is not in '
    + 'use. The design flow is row menu → confirm modal "Are you sure you want to delete this merchant?" '
    + '→ in-flight spinner → success banner "Merchant deleted successfully" with the row gone.',
  pre: PRE_MER,
  steps: [
    LOGIN, EXPAND, gotoChild('Merchants', 'Merchants'),
    ['Record the merchant rows currently rendered and the total row count.',
      'The pre-delete list state is recorded, including the row of the merchant whose "Added to a perk" value is No.'],
    openRowMenu('the merchant whose "Added to a perk" value is No'),
    ['Click "Delete".',
      'A confirmation modal opens over a dimmed page.'],
    ['Read the text of the confirmation modal.',
      'It reads "Are you sure you want to delete this merchant?" and offers a "Delete" action and a "Cancel" action.'],
    ['Click "Delete" in the modal.',
      'The delete request is submitted and the modal shows an in-flight state on its Delete action.'],
    ['Read the Merchants screen once the request completes.',
      'The modal closes and a success message reading "Merchant deleted successfully" is displayed in the header area.'],
    ['Compare the rendered rows with the recorded pre-delete list.',
      'The deleted merchant\'s row is no longer rendered, the row count has decreased by one, and every other row is unchanged.'],
    ['Reload the Merchants list.',
      'The deleted merchant is still absent after the reload, confirming the deletion was stored.'],
  ],
});

cases.push({
  title: 'Verify cancelling the merchant delete confirmation leaves the merchant in the list',
  priority: 'High', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-3'], screens: [S_MER_LIST],
  description: 'AC3 negative — Cancel is one of only two exits from the confirm modal in the design, so '
    + 'it must abandon the deletion without side effects.',
  pre: PRE_MER,
  steps: [
    LOGIN, EXPAND, gotoChild('Merchants', 'Merchants'),
    ['Record the merchant rows currently rendered and the total row count.',
      'The pre-action list state is recorded.'],
    openRowMenu('the merchant whose "Added to a perk" value is No'),
    ['Click "Delete" to open the confirmation modal.',
      'The confirmation modal is displayed asking whether to delete this merchant.'],
    ['Click "Cancel".',
      'The modal closes and no success or error message is displayed.'],
    ['Compare the rendered rows with the recorded pre-action list.',
      'The merchant is still present and the row count is unchanged.'],
    ['Reload the Merchants list.',
      'The merchant is still present after the reload, confirming nothing was deleted.'],
  ],
});

cases.push({
  title: 'Verify the Delete action is disabled for a merchant that is added to a perk',
  priority: 'Critical', type: 'Acceptance', automation: 'Not Automated',
  acs: ['AC-3'], screens: [S_MER_LIST, S_MER_DET],
  description: 'AC3 — the central design rule (figma-analysis R-C), which appears in NO acceptance '
    + 'criterion: a merchant in use by a perk cannot be deleted. The design enforces it in BOTH entry '
    + 'points — the row actions menu (merchants_delete_connected_to_benefit) and the details header '
    + '(merchants_view_connected_to_perk) — so a build that gates only one of them is half-implemented.',
  pre: PRE_MER,
  steps: [
    LOGIN, EXPAND, gotoChild('Merchants', 'Merchants'),
    ['Read the "Added to a perk" cell of the recorded in-use merchant.',
      'The cell reads "Yes".'],
    openRowMenu('the merchant whose "Added to a perk" value is Yes'),
    ['Read the appearance and state of the "Delete" item in the menu.',
      'The "Delete" item is rendered in a disabled state and is not in the destructive colour used for an enabled Delete.'],
    ['Attempt to click the disabled "Delete" item.',
      'No confirmation modal opens and the merchant is not deleted.'],
    ['Click "View" to open that merchant\'s details screen.',
      'The merchant details screen is displayed for the in-use merchant.'],
    ['Read the state of the "Delete" action in the details header.',
      'The "Delete" action is rendered disabled, while the "Edit" action remains enabled.'],
    ['Return to the Merchants list and open the row menu of the recorded merchant whose "Added to a perk" value is No.',
      'The row actions menu opens for that merchant.'],
    ['Read the state of the "Delete" item for that merchant.',
      '"Delete" is enabled for the merchant that is not added to a perk, confirming the difference is driven by the in-use state and not by a global setting.'],
  ],
});

cases.push({
  title: 'Verify the branch delete controls are disabled when editing a merchant that is added to a perk',
  priority: 'High', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-3'], screens: [S_MER_DET],
  description: 'AC3 — a second design-only rule (figma-analysis R-B): a merchant in use by a perk stays '
    + 'editable and can still gain branches, but its existing branches cannot be removed. '
    + 'merchants_edit and merchants_edit_connected_to_perk are identical frames except for the state of '
    + 'the branch delete controls.',
  pre: PRE_MER,
  steps: [
    LOGIN, EXPAND, gotoChild('Merchants', 'Merchants'),
    openRowMenu('the merchant whose "Added to a perk" value is Yes and which has at least two branches'),
    ['Click "View".',
      'The merchant details screen is displayed in its read-only state.'],
    ['Click "Edit".',
      'The fields become editable and the header action becomes "Save".'],
    ['Read the state of the delete controls on the second and subsequent branch rows.',
      'The branch delete controls are rendered in a disabled state.'],
    ['Attempt to click a disabled branch delete control.',
      'The branch row is not removed and the branch count is unchanged.'],
    ['Read the state of the "+ Add more" action.',
      '"+ Add more" is still enabled, so a new branch can be added even though existing branches cannot be removed.'],
    ['Return to the Merchants list and open the details screen of the merchant whose "Added to a perk" value is No.',
      'That merchant\'s details screen is displayed in its read-only state.'],
    ['Click "Edit" and read the state of its branch delete controls.',
      'For that merchant the branch delete controls on rows two and above are enabled, confirming the difference is driven by the in-use state.'],
  ],
});

// ══════════════════════════════════════════════════════════════════════════════
// AC3 — Categories
// ══════════════════════════════════════════════════════════════════════════════

cases.push({
  title: 'Verify the Categories list renders the columns Category name, Category code, Added to a perk and Actions',
  priority: 'Critical', type: 'Acceptance', automation: 'Not Automated',
  acs: ['AC-3'], screens: [S_CAT_LIST],
  description: 'AC3 — Categories is a standalone management screen. The design (categories_added_success) '
    + 'gives it four columns only: no logo column and no Arabic column, unlike Merchants.',
  pre: PRE_CAT,
  steps: [
    LOGIN, EXPAND, gotoChild('Categories', 'Categories'),
    ['Read the column headers of the categories table from left to right.',
      'The headers read "Category name", "Category code", "Added to a perk" and "Actions".'],
    ['Confirm which columns are absent compared with the Merchants list.',
      'No logo column and no Arabic-name column is rendered on the Categories list.'],
    ['Read the values in the first row.',
      'The row shows the category name, its category code and its "Added to a perk" value.'],
    ['Compare the rendered rows against the categories returned by the category list endpoint.',
      'Every rendered row corresponds to a stored category, with its name and code matching.'],
    ['Read the pagination control below the table.',
      'A pagination control with previous, page-number and next affordances is rendered.'],
    openRowMenu('any category in the list'),
    ['Count and read the items in the open menu.',
      'Exactly two items are rendered — "View" and "Delete" — with no "Edit" item in the row menu.'],
    ['Close the menu, then read the label of the top-right primary action.',
      'The label reads "Add category".'],
  ],
});

cases.push({
  title: 'Verify the Categories empty state is displayed with its message and Add category action',
  priority: 'Medium', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-3'], screens: [S_CAT_LIST],
  description: 'AC3 — empty state from the design frame categories_list.',
  pre: PRE_EMPTY('perk categories', 'category'),
  steps: [
    LOGIN, EXPAND, gotoChild('Categories', 'Categories'),
    ['Read the content of the categories panel while no categories exist.',
      'No table is rendered; an empty-state block is displayed centred in the panel.'],
    ['Read the empty-state heading.',
      'The heading reads "There are no categories added yet".'],
    ['Read the empty-state sub-line.',
      'The sub-line reads "You can add categories by tapping the add category button".'],
    ['Click the "Add category" button inside the empty state.',
      'The category creation screen is displayed with the page title "Create category".'],
  ],
});

cases.push({
  title: 'Verify a category is created with its required name and category code',
  priority: 'Critical', type: 'Acceptance', automation: 'Not Automated',
  acs: ['AC-3'], screens: [S_CAT_FORM, S_CAT_LIST],
  description: 'AC3 — the "add" half of the operator\'s Q2 decision for categories. The design form has '
    + 'exactly two required fields: a single "Category name" (no EN/AR pair, unlike the other two '
    + 'screens — figma-analysis D-8) and "Category code (MCC)".',
  pre: PRE_BASE,
  steps: [
    LOGIN, EXPAND, gotoChild('Categories', 'Categories'),
    ['Click "Add category" in the top-right of the header.',
      'The category creation screen is displayed and its page title reads "Create category".'],
    ['Read the field labels rendered on the form and note which carry a required marker.',
      'Exactly two fields are rendered — "Category name" and "Category code (MCC)" — each with a required marker, and no separate Arabic name field is present.'],
    ['Enter a unique value in "Category name".',
      'The value is accepted and displayed in the field.'],
    ['Enter a unique numeric value in "Category code (MCC)".',
      'The value is accepted and displayed in the field.'],
    ['Click "Add category".',
      'The category is created, the Categories list is displayed, and a success message reading "Category added successfully" is displayed in the header area.'],
    ['Locate the new category in the list.',
      'A row exists showing the entered name, the entered category code and "No" in the "Added to a perk" column.'],
    ['Reload the Categories list.',
      'The new category persists after the reload, confirming it was stored.'],
  ],
});

cases.push({
  title: 'Verify creating a category with an existing name is rejected with the duplicate category error',
  priority: 'High', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-3'], screens: [S_CAT_FORM],
  description: 'AC3 negative — the first of two independent uniqueness rules the design shows for '
    + 'categories (categories_add_3): the inline message "This category already exists" under the name '
    + 'field.',
  pre: PRE_CAT_DUP,
  steps: [
    LOGIN, EXPAND, gotoChild('Categories', 'Categories'),
    ['Click "Add category" to open the creation screen.',
      'The "Create category" screen is displayed.'],
    ['Enter the recorded name of the existing category in "Category name".',
      'The value is accepted into the field.'],
    ['Enter a unique, unused value in "Category code (MCC)".',
      'The value is accepted, so the name is the only colliding field.'],
    ['Click "Add category".',
      'The category is not created and the admin remains on the "Create category" screen.'],
    ['Read the message rendered under "Category name".',
      'The inline message reads "This category already exists" and the field is outlined in the error colour.'],
    ['Read the message area under "Category code (MCC)".',
      'No duplicate-code message is displayed, so the two validations are reported independently.'],
    ['Change "Category name" to a unique value.',
      'The duplicate message is cleared and the field returns to its normal appearance.'],
    ['Click "Add category" to submit the form.',
      'The category is created and the Categories list shows the success message "Category added successfully".'],
  ],
});

cases.push({
  title: 'Verify creating a category with an existing category code is rejected with the duplicate code error',
  priority: 'High', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-3'], screens: [S_CAT_FORM],
  description: 'AC3 negative — the second uniqueness rule from the design: "This category code already '
    + 'exists" under the code field. Categories is the only one of the three screens with two '
    + 'uniqueness rules, so this case has no counterpart on Merchants or Mobile sections.',
  pre: PRE_CAT_DUP,
  steps: [
    LOGIN, EXPAND, gotoChild('Categories', 'Categories'),
    ['Click "Add category" to open the creation screen.',
      'The "Create category" screen is displayed.'],
    ['Enter a unique, unused value in "Category name".',
      'The value is accepted, so the code is the only colliding field.'],
    ['Enter the recorded category code of the existing category in "Category code (MCC)".',
      'The value is accepted into the field.'],
    ['Click "Add category".',
      'The category is not created and the admin remains on the "Create category" screen.'],
    ['Read the message rendered under "Category code (MCC)".',
      'The inline message reads "This category code already exists" and the field is outlined in the error colour.'],
    ['Read the message area under "Category name".',
      'No duplicate-name message is displayed.'],
    ['Change "Category name" to the recorded existing category name, so both fields now collide.',
      'The existing name is accepted into the field.'],
    ['Click "Add category" to submit the form again.',
      'Both inline messages are displayed at the same time — "This category already exists" under the name and "This category code already exists" under the code.'],
  ],
});

cases.push({
  title: 'Verify a category details screen is displayed and the category is edited',
  priority: 'High', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-3'], screens: [S_CAT_LIST, S_CAT_DET],
  description: 'AC3 — view then edit a category. NOTE: in the design the category details screen is '
    + 'headed "Create category" even in its read-only state, where Merchants correctly reads "Merchant '
    + 'details" (figma-analysis D-10). The step below asserts that a read-only details screen is shown '
    + 'for the selected category rather than freezing the design\'s heading into an expected result.',
  pre: PRE_CAT,
  steps: [
    LOGIN, EXPAND, gotoChild('Categories', 'Categories'),
    openRowMenu('the category whose "Added to a perk" value is No'),
    ['Click "View".',
      'A read-only details screen is displayed for the selected category, showing its stored name and category code in non-editable fields.'],
    ['Read the controls rendered in the header and at the bottom of the card.',
      'A "Delete" action and an "Edit" action are rendered in the header, and a second "Edit" action at the bottom of the card.'],
    ['Click "Edit".',
      'The name and category code fields become editable and the header action becomes "Save".'],
    ['Change the category name to a new unique value.',
      'The new value is accepted and displayed in the field.'],
    ['Click "Save".',
      'The change is saved and the updated name is displayed.'],
    ['Return to the Categories list.',
      'The Categories list is displayed again.'],
    ['Reload the Categories list.',
      'The row for that category shows the updated name after the reload, confirming it was stored.'],
  ],
});

cases.push({
  title: 'Verify deleting a category that is not added to a perk requires confirmation and removes it from the list',
  priority: 'Critical', type: 'Acceptance', automation: 'Not Automated',
  acs: ['AC-3'], screens: [S_CAT_LIST],
  description: 'AC3 — the "delete" half of the operator\'s Q2 decision for categories. The design shows '
    + 'the same confirm-modal pattern with the wording adapted to the entity (categories_deletion_1).',
  pre: PRE_CAT,
  steps: [
    LOGIN, EXPAND, gotoChild('Categories', 'Categories'),
    ['Record the category rows currently rendered and the total row count.',
      'The pre-delete list state is recorded.'],
    openRowMenu('the category whose "Added to a perk" value is No'),
    ['Click "Delete".',
      'A confirmation modal opens over a dimmed page.'],
    ['Read the text of the confirmation modal.',
      'It reads "Are you sure you want to delete this category?" and offers a "Delete" action and a "Cancel" action.'],
    ['Click "Cancel".',
      'The modal closes and no success or error message is displayed.'],
    ['Compare the rendered rows with the recorded pre-delete list.',
      'The category is still present and the row count is unchanged.'],
    ['Re-open the row actions menu on the same category.',
      'The row actions menu opens again with "Delete" enabled.'],
    ['Click "Delete".',
      'The confirmation modal opens again.'],
    ['Click "Delete" in the modal to confirm.',
      'The modal closes and a success message confirming the category was deleted is displayed in the header area.'],
    ['Compare the rendered rows with the recorded pre-delete list.',
      'The deleted category\'s row is no longer rendered, the row count has decreased by one, and every other row is unchanged.'],
    ['Reload the Categories list.',
      'The deleted category is still absent after the reload.'],
  ],
});

cases.push({
  title: 'Verify the Delete action is disabled for a category that is added to a perk',
  priority: 'Critical', type: 'Acceptance', automation: 'Not Automated',
  acs: ['AC-3'], screens: [S_CAT_LIST, S_CAT_DET],
  description: 'AC3 — the in-use rule applied to categories, keyed on the same "Added to a perk" column '
    + 'as Merchants. Design-only: no acceptance criterion mentions it.',
  pre: PRE_CAT,
  steps: [
    LOGIN, EXPAND, gotoChild('Categories', 'Categories'),
    ['Read the "Added to a perk" cell of the recorded in-use category.',
      'The cell reads "Yes".'],
    openRowMenu('the category whose "Added to a perk" value is Yes'),
    ['Read the appearance and state of the "Delete" item in the menu.',
      'The "Delete" item is rendered disabled.'],
    ['Attempt to click the disabled "Delete" item.',
      'No confirmation modal opens and the category is not deleted.'],
    ['Click "View" to open that category\'s details screen.',
      'The read-only details screen is displayed for the in-use category.'],
    ['Read the state of the "Delete" action in the details header.',
      'The "Delete" action is rendered disabled, while "Edit" remains enabled.'],
    ['Return to the Categories list and open the row menu of the recorded category whose "Added to a perk" value is No.',
      'The row actions menu opens for that category.'],
    ['Read the state of the "Delete" item for that category.',
      '"Delete" is enabled for the category that is not added to a perk, confirming the difference is driven by the in-use state.'],
  ],
});

// ══════════════════════════════════════════════════════════════════════════════
// AC3 — Mobile sections
// ══════════════════════════════════════════════════════════════════════════════

cases.push({
  title: 'Verify the Mobile sections list renders the columns Section name EN, Section name AR and Perks added with a drag handle on every row',
  priority: 'Critical', type: 'Acceptance', automation: 'Not Automated',
  acs: ['AC-3'], screens: [S_SEC_LIST],
  description: 'AC3 — Mobile sections is a standalone management screen. The design '
    + '(sections_no_perks_added) gives every row a drag handle and labels the in-use column "Perks '
    + 'added", NOT "Added to a perk" as on the other two screens.',
  pre: PRE_SEC,
  steps: [
    LOGIN, EXPAND, gotoChild('Mobile sections', 'Mobile sections'),
    ['Read the column headers of the mobile sections table from left to right.',
      'The headers read "Section name EN", "Section name AR", "Perks added" and "Actions", preceded by an unlabelled column.'],
    ['Read the header of the in-use column and compare it with the Merchants and Categories lists.',
      'This screen labels the column "Perks added", whereas Merchants and Categories label theirs "Added to a perk".'],
    ['Inspect the leading edge of every rendered row.',
      'Each row displays a drag handle control at its leading edge.'],
    ['Read the Arabic name cell of a section.',
      'The Arabic section name is rendered in Arabic characters, right-to-left within its own cell.'],
    ['Read the "Perks added" cell values across the rendered rows.',
      'Each cell shows either "Yes" or "No".'],
    ['Read the pagination control below the table.',
      'A pagination control with previous, page-number and next affordances is rendered.'],
    openRowMenu('any section in the list'),
    ['Count and read the items in the open menu.',
      'Exactly two items are rendered — "View" and "Delete" — with no "Edit" item in the row menu.'],
    ['Close the menu, then read the label of the top-right primary action.',
      'The label reads "Add section".'],
  ],
});

cases.push({
  title: 'Verify the Mobile sections empty state is displayed with its message and Add section action',
  priority: 'Medium', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-3'], screens: [S_SEC_LIST],
  description: 'AC3 — empty state from the design frame sections_list.',
  pre: PRE_EMPTY('mobile sections', 'section'),
  steps: [
    LOGIN, EXPAND, gotoChild('Mobile sections', 'Mobile sections'),
    ['Read the content of the mobile sections panel while no sections exist.',
      'No table is rendered; an empty-state block is displayed centred in the panel.'],
    ['Read the empty-state heading.',
      'The heading reads "There are no sections added yet".'],
    ['Read the empty-state sub-line.',
      'The sub-line reads "You can add sections by tapping the add section button".'],
    ['Click the "Add section" button inside the empty state.',
      'The section creation screen is displayed with the page title "Create section".'],
  ],
});

cases.push({
  title: 'Verify a mobile section is created with its required English and Arabic names',
  priority: 'Critical', type: 'Acceptance', automation: 'Not Automated',
  acs: ['AC-3'], screens: [S_SEC_FORM, S_SEC_LIST],
  description: 'AC3 — the "add" half of the operator\'s Q2 decision for mobile sections. The design form '
    + 'has the EN/AR name pair, both required, and exposes no other field — notably no active/inactive '
    + 'control (figma-analysis D-11).',
  pre: PRE_BASE,
  steps: [
    LOGIN, EXPAND, gotoChild('Mobile sections', 'Mobile sections'),
    ['Click "Add section" in the top-right of the header.',
      'The section creation screen is displayed and its page title reads "Create section".'],
    ['Read the field labels rendered on the form and note which carry a required marker.',
      'Exactly two fields are rendered — "Section name EN" and "Section name AR" — each with a required marker.'],
    ['Enter a unique English name in "Section name EN".',
      'The value is accepted and displayed in the field.'],
    ['Enter an Arabic name in "Section name AR".',
      'The Arabic value is accepted and rendered right-to-left inside that field.'],
    ['Click "Add section".',
      'The section is created, the Mobile sections list is displayed, and a success message confirming the section was added is displayed in the header area.'],
    ['Locate the new section in the list.',
      'A row exists showing the entered English name, the entered Arabic name, a drag handle, and "No" in the "Perks added" column.'],
    ['Reload the Mobile sections list.',
      'The new section persists after the reload, confirming it was stored.'],
  ],
});

cases.push({
  title: 'Verify a mobile section is reordered by dragging its row and the new order persists',
  priority: 'High', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-3'], screens: [S_SEC_LIST],
  description: 'AC3 — the drag handle on every row is the visible control for the section display order, '
    + 'which is the one property on these three screens whose effect reaches the mobile app. This is the '
    + 'only reordering control among the three new screens: Merchants and Categories have no drag handle.',
  pre: PRE_SEC_ORDER,
  steps: [
    LOGIN, EXPAND, gotoChild('Mobile sections', 'Mobile sections'),
    ['Read and record the order of the rendered sections from top to bottom.',
      'The current order is recorded and matches the recorded pre-test order.'],
    ['Drag the first section\'s row, using its drag handle, to the third position.',
      'The row moves and the list re-renders with that section in the third position and the two sections above it shifted up.'],
    ['Read the new order of the rendered sections.',
      'The new order reflects the move, with no section duplicated and none lost.'],
    ['Reload the Mobile sections list.',
      'The sections render in the new order after the reload, confirming the reorder was stored rather than only shown.'],
    ['Compare the stored display order returned by the section list endpoint with the rendered order.',
      'The stored order matches the rendered order.'],
  ],
});

cases.push({
  title: 'Verify a mobile section details screen is displayed and the section is edited',
  priority: 'High', type: 'Functional', automation: 'Not Automated',
  acs: ['AC-3'], screens: [S_SEC_LIST, S_SEC_DET],
  description: 'AC3 — view then edit a mobile section. As with Categories, the design heads this screen '
    + '"Create section" even read-only (figma-analysis D-10), so the assertion is that a read-only '
    + 'details screen for the selected section is shown, not the design\'s heading text.',
  pre: PRE_SEC,
  steps: [
    LOGIN, EXPAND, gotoChild('Mobile sections', 'Mobile sections'),
    openRowMenu('the section whose "Perks added" value is No'),
    ['Click "View".',
      'A read-only details screen is displayed for the selected section, showing its stored English and Arabic names in non-editable fields.'],
    ['Read the controls rendered in the header and at the bottom of the card.',
      'A "Delete" action and an "Edit" action are rendered in the header, and a second "Edit" action at the bottom of the card.'],
    ['Click "Edit".',
      'Both name fields become editable and the header action becomes "Save".'],
    ['Change the English name to a new unique value.',
      'The new value is accepted and displayed in the field.'],
    ['Click "Save".',
      'The change is saved and the updated name is displayed.'],
    ['Return to the Mobile sections list.',
      'The Mobile sections list is displayed again.'],
    ['Reload the Mobile sections list.',
      'The row for that section shows the updated English name after the reload, confirming it was stored.'],
  ],
});

cases.push({
  title: 'Verify deleting a mobile section that has no perks added requires confirmation and removes it from the list',
  priority: 'Critical', type: 'Acceptance', automation: 'Not Automated',
  acs: ['AC-3'], screens: [S_SEC_LIST],
  description: 'AC3 — the "delete" half of the operator\'s Q2 decision for mobile sections, for a section '
    + 'that holds no perks. Confirm-modal wording from the design (sections_deletion_1).',
  pre: PRE_SEC,
  steps: [
    LOGIN, EXPAND, gotoChild('Mobile sections', 'Mobile sections'),
    ['Record the section rows currently rendered, their order and the total row count.',
      'The pre-delete list state is recorded.'],
    openRowMenu('the section whose "Perks added" value is No'),
    ['Click "Delete".',
      'A confirmation modal opens over a dimmed page.'],
    ['Read the text of the confirmation modal.',
      'It reads "Are you sure you want to delete this section?" and offers a "Delete" action and a "Cancel" action.'],
    ['Click "Cancel".',
      'The modal closes and no success or error message is displayed.'],
    ['Compare the rendered rows with the recorded pre-delete list.',
      'The section is still present and the row count is unchanged.'],
    ['Re-open the row actions menu on the same section.',
      'The row actions menu opens again with "Delete" enabled.'],
    ['Click "Delete".',
      'The confirmation modal opens again.'],
    ['Click "Delete" in the modal to confirm.',
      'The modal closes and a success message confirming the section was deleted is displayed in the header area.'],
    ['Compare the rendered rows with the recorded pre-delete list.',
      'The deleted section\'s row is no longer rendered, the row count has decreased by one, and the remaining sections keep their relative order.'],
    ['Reload the Mobile sections list.',
      'The deleted section is still absent after the reload.'],
  ],
});

cases.push({
  title: 'Verify the Delete action is disabled for a mobile section that has perks added',
  priority: 'Critical', type: 'Acceptance', automation: 'Not Automated',
  acs: ['AC-3'], screens: [S_SEC_LIST, S_SEC_DET],
  description: 'AC3 — the in-use rule for mobile sections, keyed on a DIFFERENT predicate from the other '
    + 'two screens: the design disables Delete when the section CONTAINS perks ("Perks added" = Yes), '
    + 'not when the section is itself attached to a perk. Verified in both entry points '
    + '(sections_perks_added row menu, sections_view_has_perks details header).',
  pre: PRE_SEC,
  steps: [
    LOGIN, EXPAND, gotoChild('Mobile sections', 'Mobile sections'),
    ['Read the "Perks added" cell of the recorded section that contains perks.',
      'The cell reads "Yes".'],
    openRowMenu('the section whose "Perks added" value is Yes'),
    ['Read the appearance and state of the "Delete" item in the menu.',
      'The "Delete" item is rendered disabled.'],
    ['Attempt to click the disabled "Delete" item.',
      'No confirmation modal opens and the section is not deleted.'],
    ['Click "View" to open that section\'s details screen.',
      'The read-only details screen is displayed for the section that contains perks.'],
    ['Read the state of the "Delete" action in the details header.',
      'The "Delete" action is rendered disabled, while "Edit" remains enabled.'],
    ['Return to the Mobile sections list and open the row menu of the recorded section whose "Perks added" value is No.',
      'The row actions menu opens for that section.'],
    ['Read the state of the "Delete" item for that section.',
      '"Delete" is enabled for the section that contains no perks, confirming the difference is driven by whether the section contains perks.'],
  ],
});

// ══════════════════════════════════════════════════════════════════════════════
// CSV emit
// ══════════════════════════════════════════════════════════════════════════════
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
  const ref = (i) => `C-${String(i + 1).padStart(2, '0')}`;
  const byAc = {};
  cases.forEach((c, i) => c.acs.forEach((a) => (byAc[a] = byAc[a] || []).push(ref(i))));
  cases.forEach((c, i) => console.log(`  ${ref(i)} [${c.priority.padEnd(8)}] [${c.type.padEnd(10)}] ${c.acs.join('+').padEnd(6)} ${c.title}`));
  console.log('\nAC coverage:');
  Object.keys(byAc).sort().forEach((a) => console.log(`  ${a}: ${byAc[a].length} cases — ${byAc[a].join(', ')}`));
  const byType = {};
  cases.forEach((c) => (byType[c.type] = (byType[c.type] || 0) + 1));
  console.log('\nBy type:', JSON.stringify(byType));
  const byPrio = {};
  cases.forEach((c) => (byPrio[c.priority] = (byPrio[c.priority] || 0) + 1));
  console.log('By priority:', JSON.stringify(byPrio));
}

module.exports = { cases, ISSUES, PROJECT, FOLDER_PATH, BS_PROJECT_ID, BS_FOLDER_ID };
