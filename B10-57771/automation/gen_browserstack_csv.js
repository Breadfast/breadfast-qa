'use strict';

/**
 * B10-57771 — BrowserStack Test Management CSV generator (Duplicate Perk Action).
 *
 * Emits the 24-column BrowserStack import shape: the FIRST row of each case carries all
 * metadata plus step 1; every subsequent step is a row with only Steps + Expected Result
 * populated (docs/ai/browserstack-process.md §10.5).
 *
 * Every step/expected pair below was VERIFIED live against card-panel-testing on 2026-08-09
 * (see ../execution-reports/exploratory-notes.md) — no invented UI copy.
 *
 * Run: node gen_browserstack_csv.js
 * Out: ../testcases/B10-57771_browserstack_testcases.csv
 */

const fs = require('fs');
const path = require('path');

const HEADER = ['Test Case ID', 'Title', 'Folder ID', 'Folder Path', 'State', 'Owner', 'Priority',
  'Type of Test Case', 'Automation Status', 'Description', 'Preconditions', 'Template', 'Steps',
  'Expected Result', 'Issues', 'Tags', 'Status (latest)', 'Attachments', 'Created At', 'Created By',
  'Last Updated At', 'Last Updated By', 'Project Name', 'Test Case URL'];

const OWNER = 'Fintech';
const PROJECT = 'B10-57771 Duplicate Perk Action';
const TAGS = 'ai-created';
const ISSUES = 'B10-57771';

// ── Shared fixtures (seeded 2026-08-09 via POST /api/v1/web/card/perks/create) ──────────
const SRC_ACTIVE = 'DC_29';   // active discount-coupon, 4 images, coupon "demo123"
const SRC_PLANNED = 'DC_30';  // planned discount-coupon "QA57771 Planned"
const SRC_EXPIRED = 'DC_31';  // expired discount-coupon "QA57771 Expired"
const SRC_GENERAL = 'GC_63';  // active general-cashback "QA57771 GenCash"
const SRC_MERCHANT = 'MC_74'; // active merchant-cashback "not br merchant"

const PRE_BASE = 'Admin/ops user has valid Breadfast Pay Admin Portal credentials (card-panel-testing) '
  + 'and the create_perk permission. The Duplicate row action is deployed to the environment under test.';
const PRE_FIXTURES = `${PRE_BASE} Seeded source perks exist: ${SRC_ACTIVE} (active discount-coupon with `
  + `logo EN/AR + cover EN/AR and coupon code "demo123"), ${SRC_PLANNED} (planned), ${SRC_EXPIRED} `
  + `(expired), ${SRC_GENERAL} (general-cashback), ${SRC_MERCHANT} (merchant-cashback).`;

// ── Reusable step atoms ────────────────────────────────────────────────────────────────
const LOGIN = ['Log in to the Breadfast Pay Admin Portal with a user that has perk-creation permission.',
  'The user is authenticated and the Admin Portal dashboard is displayed.'];
const GOTO_PERKS = ['Navigate to Card perks > Perks.',
  'The Card perks list is displayed with the columns Perk ID, Category, Type, Title, Description, Status and Actions.'];
const openMenu = (id) => [`Click the "..." (kebab) actions button on the row for perk "${id}".`,
  'The row actions menu opens as an overlay panel anchored to the kebab button.'];
const openDuplicate = (id) => [`Select "Duplicate" from the "${id}" row actions menu.`,
  `The application navigates to #/perks/duplicate/${id} and the full "Create perk" form is displayed, pre-filled from the source perk.`];
const SAVE_CLICK = ['Click the "Preview & save" button at the bottom of the form.',
  'The perk preview dialog opens showing the perk as it will appear, with "Save" and "Cancel" actions.'];
const SAVE_CONFIRM = ['Click "Save" in the preview dialog.',
  'The dialog closes, the perk is created, and the application returns to the Card perks list.'];

const cases = [];

// ══ AC1 — row actions menu ═════════════════════════════════════════════════════════════
cases.push({
  title: 'Verify the perks list row actions menu shows View, Duplicate and Delete in that order',
  priority: 'Critical',
  description: 'AC1 — the "..." row actions menu lists exactly three items in the order View, Duplicate, Delete, with Duplicate inserted between the two pre-existing actions.',
  pre: PRE_FIXTURES,
  steps: [LOGIN, GOTO_PERKS, openMenu(SRC_ACTIVE),
    ['Read the items listed in the opened actions menu, top to bottom.',
      'The menu contains exactly three items in this order: "View", "Duplicate", "Delete".'],
    ['Observe the icon rendered against the "Duplicate" item.',
      'The "Duplicate" item is rendered with a copy icon and is enabled (not greyed out).'],
  ],
});

