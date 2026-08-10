'use strict';

/**
 * B10-57764 — BrowserStack Test Management CSV generator (Admin Portal: Featured Perk Flag).
 *
 * Emits the canonical 24-column BrowserStack import shape (browserstack-process §10.1–10.4):
 * the FIRST row of each case carries all metadata plus step 1; every subsequent step is a row with
 * only Steps + Expected Result populated. System-owned columns are left blank on a new import (§10.3).
 *
 * Conformance notes (these differ from B10-57771's generator, which predates the current gate):
 *   - Template is "Steps", not "Test Case Steps"  → qa-workflow/lib/testcases/lint.js
 *   - Tags carry `ac:AC-<n>` (mandatory) + `screen:<id>`  → §10.2a
 *   - Type of Test Case is from Acceptance/Regression/Functional/Usability/Smoke & Sanity
 *
 * Every step is written against the CURRENT screen as verified live on 2026-08-10 (8 columns,
 * Category/Type/Status filters + Search, 15 rows/page) plus the design's specified new column.
 * The feature is NOT deployed yet — this is the pre-development coverage baseline.
 *
 * Authorities for expected results: AC1–AC6, and the recorded decisions in
 * ../clarification/clarifications.md (D-1 category = section, D-2 block only vs an Active incumbent,
 * D-3 Active-only featurable, A-1 AC copy wins, A-3 AC5 asserted behaviourally, A-6 immediate write).
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
const PROJECT = 'BCard Squad';
const FOLDER_PATH = 'Card Ops.Sprint3.4/Admin Portal  — Featured Perk Flag (1 per category)';
const ISSUES = 'B10-57764';
const BASE_TAGS = 'ai-created';

// ── Screens (figma-analysis §5 screen registry) ────────────────────────────────
const S_FILTERED = 'admin.perks.list.filtered';
const S_ALL      = 'admin.perks.list.all';
const S_BLOCKED  = 'admin.perks.list.featured-blocked';
const S_EMPTY    = 'admin.perks.list.empty';
const S_EXPIRED  = 'admin.perks.list.expired-featured';   // NO FIGMA REF — functional only
const S_UNFEAT   = 'admin.perks.list.unfeature';          // NO FIGMA REF — functional only

// ── Fixtures, verified live 2026-08-10 via POST card/perks/list (195 records) ──
// "Category" in the UI == the perk SECTION (decision D-1).
const C1 = 'demo section';          // 37 Active perks
const C1_A = 'DC_68';               // Active, discount-coupon, C1
const C1_B = 'DC_67';               // Active, discount-coupon, C1
const C2 = 'Coffee & Beverages';    // 5 Active perks
const C2_A = 'DC_14';               // Active, discount-coupon, C2
const PLANNED = 'DC_56';            // Planned, "Everyday Spend"
const NO_CAT = 'DC_10';             // Active, section_id = null (7 such records exist)
const EXP_CAT = 'QA57764 Expiry';   // seeded, dedicated: isolates the one-way AC6 fixture
const EXP_A = 'QA57764 ExpFeat';    // seeded Active, near-term end_date — DELIBERATELY SPENT
const EXP_B = 'QA57764 NextFeat';   // seeded Active, same section

// ── Shared precondition fragments ─────────────────────────────────────────────
const PRE_BASE = 'The B10-57764 build is deployed to the card admin panel (card-panel-testing.breadfast.tech). '
  + 'An admin account with perks-management permission is available. '
  + '"Category" in the perks table is the perk section.';
const PRE_C1_CLEAN = `${PRE_BASE} Category "${C1}" contains at least two Active perks (${C1_A}, ${C1_B}) and no perk in "${C1}" is currently featured.`;
const PRE_C1_FEAT = `${PRE_BASE} Perk ${C1_A} is currently the featured perk of Category "${C1}" and is Active. Perk ${C1_B} is Active in the same category and is not featured.`;

const NAV = ['Log in to the card admin panel as an admin with perks-management permission',
  'The dashboard loads and the header shows the logged-in admin and the panel version'];
const OPEN_LIST = ['Open the "Card Perks" screen from the left navigation',
  'The "Card perks" list screen loads, the perks table renders rows, and the Category, Type and Status filters are displayed above it'];
const filterTo = (cat) => [
  [`Select "${cat}" in the Category filter`, `"${cat}" is shown as the selected option in the Category filter`],
  ['Click the "Search" button', `The table reloads and the Category cell of every listed row reads "${cat}"`],
];
// One user action per step (§3.7): a reload and a re-filter are three actions, never one.
const reloadAndFilter = (cat) => [
  ['Reload the browser page', 'The "Card perks" list screen reloads and the Category filter returns to "All"'],
  ...filterTo(cat),
];

// ── Cases ─────────────────────────────────────────────────────────────────────
const CASES = [];
const c = (o) => (CASES.push(o), o);

c({
  title: 'Verify the Featured column renders between Status and Actions in a category-filtered perks list',
  priority: 'High', type: 'Acceptance', auto: 'Not Automated', acs: ['AC-1'], screens: [S_FILTERED],
  description: 'Confirms AC1 in the category-filtered view: a "Featured" column exists, sits immediately between Status and Actions, and carries a checkbox on every row.',
  pre: PRE_C1_CLEAN,
  steps: [
    NAV, OPEN_LIST, ...filterTo(C1),
    ['Read the column headers of the perks table from left to right',
      'The headers are: perk logo, "Perk ID", "Category", "Type", "Title", "Description", "Status", "Featured", "Actions"'],
    ['Compare the position of the "Featured" header with the "Status" and "Actions" headers',
      '"Featured" is immediately to the right of "Status" and immediately to the left of "Actions"'],
    [`Read the Featured cell of the row for perk ${C1_A}`, 'The cell contains a single checkbox control'],
    ['Read the Featured cell of every other listed row', 'Each row shows exactly one checkbox in its Featured cell'],
  ],
});

c({
  title: 'Verify the Featured column renders in the unfiltered All perks view',
  priority: 'Medium', type: 'Acceptance', auto: 'Not Automated', acs: ['AC-1'], screens: [S_ALL],
  description: 'Confirms the description\'s requirement that the Featured column appears in the "All perks" view as well as in category-filtered views.',
  pre: PRE_BASE,
  steps: [
    NAV, OPEN_LIST,
    ['Confirm the Category filter is set to "All"', 'The Category filter shows "All" as the selected option'],
    ['Click the "Search" button', 'The table reloads and lists perks from more than one category'],
    ['Read the column headers of the perks table from left to right',
      'A "Featured" column header is present, immediately between "Status" and "Actions"'],
    ['Read the Featured cell of each listed row', 'Each row shows a checkbox in its Featured cell'],
  ],
});

c({
  title: 'Verify every perk in a category is unfeatured before any perk is featured',
  priority: 'Medium', type: 'Functional', auto: 'Not Automated', acs: ['AC-2'], screens: [S_FILTERED],
  description: 'Establishes the default state: the new Featured flag defaults to unset for pre-existing perks, so no perk is promoted without an admin action.',
  pre: PRE_C1_CLEAN,
  steps: [
    NAV, OPEN_LIST, ...filterTo(C1),
    ['Read the Featured checkbox state of every listed row', 'Every Featured checkbox is unchecked'],
    ['Page through the remaining pages of the filtered list using the "Next" control',
      'No perk in the category has a checked Featured checkbox on any page'],
  ],
});

c({
  title: 'Verify checking the Featured box marks an Active perk as featured for its category',
  priority: 'Critical', type: 'Acceptance', auto: 'Not Automated', acs: ['AC-2'], screens: [S_FILTERED],
  description: 'Core AC2 happy path: with the list filtered by a category, checking an Active perk\'s Featured box marks that perk featured for that category.',
  pre: PRE_C1_CLEAN,
  steps: [
    NAV, OPEN_LIST, ...filterTo(C1),
    [`Locate the row for perk ${C1_A}`, `The row for ${C1_A} is listed and its Featured checkbox is unchecked`],
    [`Click the Featured checkbox of perk ${C1_A}`, `The Featured checkbox of ${C1_A} becomes checked`],
    ['Read the Featured checkbox state of the other rows in the category',
      `Only ${C1_A} is checked; every other perk in "${C1}" remains unchecked`],
    [`Read the Status cell of perk ${C1_A}`, `The Status of ${C1_A} still reads "Active" and is unchanged by featuring`],
    [`Read the Perk ID, Category, Type, Title and Description cells of perk ${C1_A}`,
      `All five values are unchanged from before the perk was featured — featuring alters no other attribute of the record`],
  ],
});

c({
  title: 'Verify a featured perk remains featured after the perks list is reloaded and re-filtered',
  priority: 'Critical', type: 'Acceptance', auto: 'Not Automated', acs: ['AC-2'], screens: [S_FILTERED],
  description: 'Confirms the featured flag is persisted server-side on check rather than held in the page state — the check is an immediate write, with no Save step in the design.',
  pre: PRE_C1_FEAT,
  steps: [
    NAV, OPEN_LIST, ...filterTo(C1),
    [`Confirm the Featured checkbox of perk ${C1_A} is checked`, `The Featured checkbox of ${C1_A} is checked`],
    ...reloadAndFilter(C1),
    [`Read the Featured checkbox of perk ${C1_A}`, `The Featured checkbox of ${C1_A} is still checked`],
  ],
});

c({
  title: 'Verify the featured state of a perk is returned by the perks API consumed by the mobile app',
  priority: 'High', type: 'Functional', auto: 'Not Automated', acs: ['AC-2'], screens: [S_FILTERED],
  description: 'Confirms the featured flag is exposed on the perk record in the perks list API, which is the contract the mobile Featured hero card (B10-57796) reads. Without it the flag cannot reach the app.',
  pre: PRE_C1_FEAT,
  steps: [
    ['Authenticate against the card service API as an admin user', 'A bearer token is returned with HTTP 200'],
    [`Request the perk record for ${C1_A} from the perks retrieval endpoint`, `HTTP 200 is returned with the record for ${C1_A}`],
    ['Read the featured attribute of the returned perk record', `The record carries a featured attribute and its value indicates ${C1_A} is featured`],
    [`Request the perk record for ${C1_B} from the same endpoint`, `HTTP 200 is returned and the featured attribute of ${C1_B} indicates it is not featured`],
    ['Request the perks list used by the mobile app', `HTTP 200 is returned and the featured attribute is present on the ${C1_A} entry`],
  ],
});

c({
  title: 'Verify featuring a second Active perk in the same category is blocked and the perk is not featured',
  priority: 'Critical', type: 'Acceptance', auto: 'Not Automated', acs: ['AC-3'], screens: [S_BLOCKED],
  description: 'Core AC3 negative path: a category may hold only one featured perk, so a second attempt while an Active perk is already featured must be refused and must not change any state.',
  pre: PRE_C1_FEAT,
  steps: [
    NAV, OPEN_LIST, ...filterTo(C1),
    [`Confirm perk ${C1_A} is the featured perk of the category`, `The Featured checkbox of ${C1_A} is checked`],
    [`Click the Featured checkbox of perk ${C1_B}`, `The Featured checkbox of ${C1_B} does not become checked`],
    [`Read the Featured checkbox state of perk ${C1_B}`, `${C1_B} remains unchecked — the action was blocked`],
    ...reloadAndFilter(C1),
    [`Read the Featured checkbox of perk ${C1_B}`, `${C1_B} is still unchecked after the reload, confirming nothing was persisted`],
  ],
});

c({
  title: 'Verify the blocked attempt displays the one-featured-perk-per-category error message',
  priority: 'High', type: 'Acceptance', auto: 'Not Automated', acs: ['AC-3'], screens: [S_BLOCKED],
  description: 'Confirms the AC3 error copy. The expected string is taken verbatim from AC3, which includes a trailing full stop; the Figma toast omits it, and that discrepancy is an open product question (clarifications A-1).',
  pre: PRE_C1_FEAT,
  steps: [
    NAV, OPEN_LIST, ...filterTo(C1),
    [`Click the Featured checkbox of perk ${C1_B} while ${C1_A} is featured`, 'An error message is displayed on the perks list screen'],
    ['Read the text of the error message immediately after the click',
      'The message reads "You can only have 1 featured perk per category."'],
    [`Read the Featured checkbox of perk ${C1_B} while the message is displayed`,
      `${C1_B} is unchecked, so the message accompanies a refused action rather than a completed one`],
  ],
});

c({
  title: 'Verify the originally featured perk keeps its featured state after a blocked attempt',
  priority: 'High', type: 'Functional', auto: 'Not Automated', acs: ['AC-3'], screens: [S_BLOCKED],
  description: 'Confirms the blocked attempt has no side effect on the incumbent: a refused second feature must not clear, move or toggle the perk that is already featured.',
  pre: PRE_C1_FEAT,
  steps: [
    NAV, OPEN_LIST, ...filterTo(C1),
    [`Click the Featured checkbox of perk ${C1_B} while ${C1_A} is featured`, 'The attempt is refused and the error message is displayed'],
    [`Read the Featured checkbox of perk ${C1_A}`, `The Featured checkbox of ${C1_A} is still checked`],
    ...reloadAndFilter(C1),
    ['Read the Featured checkbox state of every listed row',
      `${C1_A} is still the only checked perk in the category, so the category was not left with zero featured perks`],
  ],
});

c({
  title: 'Verify unchecking the Featured box removes the featured state from a perk',
  priority: 'Critical', type: 'Acceptance', auto: 'Not Automated', acs: ['AC-4'], screens: [S_UNFEAT],
  description: 'Confirms the unfeature half of AC4 — the flag is reversible, which is the prerequisite for changing a category\'s featured perk.',
  pre: PRE_C1_FEAT,
  steps: [
    NAV, OPEN_LIST, ...filterTo(C1),
    [`Confirm the Featured checkbox of perk ${C1_A} is checked`, `The Featured checkbox of ${C1_A} is checked`],
    [`Click the Featured checkbox of perk ${C1_A}`, `The Featured checkbox of ${C1_A} becomes unchecked`],
    ...reloadAndFilter(C1),
    ['Read the Featured checkbox state of every listed row',
      `${C1_A} is unchecked after the reload and no perk in "${C1}" is featured`],
  ],
});

c({
  title: 'Verify the featured perk of a category can be changed by unfeaturing the current perk first',
  priority: 'Critical', type: 'Acceptance', auto: 'Not Automated', acs: ['AC-4'], screens: [S_UNFEAT],
  description: 'Confirms the AC4 workflow end to end: the admin cannot swap directly, but unfeaturing the incumbent then featuring another perk succeeds.',
  pre: PRE_C1_FEAT,
  steps: [
    NAV, OPEN_LIST, ...filterTo(C1),
    [`Click the Featured checkbox of perk ${C1_B} while ${C1_A} is still featured`, `The attempt is refused and ${C1_B} remains unchecked`],
    [`Click the Featured checkbox of perk ${C1_A} to unfeature it`, `The Featured checkbox of ${C1_A} becomes unchecked`],
    [`Click the Featured checkbox of perk ${C1_B}`, `The Featured checkbox of ${C1_B} becomes checked`],
    ['Read the Featured checkbox state of both perks',
      `${C1_B} is checked and ${C1_A} is unchecked — the category's featured perk has changed`],
    ...reloadAndFilter(C1),
    ['Read the Featured checkbox state of every listed row', `${C1_B} is still the only checked perk in "${C1}"`],
  ],
});

c({
  title: 'Verify featuring a perk in one category does not affect the featured perk of another category',
  priority: 'High', type: 'Functional', auto: 'Not Automated', acs: ['AC-2'], screens: [S_FILTERED],
  description: 'Confirms the flag is scoped per category: two different categories may each hold their own featured perk simultaneously, and featuring in one must not disturb the other.',
  pre: `${PRE_BASE} Perk ${C1_A} is the featured Active perk of Category "${C1}". Category "${C2}" contains the Active perk ${C2_A} and has no featured perk.`,
  steps: [
    NAV, OPEN_LIST, ...filterTo(C2),
    [`Click the Featured checkbox of perk ${C2_A}`, `The Featured checkbox of ${C2_A} becomes checked and no error message is displayed`],
    ...filterTo(C1),
    [`Read the Featured checkbox of perk ${C1_A}`, `The Featured checkbox of ${C1_A} is still checked — the other category is unaffected`],
    ...filterTo(C2),
    [`Read the Featured checkbox of perk ${C2_A}`, `${C2_A} is still checked, so both categories hold their own featured perk simultaneously`],
  ],
});

c({
  title: 'Verify the Featured checkboxes are not interactive when the list is not filtered by a category',
  priority: 'Critical', type: 'Acceptance', auto: 'Not Automated', acs: ['AC-5'], screens: [S_ALL],
  description: 'Core AC5 negative path. Asserted behaviourally rather than visually: in the design the disabled unchecked checkbox is pixel-identical to the enabled one, so "dimmed" has no visual oracle (clarifications A-3).',
  pre: `${PRE_BASE} No perk in Category "${C1}" is currently featured.`,
  steps: [
    NAV, OPEN_LIST,
    ['Confirm the Category filter is set to "All"', 'The Category filter shows "All" as the selected option'],
    ['Click the "Search" button', 'The table reloads and lists perks from more than one category'],
    ['Read the perks table header row', 'The "Featured" column is still visible in the header'],
    [`Locate the row for perk ${C1_A}`, `The row for ${C1_A} is listed`],
    [`Read the Featured checkbox state of perk ${C1_A}`, 'The checkbox is unchecked and is marked as disabled or non-interactive'],
    [`Click the Featured checkbox of perk ${C1_A}`, 'The checkbox does not change state and remains unchecked'],
    ...reloadAndFilter(C1),
    [`Read the Featured checkbox of perk ${C1_A}`,
      `${C1_A} is unchecked, confirming the click in the unfiltered view was not persisted`],
  ],
});

c({
  title: 'Verify the Featured checkboxes become interactive after a category is selected and Search is applied',
  priority: 'High', type: 'Acceptance', auto: 'Not Automated', acs: ['AC-5'], screens: [S_FILTERED],
  description: 'Confirms the positive half of AC5, including that the filter must actually be applied — selecting a category in the dropdown does not re-query the list until Search is clicked.',
  pre: PRE_C1_CLEAN,
  steps: [
    NAV, OPEN_LIST,
    ['Confirm the Category filter is set to "All"', 'The Category filter shows "All" as the selected option'],
    ['Click the "Search" button', 'The table lists perks from more than one category and the Featured checkboxes are non-interactive'],
    [`Select "${C1}" in the Category filter without clicking "Search"`, `"${C1}" is selected in the filter and the table still shows the previous, unfiltered result set`],
    ['Click the "Search" button', `The table reloads and the Category cell of every listed row reads "${C1}"`],
    [`Read the Featured checkbox state of the row for perk ${C1_A}`, 'The checkbox is enabled and interactive'],
    [`Click the Featured checkbox of perk ${C1_A}`, `The Featured checkbox of ${C1_A} becomes checked`],
  ],
});

c({
  title: 'Verify applying only the Type or Status filter does not make the Featured checkboxes interactive',
  priority: 'Medium', type: 'Functional', auto: 'Not Automated', acs: ['AC-5'], screens: [S_ALL],
  description: 'AC5 gates the checkbox on the list being filtered by a category. This confirms the other two filters do not satisfy that condition while Category remains "All".',
  pre: PRE_BASE,
  steps: [
    NAV, OPEN_LIST,
    ['Confirm the Category filter is set to "All"', 'The Category filter shows "All" as the selected option'],
    ['Select "Discount/coupon" in the Type filter', '"Discount/coupon" is selected in the Type filter and Category still reads "All"'],
    ['Click the "Search" button', 'The table reloads and lists only Discount/coupon perks, from more than one category'],
    ['Read the Featured checkbox state of the first listed row', 'The checkbox is unchecked and is marked as disabled or non-interactive'],
    ['Select "Active" in the Status filter', '"Active" is selected in the Status filter and Category still reads "All"'],
    ['Click the "Search" button', 'The table reloads and lists only Active Discount/coupon perks'],
    ['Read the Featured checkbox state of the first listed row', 'The checkbox is still disabled or non-interactive, because the list is not filtered by a category'],
  ],
});

c({
  title: 'Verify a perk that belongs to no category cannot be featured',
  priority: 'Low', type: 'Functional', auto: 'Not Automated', acs: ['AC-5'], screens: [S_ALL],
  description: 'Boundary case. Perks with no category exist in the data (verified: 7 records, including an Active one). No option in the Category filter selects them, so under AC5 they can only ever be seen in the unfiltered view, where the checkbox is not interactive.',
  pre: `${PRE_BASE} An Active perk with an empty Category exists (${NO_CAT}).`,
  steps: [
    NAV, OPEN_LIST,
    ['Confirm the Category filter is set to "All"', 'The Category filter shows "All" as the selected option'],
    ['Click the "Search" button', 'The table reloads and lists perks from more than one category'],
    [`Locate the row for perk ${NO_CAT}`, `The row for ${NO_CAT} is listed`],
    [`Read the Category cell of the row for perk ${NO_CAT}`, 'The Category cell of the row is empty'],
    ['Read the options offered by the Category filter', 'No option corresponds to perks with an empty Category'],
    [`Read the Featured checkbox state of perk ${NO_CAT}`, 'The checkbox is unchecked and is marked as disabled or non-interactive'],
    [`Click the Featured checkbox of perk ${NO_CAT}`, 'The checkbox does not change state and the perk is not featured'],
  ],
});

c({
  title: 'Verify a featured perk remains ticked as featured after it becomes Expired',
  priority: 'High', type: 'Acceptance', auto: 'Automation Not Required', acs: ['AC-6'], screens: [S_EXPIRED],
  description: 'Core AC6. Run manually: the fixture is one-way. Expiring a perk succeeds once and every later update of that perk is rejected, so the perk used here is deliberately spent and must be a purpose-seeded disposable record, never an existing one.',
  pre: `${PRE_BASE} A dedicated Category "${EXP_CAT}" has been seeded containing the Active, disposable perk ${EXP_A} with a near-term end date. No other perk in that category is featured. The perk will be permanently expired by this case.`,
  steps: [
    NAV, OPEN_LIST, ...filterTo(EXP_CAT),
    [`Click the Featured checkbox of perk ${EXP_A}`, `The Featured checkbox of ${EXP_A} becomes checked`],
    [`Read the Status cell of perk ${EXP_A}`, 'The Status reads "Active"'],
    [`Expire perk ${EXP_A} by setting its end date to a past date`, 'The update is accepted and the perk moves to the Expired state'],
    ...reloadAndFilter(EXP_CAT),
    [`Read the Status cell of perk ${EXP_A}`, `The row for ${EXP_A} is listed and its Status cell now reads "Expired"`],
    [`Read the Featured checkbox of perk ${EXP_A}`, `The Featured checkbox of ${EXP_A} is still checked — the featured state survived the transition to Expired`],
  ],
});

c({
  title: 'Verify featuring a new perk in a category whose featured perk is Expired succeeds and displaces it',
  priority: 'High', type: 'Acceptance', auto: 'Automation Not Required', acs: ['AC-6'], screens: [S_EXPIRED],
  description: 'Resolves AC6 against AC3/AC4 per recorded decision D-2: the one-per-category block applies only while the incumbent featured perk is Active, so a new perk may be featured over an Expired one, which is what makes AC6\'s "until a new perk is featured" reachable. Run manually — continues the one-way fixture chain from the previous case.',
  pre: `${PRE_BASE} In Category "${EXP_CAT}", the perk ${EXP_A} is featured and its Status is Expired. The Active perk ${EXP_B} exists in the same category and is not featured.`,
  steps: [
    NAV, OPEN_LIST, ...filterTo(EXP_CAT),
    [`Confirm the Featured checkbox of perk ${EXP_A} is checked and its Status reads "Expired"`, `${EXP_A} is checked and its Status cell reads "Expired"`],
    [`Click the Featured checkbox of the Active perk ${EXP_B}`, `The Featured checkbox of ${EXP_B} becomes checked and no error message is displayed`],
    [`Read the Featured checkbox of the expired perk ${EXP_A}`, `The Featured checkbox of ${EXP_A} is no longer checked — it has been displaced by the newly featured perk`],
    ...reloadAndFilter(EXP_CAT),
    ['Read the Featured checkbox state of every listed row', `${EXP_B} is the only checked perk in "${EXP_CAT}"`],
  ],
});

c({
  title: 'Verify the one-featured-perk-per-category rule is enforced by the API and not only by the admin screen',
  priority: 'High', type: 'Functional', auto: 'Not Automated', acs: ['AC-3'], screens: [S_BLOCKED],
  description: 'AC3 states the action is blocked. This confirms the rule holds at its enforcement point, so the invariant cannot be bypassed by a direct API call or by two admins acting at the same time — which would leave a category with two featured perks.',
  pre: PRE_C1_FEAT,
  steps: [
    ['Authenticate against the card service API as an admin user', 'A bearer token is returned with HTTP 200'],
    [`Request the perk record for ${C1_A} and confirm it is featured`, `HTTP 200 is returned and the featured attribute of ${C1_A} indicates it is featured`],
    [`Call the mark-as-featured endpoint for perk ${C1_B}, which is Active in the same category`, 'The request is rejected with a client error response and the response body states that only one featured perk per category is allowed'],
    [`Request the perk record for ${C1_B}`, `HTTP 200 is returned and the featured attribute of ${C1_B} indicates it is not featured`],
    [`Request the perk record for ${C1_A}`, `HTTP 200 is returned and ${C1_A} is still featured`],
  ],
});

c({
  title: 'Verify the perks table column set, row actions and filters still work after the Featured column is added',
  priority: 'High', type: 'Regression', auto: 'Not Automated', acs: ['AC-1'], screens: [S_FILTERED],
  description: 'Regression band for the column insertion required by AC1. Adding a column between Status and Actions shifts the Actions column one position right, which is the most likely way existing list behaviour breaks.',
  pre: PRE_BASE,
  steps: [
    NAV, OPEN_LIST,
    ['Read the perks table header row', 'Nine columns are present and the pre-existing headers "Perk ID", "Category", "Type", "Title", "Description", "Status" and "Actions" are all still shown'],
    ['Open the row actions menu of the first listed perk', 'The actions menu opens and offers "View", "Duplicate" and "Delete" in that order'],
    ['Close the row actions menu', 'The actions menu closes and the perks list is still displayed'],
    ...filterTo(C1),
    ['Select "Expired" in the Status filter', '"Expired" is shown as the selected option in the Status filter'],
    ['Click the "Search" button', `The table lists only Expired perks whose Category reads "${C1}"`],
    ['Select "All" in the Status filter', '"All" is shown as the selected option in the Status filter'],
    ['Click the "Search" button', `The table lists perks of every status in "${C1}"`],
    ['Click the "Next" pagination control', 'The next page of results is displayed with the same nine columns in the same order'],
  ],
});

c({
  title: 'Verify opening a perk from the perks list still works after the Featured column is added',
  priority: 'Medium', type: 'Regression', auto: 'Not Automated', acs: ['AC-1'], screens: [S_FILTERED],
  description: 'Regression check that the row now containing an interactive checkbox can still be used to reach the perk details screen, and that clicking the checkbox area does not navigate away.',
  pre: PRE_C1_CLEAN,
  steps: [
    NAV, OPEN_LIST, ...filterTo(C1),
    [`Open the row actions menu of perk ${C1_A}`, 'The actions menu opens and offers "View", "Duplicate" and "Delete"'],
    ['Select "View" from the actions menu', `The perk details screen for ${C1_A} opens and shows the perk's stored values`],
    ['Navigate back to the "Card Perks" list', 'The perks list screen is displayed again'],
    ...filterTo(C1),
    [`Click the Featured checkbox of perk ${C1_A}`, `The Featured checkbox of ${C1_A} becomes checked and the browser stays on the perks list screen`],
  ],
});

c({
  title: 'Verify the filtered empty state still renders when no perk matches the applied filters',
  priority: 'Low', type: 'Regression', auto: 'Not Automated', acs: ['AC-1'], screens: [S_EMPTY],
  description: 'Regression check on the empty state, which the design renders without a table header row — so the new Featured column must not cause a broken or partially rendered table when there are no results.',
  pre: PRE_BASE,
  steps: [
    NAV, OPEN_LIST,
    ['Select a Category and a Type combination that no perk satisfies', 'Both filters show the selected options'],
    ['Click the "Search" button', 'The table returns no rows'],
    ['Read the message displayed in place of the table rows', 'An empty-state message is displayed indicating that no results were found'],
    ['Read the area where the table header row would be', 'The table does not render a partial or broken header, and no orphaned Featured column is displayed'],
    ['Set the Category and Type filters back to "All"', 'Both filters show "All" as the selected option'],
    ['Click the "Search" button', 'The perks list is displayed again with all nine columns'],
  ],
});

c({
  title: 'Verify a duplicated perk defaults to unfeatured regardless of the source perk featured state',
  priority: 'Medium', type: 'Regression', auto: 'Not Automated', acs: ['AC-2'], screens: [S_FILTERED],
  description: 'Retest of B10-57771 AC4, which was closed as Not Verifiable on 2026-08-09 because no featured attribute existed at the time. It becomes verifiable once this story is deployed, so it is carried here as regression coverage of the new default.',
  pre: PRE_C1_FEAT,
  steps: [
    NAV, OPEN_LIST, ...filterTo(C1),
    [`Confirm the Featured checkbox of perk ${C1_A} is checked`, `The Featured checkbox of ${C1_A} is checked`],
    [`Open the row actions menu of perk ${C1_A}`, 'The actions menu opens and offers "View", "Duplicate" and "Delete"'],
    ['Select "Duplicate" from the actions menu', 'The Add Perk form opens pre-filled with the source perk values'],
    ['Enter a coupon code, which the duplicate flow clears and marks as required', 'The coupon code field accepts the value and shows no validation error'],
    ['Save the perk', 'The perk is saved and a new perk record is created with a new perk ID'],
    ...filterTo(C1),
    ['Locate the row for the newly created perk', `The newly created perk is listed alongside ${C1_A}`],
    ['Read the Featured checkbox of the newly created perk', 'The Featured checkbox of the new perk is unchecked'],
    [`Read the Featured checkbox of the source perk ${C1_A}`, `${C1_A} is still the featured perk of the category`],
  ],
});

// ── Emit ──────────────────────────────────────────────────────────────────────
const esc = (v) => {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

const rows = [HEADER];
for (const tc of CASES) {
  const tags = [BASE_TAGS, ...tc.acs.map((a) => `ac:${a}`), ...tc.screens.map((s) => `screen:${s}`)].join(',');
  tc.steps.forEach(([step, expected], i) => {
    rows.push(i === 0
      ? ['', tc.title, '', FOLDER_PATH, 'Active', OWNER, tc.priority, tc.type, tc.auto,
        tc.description, tc.pre, 'Steps', step, expected, ISSUES, tags, '', '', '', '', '', '', PROJECT, '']
      : ['', '', '', '', '', '', '', '', '', '', '', '', step, expected, '', '', '', '', '', '', '', '', '', '']);
  });
}

const out = path.join(__dirname, '..', 'testcases', 'testcases.csv');
fs.writeFileSync(out, rows.map((r) => r.map(esc).join(',')).join('\n') + '\n', 'utf8');

const auto = CASES.filter((c2) => c2.auto !== 'Automation Not Required').length;
const acCount = {};
for (const tc of CASES) for (const a of tc.acs) acCount[a] = (acCount[a] || 0) + 1;
console.log(`wrote ${out}`);
console.log(`cases: ${CASES.length} | step rows: ${rows.length - 1 - CASES.length + CASES.length}`);
console.log(`automatable: ${auto} | manual: ${CASES.length - auto}`);
console.log('AC coverage:', JSON.stringify(acCount));
console.log('by type:', JSON.stringify(CASES.reduce((m, x) => (m[x.type] = (m[x.type] || 0) + 1, m), {})));

module.exports = { CASES, ISSUES, PROJECT, FOLDER_PATH };