cases.push({
  title: 'Verify Duplicate is offered for perks in every lifecycle state (active, planned, expired)',
  priority: 'High',
  description: 'The Duplicate action is not state-gated: it is present and enabled for active, planned and expired source perks alike.',
  pre: PRE_FIXTURES,
  steps: [LOGIN, GOTO_PERKS, openMenu(SRC_ACTIVE),
    [`Confirm the state of the "Duplicate" item for the active perk "${SRC_ACTIVE}".`,
      'The "Duplicate" item is present and enabled.'],
    ['Close the menu and open the actions menu on the row for the planned perk "' + SRC_PLANNED + '".',
      'The menu closes and reopens against the planned perk row.'],
    [`Confirm the state of the "Duplicate" item for the planned perk "${SRC_PLANNED}".`,
      'The "Duplicate" item is present and enabled.'],
    ['Close the menu and open the actions menu on the row for the expired perk "' + SRC_EXPIRED + '".',
      'The menu closes and reopens against the expired perk row.'],
    [`Confirm the state of the "Duplicate" item for the expired perk "${SRC_EXPIRED}".`,
      'The "Duplicate" item is present and enabled.'],
  ],
});

cases.push({
  title: 'Verify the Delete row action remains enabled only for planned perks after Duplicate is added',
  priority: 'High',
  description: 'Regression — adding Duplicate to the actions menu must not change Delete, which stays enabled only for perks in the Planned state.',
  pre: PRE_FIXTURES,
  steps: [LOGIN, GOTO_PERKS, openMenu(SRC_ACTIVE),
    [`Observe the "Delete" item for the active perk "${SRC_ACTIVE}".`,
      'The "Delete" item is displayed but disabled (greyed out and not clickable).'],
    ['Hover over the disabled "Delete" item.',
      'A tooltip is displayed reading "Only planned perks can be deleted".'],
    ['Close the menu and open the actions menu on the row for the planned perk "' + SRC_PLANNED + '".',
      'The menu reopens against the planned perk row.'],
    [`Observe the "Delete" item for the planned perk "${SRC_PLANNED}".`,
      'The "Delete" item is enabled and clickable.'],
    ['Close the menu and open the actions menu on the row for the expired perk "' + SRC_EXPIRED + '".',
      'The menu reopens against the expired perk row.'],
    [`Observe the "Delete" item for the expired perk "${SRC_EXPIRED}".`,
      'The "Delete" item is displayed but disabled.'],
  ],
});

cases.push({
  title: 'Verify the View row action still opens the perk details page after Duplicate is added',
  priority: 'Medium',
  description: 'Regression — the pre-existing View action is unaffected by the new sibling menu item.',
  pre: PRE_FIXTURES,
  steps: [LOGIN, GOTO_PERKS, openMenu(SRC_ACTIVE),
    ['Select "View" from the row actions menu.',
      `The application navigates to the perk details page for "${SRC_ACTIVE}" and the perk's saved values are displayed in read-only form.`],
    ['Read the perk identifier shown on the details page.',
      `The details page shows the source perk "${SRC_ACTIVE}" — not a duplicate and not a blank form.`],
  ],
});

// ══ AC2 — the pre-filled form ══════════════════════════════════════════════════════════
cases.push({
  title: 'Verify selecting Duplicate opens the full Create perk form rather than creating a perk immediately',
  priority: 'Critical',
  description: 'AC2 — Duplicate is not a one-click action: it opens the complete Create perk form at #/perks/duplicate/<sourceId> and requires an explicit save.',
  pre: PRE_FIXTURES,
  steps: [LOGIN, GOTO_PERKS, openMenu(SRC_ACTIVE), openDuplicate(SRC_ACTIVE),
    ['Read the page heading and the browser URL.',
      `The heading reads "Create perk" and the URL is #/perks/duplicate/${SRC_ACTIVE}.`],
    ['Observe the form sections rendered on the page.',
      'The complete Create perk form is rendered, including the Value, Usage, Branches, Cashback processing, Duration and Funding sections — not a blank form and not an inline dialog.'],
    ['Return to the Card perks list without saving and count the rows.',
      'No new perk has been created; the list is unchanged from before Duplicate was selected.'],
  ],
});

cases.push({
  title: 'Verify the duplicated form pre-fills the source perk text fields verbatim in English and Arabic',
  priority: 'Critical',
  description: 'AC2 — title, descriptions and all supporting description fields are pre-filled with the source perk\'s values, in both EN and AR, without modification or a "(copy)" suffix.',
  pre: PRE_FIXTURES,
  steps: [LOGIN, GOTO_PERKS, openMenu(SRC_ACTIVE), openDuplicate(SRC_ACTIVE),
    ['Read the "Title EN" and "Title AR" fields.',
      'Both fields are pre-filled with the source perk\'s titles verbatim — no "(copy)" suffix and no blank field.'],
    ['Read the "Description EN" and "Description AR" fields.',
      'Both are pre-filled with the source perk\'s description text verbatim.'],
    ['Read the Usage, Branches and Duration description fields in both languages.',
      'Each field is pre-filled with the corresponding source value; fields that are empty on the source remain empty.'],
  ],
});

cases.push({
  title: 'Verify the duplicated form pre-fills the source perk type, section, merchant and funding type',
  priority: 'Critical',
  description: 'AC2 — the non-text selections (perk type, mobile section, merchant reference and funding type) carry over to the duplicate.',
  pre: PRE_FIXTURES,
  steps: [LOGIN, GOTO_PERKS, openMenu(SRC_ACTIVE), openDuplicate(SRC_ACTIVE),
    ['Read the "Perk type" dropdown.',
      'The perk type matches the source perk\'s type and the matching type-conditional sections are rendered.'],
    ['Read the "Section (Mobile display)" dropdown.',
      'The section matches the source perk\'s section, shown as its bilingual "EN - AR" label.'],
    ['Read the merchant selection field.',
      'The merchant matches the source perk\'s merchant, carried over by reference.'],
    ['Read the "Funding" section\'s funding type dropdown.',
      'The funding type matches the source perk\'s funding type.'],
  ],
});

cases.push({
  title: 'Verify the duplicated form pre-fills all four source perk images',
  priority: 'High',
  description: 'AC2 — logo EN, logo AR, cover photo EN and cover photo AR are all displayed pre-filled on the duplicated form.',
  pre: PRE_FIXTURES,
  steps: [LOGIN, GOTO_PERKS, openMenu(SRC_ACTIVE), openDuplicate(SRC_ACTIVE),
    ['Locate the image slots on the pre-filled form.',
      'Four image previews are rendered — logo EN, logo AR, cover photo EN and cover photo AR — each showing the source perk\'s image rather than an empty "Add Image" placeholder.'],
    ['Confirm each preview renders an actual image and not a broken-image icon.',
      'All four previews render their image successfully.'],
    ['Confirm no "Could not fetch ... from storage" error message is displayed.',
      'No image-retrieval error notification is shown.'],
  ],
});

cases.push({
  title: 'Verify the duplicated form copies the source perk validity date range',
  priority: 'High',
  description: 'The start and end dates are carried over from the source perk and rendered in the form\'s display format, rather than being cleared for re-entry.',
  pre: PRE_FIXTURES,
  steps: [LOGIN, GOTO_PERKS,
    [`Open the source perk "${SRC_ACTIVE}" via View and note its start and end dates.`,
      'The source perk\'s validity start and end date-times are recorded.'],
    ['Return to the Card perks list.', 'The Card perks list is displayed.'],
    openMenu(SRC_ACTIVE), openDuplicate(SRC_ACTIVE),
    ['Read the start date and end date fields in the Duration section.',
      'Both fields are pre-filled with the source perk\'s start and end date-times, formatted as DD-MM-YYYY HH:mm:ss.'],
  ],
});

cases.push({
  title: 'Verify the coupon code is cleared on the duplicated form and enforced as required before saving',
  priority: 'Critical',
  description: 'For a discount/coupon source perk the coupon code is NOT carried over: the field arrives empty and becomes required, so the source and duplicate cannot share a redemption code.',
  pre: PRE_FIXTURES,
  steps: [LOGIN, GOTO_PERKS, openMenu(SRC_ACTIVE), openDuplicate(SRC_ACTIVE),
    ['Read the coupon code field (placeholder "e.g HM123").',
      `The coupon code field is empty — the source perk's code ("demo123") has NOT been copied.`],
    ['Click "Preview & save" leaving the coupon code empty.',
      'Saving is blocked: the preview dialog does not open and the page remains on #/perks/duplicate/' + SRC_ACTIVE + '.'],
    ['Read the validation message shown against the coupon code field.',
      'The field is flagged invalid and displays "This field is required.".'],
    ['Enter a new, unused coupon code into the field.',
      'The validation error clears and the field accepts the new code.'],
    SAVE_CLICK,
  ],
});

// ── Type-conditional pre-fill ──────────────────────────────────────────────────────────
[['discount/coupon', SRC_ACTIVE, 'the coupon code (cleared), coupon type, and the Usage, Branches and Duration description sections'],
 ['merchant cashback', SRC_MERCHANT, 'the merchant reference, cashback value and cashback value type'],
 ['general spend cashback', SRC_GENERAL, 'the cashback value, cashback value type, minimum transaction amount and the excluded merchants / excluded categories selections'],
].forEach(([label, id, expected]) => cases.push({
  title: `Verify the type-conditional sections pre-fill correctly when duplicating a "${label}" perk`,
  priority: 'High',
  description: `AC2 — duplicating a "${label}" perk renders that type's conditional sections and pre-fills them from the source.`,
  pre: PRE_FIXTURES,
  steps: [LOGIN, GOTO_PERKS, openMenu(id), openDuplicate(id),
    ['Read the "Perk type" dropdown on the pre-filled form.',
      `The perk type is set to "${label}" — matching the source perk.`],
    [`Locate the sections specific to the "${label}" perk type.`,
      `The type-conditional sections for "${label}" are rendered — they are not missing and not replaced by another type's sections.`],
    ['Read the values in those type-conditional fields.',
      `The fields are pre-filled from the source perk: ${expected}.`],
  ],
}));

// ══ AC3 — independence ═════════════════════════════════════════════════════════════════
cases.push({
  title: 'Verify saving a duplicated perk creates a new record with a new unique perk ID',
  priority: 'Critical',
  description: 'AC3 — the duplicate is saved as a new, independent record with its own perk ID; it does not overwrite the source.',
  pre: PRE_FIXTURES,
  steps: [LOGIN, GOTO_PERKS, openMenu(SRC_ACTIVE), openDuplicate(SRC_ACTIVE),
    ['Change the Title EN to a unique QA value and enter a new, unused coupon code.',
      'Both fields accept the new values and no validation errors are shown.'],
    SAVE_CLICK, SAVE_CONFIRM,
    ['Locate the newly created perk in the Card perks list and read its Perk ID.',
      `A new row exists with the unique QA title and a Perk ID that differs from the source's "${SRC_ACTIVE}".`],
    [`Confirm the source perk "${SRC_ACTIVE}" is still present in the list.`,
      'Both the source perk and the new duplicate are listed as separate rows.'],
  ],
});

cases.push({
  title: 'Verify the source perk is left completely unchanged after its duplicate is saved',
  priority: 'Critical',
  description: 'AC3 — saving the duplicate must not write back to, or link to, the source perk.',
  pre: PRE_FIXTURES,
  steps: [LOGIN, GOTO_PERKS,
    [`Open the source perk "${SRC_ACTIVE}" via View and record every displayed field value.`,
      'The source perk\'s current field values are recorded as the baseline.'],
    ['Return to the list, duplicate the same perk, set a unique title and a new coupon code, then save it.',
      'The duplicate is created and the application returns to the Card perks list.'],
    [`Open the source perk "${SRC_ACTIVE}" via View again and compare every field against the baseline.`,
      'Every field on the source perk is identical to the recorded baseline — title, dates, images, coupon code and all descriptions are unchanged.'],
    ['Confirm the source perk still shows its own original coupon code.',
      'The source perk retains the coupon code "demo123"; it was not cleared or overwritten by the duplicate flow.'],
  ],
});

cases.push({
  title: 'Verify the duplicated perk is stored with its own image assets, not references to the source images',
  priority: 'Critical',
  description: 'AC3 — image independence: the duplicate\'s stored image URLs differ from the source\'s and resolve to real, separately stored assets.',
  pre: PRE_FIXTURES,
  steps: [LOGIN, GOTO_PERKS, openMenu(SRC_ACTIVE), openDuplicate(SRC_ACTIVE),
    ['Set a unique title and a new coupon code, then save the duplicate.',
      'The duplicate is created and the application returns to the Card perks list.'],
    ['Retrieve the stored logo and cover photo URLs for both the source perk and the new duplicate.',
      'Both perks expose their own logo and cover photo URLs.'],
    ['Compare the duplicate\'s logo and cover photo URLs against the source perk\'s.',
      'The duplicate\'s image URLs are different from the source\'s — each duplicate image has its own media identifier.'],
    ['Open the duplicate\'s logo and cover photo URLs directly.',
      'Both URLs return the image successfully (HTTP 200) and show the same picture as the source.'],
  ],
});

cases.push({
  title: 'Verify the duplicated perk images survive deletion of the source perk',
  priority: 'High',
  description: 'AC3 — proves the duplicate holds independent assets rather than shared references: deleting the source must not break the duplicate\'s images.',
  pre: `${PRE_FIXTURES} This case requires a PLANNED source perk, because Delete is only enabled for perks in the Planned state.`,
  steps: [LOGIN, GOTO_PERKS, openMenu(SRC_PLANNED), openDuplicate(SRC_PLANNED),
    ['Set a unique title and a new coupon code, then save the duplicate.',
      'The duplicate is created and the application returns to the Card perks list.'],
    ['Record the duplicate\'s image URLs, then open the actions menu on the planned source perk row and select "Delete".',
      'A delete confirmation dialog is displayed asking "Are you sure you want to delete this perk?".'],
    ['Confirm the deletion.',
      'The message "Perk deleted successfully" is shown and the source perk is removed from the Card perks list.'],
    ['Open the duplicate perk and inspect its images.',
      'The duplicate perk is still present and all of its images still render; none is broken by the source deletion.'],
  ],
});

cases.push({
  title: 'Verify the duplicated perk field values match the source perk when read back from the perks API',
  priority: 'High',
  description: 'AC2/AC3 — pre-fill fidelity is confirmed at the data layer, not only in the form: the saved duplicate carries the source\'s values for every copied field.',
  pre: PRE_FIXTURES,
  steps: [LOGIN, GOTO_PERKS, openMenu(SRC_ACTIVE), openDuplicate(SRC_ACTIVE),
    ['Set a unique title and a new coupon code, then save the duplicate.',
      'The duplicate is created and the application returns to the Card perks list.'],
    ['Retrieve the stored record for both the source perk and the new duplicate.',
      'Both records are returned successfully.'],
    ['Compare the copied fields — Arabic title, descriptions, type, section, merchant, funding type, start date and end date.',
      'Every copied field on the duplicate is equal to the source perk\'s value.'],
    ['Compare the fields that must NOT be shared — perk ID, coupon code and image identifiers.',
      'The duplicate has its own perk ID, its own coupon code and its own image identifiers.'],
  ],
});

// ══ Validation and cancellation ════════════════════════════════════════════════════════
cases.push({
  title: 'Verify the duplicated form applies the standard Add Perk validation when a required field is cleared',
  priority: 'High',
  description: 'The pre-filled form is subject to the same validation as a normal Add Perk; clearing a required field blocks the save with the standard message.',
  pre: PRE_FIXTURES,
  steps: [LOGIN, GOTO_PERKS, openMenu(SRC_ACTIVE), openDuplicate(SRC_ACTIVE),
    ['Clear the pre-filled "Title EN" field.',
      'The Title EN field is left empty.'],
    ['Click "Preview & save".',
      'Saving is blocked: the preview dialog does not open and the page remains on the duplicate form.'],
    ['Read the validation message shown against the Title EN field.',
      'The field is flagged invalid and displays "This field is required.".'],
    ['Restore a valid title and enter a new coupon code, then click "Preview & save".',
      'The validation errors clear and the perk preview dialog opens.'],
  ],
});

cases.push({
  title: 'Verify leaving the pre-filled duplicate form without saving creates no perk record',
  priority: 'High',
  description: 'Opening Duplicate and navigating away must not create a draft, an orphan record or a partial perk.',
  pre: PRE_FIXTURES,
  steps: [LOGIN, GOTO_PERKS,
    ['Record the total number of perks currently listed.',
      'The current perk count is recorded as the baseline.'],
    openMenu(SRC_ACTIVE), openDuplicate(SRC_ACTIVE),
    ['Navigate back to the Card perks list without clicking "Preview & save".',
      'The Card perks list is displayed again.'],
    ['Count the perks in the list and compare against the baseline.',
      'The perk count is unchanged — no new perk, draft or orphan record was created.'],
    ['Confirm no perk carrying the source perk\'s title has been added.',
      'Only the original source perk exists; no duplicate row was created.'],
  ],
});

cases.push({
  title: 'Verify the preview dialog Cancel action abandons the duplicate without creating a perk',
  priority: 'Medium',
  description: 'The second step of the two-step save can be cancelled, leaving no record behind.',
  pre: PRE_FIXTURES,
  steps: [LOGIN, GOTO_PERKS,
    ['Record the total number of perks currently listed.',
      'The current perk count is recorded as the baseline.'],
    openMenu(SRC_ACTIVE), openDuplicate(SRC_ACTIVE),
    ['Set a unique title and a new coupon code, then click "Preview & save".',
      'The perk preview dialog opens showing "Save" and "Cancel".'],
    ['Click "Cancel" in the preview dialog.',
      'The dialog closes and the user is returned to the pre-filled duplicate form with the entered values intact.'],
    ['Navigate to the Card perks list and compare the perk count against the baseline.',
      'The perk count is unchanged — cancelling the preview created no perk.'],
  ],
});

// ══ Regression ═════════════════════════════════════════════════════════════════════════
cases.push({
  title: 'Verify the Add Perk create-from-scratch flow is unaffected after a duplicate is opened',
  priority: 'Critical',
  description: 'Regression — Duplicate reuses the Create perk component and mutates the coupon code validator at runtime; the normal Add Perk flow must still start blank with its own validation rules.',
  pre: PRE_FIXTURES,
  steps: [LOGIN, GOTO_PERKS, openMenu(SRC_ACTIVE), openDuplicate(SRC_ACTIVE),
    ['Navigate back to the Card perks list without saving, then click the "Add perk" button.',
      'The "Create perk" page opens at #/perks/create.'],
    ['Observe the form immediately after it opens.',
      'The form is blank and progressive — only the "Perk type" field is rendered, with no values carried over from the duplicated perk.'],
    ['Select a perk type and inspect every field in the form.',
      'All fields are empty; none is pre-filled with the previously duplicated perk\'s values.'],
    ['Complete the form with valid new values and save it.',
      'A new perk is created normally from scratch, with no interference from the duplicate flow.'],
  ],
});

cases.push({
  title: 'Verify the perks list renders correctly after a duplicate has been created',
  priority: 'Medium',
  description: 'Regression — the newly inserted duplicate must not break list rendering, row ordering or the row actions on neighbouring perks.',
  pre: PRE_FIXTURES,
  steps: [LOGIN, GOTO_PERKS, openMenu(SRC_ACTIVE), openDuplicate(SRC_ACTIVE),
    ['Set a unique title and a new coupon code, then save the duplicate.',
      'The duplicate is created and the application returns to the Card perks list.'],
    ['Inspect the perks list rendering.',
      'The list renders correctly: every row shows its Perk ID, Category, Type, Title, Description and Status, with no blank or broken rows.'],
    ['Locate the newly created duplicate row and read its Status.',
      'The duplicate is listed with a valid status derived from its copied validity dates.'],
    ['Open the row actions menu on the newly created duplicate.',
      'The menu opens showing View, Duplicate and Delete — the duplicate can itself be duplicated.'],
  ],
});

// ══════════════════════════════════════════════════════════════════════════════════════
// CSV emit
// ══════════════════════════════════════════════════════════════════════════════════════
const esc = (v) => {
  const s = String(v == null ? '' : v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function toCsv() {
  const rows = [HEADER];
  cases.forEach((c, i) => {
    const id = `TC-${String(i + 1).padStart(3, '0')}`;
    c.steps.forEach(([step, result], si) => {
      if (si === 0) {
        rows.push([id, c.title, '', PROJECT, 'Active', OWNER, c.priority, 'Functional', 'Not Automated',
          c.description, c.pre, 'Test Case Steps', step, result, ISSUES, TAGS, '', '', '', '', '', '', PROJECT, '']);
      } else {
        rows.push(['', '', '', '', '', '', '', '', '', '', '', '', step, result, '', '', '', '', '', '', '', '', '', '']);
      }
    });
  });
  return rows.map((r) => r.map(esc).join(',')).join('\r\n');
}

if (require.main === module) {
  const out = path.join(__dirname, '..', 'testcases', 'B10-57771_browserstack_testcases.csv');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, toCsv(), 'utf8');
  const steps = cases.reduce((n, c) => n + c.steps.length, 0);
  console.log(`${cases.length} cases · ${steps} steps → ${out}`);
  cases.forEach((c, i) => console.log(`  TC-${String(i + 1).padStart(3, '0')} [${c.priority}] ${c.title}`));
}

module.exports = { cases, ISSUES, PROJECT };
