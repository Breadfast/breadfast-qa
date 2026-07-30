'use strict';

/**
 * B10-56750 — BrowserStack Test Management CSV generator (**v2**, HLS v2).
 *
 * Emits the 24-column BrowserStack import shape: the FIRST row of each case
 * carries all metadata plus step 1; every subsequent step is a row with only
 * Steps + Expected Result populated (the shape the approved BCard Squad import
 * uses — see docs/ai/browserstack-process.md §10.5).
 *
 * Run: node gen_browserstack_csv.js
 * Out: ../testcases/B10-56750_browserstack_testcases.csv
 */

const fs = require('fs');
const path = require('path');

const HEADER = ['Test Case ID', 'Title', 'Folder ID', 'Folder Path', 'State', 'Owner', 'Priority',
  'Type of Test Case', 'Automation Status', 'Description', 'Preconditions', 'Template', 'Steps',
  'Expected Result', 'Issues', 'Tags', 'Status (latest)', 'Attachments', 'Created At', 'Created By',
  'Last Updated At', 'Last Updated By', 'Project Name', 'Test Case URL'];

const OWNER = 'Fintech';
const PROJECT = 'BCard Squad';
const TAGS = 'ai-created';
const ISSUES = 'B10-56750';

const LOGIN = ['Log in to the Breadfast Pay Admin Portal with a user that has perk-creation permission.',
  'The user is authenticated and the Admin Portal dashboard is displayed.'];
const GOTO_CREATE = ['Navigate to Card Perks and click "Add perk".',
  'The "Create perk" page opens showing the "Basic details" section with only the "Perk type" field rendered.'];
const pickType = (t) => [`Select "${t}" from the "Perk type" dropdown.`,
  `The perk type is set to "${t}" and the remainder of the Basic details form renders, including the "Section (Mobile display)" field.`];
const OPEN_MODAL = ['Click the "+ Add section" option pinned at the bottom of the Section dropdown list.',
  'The "Add section" modal opens as an overlay above a dimmed page, showing the "Section name EN" and "Section name AR" fields and the "Add section" / "Cancel" CTAs.'];
const OPEN_SECTION_DD = ['Click the "Section (Mobile display)" dropdown.',
  'The dropdown panel expands and lists the existing Sections, with "+ Add section" pinned as the last row.'];

const PRE_BASE = 'Admin/ops user has valid Breadfast Pay Admin Portal credentials and perk-creation permission. The Section field and inline "Add section" flow are deployed to the environment under test (card-panel-testing, panel Version 2.4.5). NOTE: the Create perk form is progressive — the Section field does not exist until a Perk type is selected.';
const PRE_SECTIONS = `${PRE_BASE} At least the seeded Sections "Breadfast - بريدفاست" and "General Purchases - المشتريات العامة" exist.`;
const PRE_NO_DELETE = `${PRE_BASE} IMPORTANT test-data constraint: there is NO delete-Section flow, so any Section created by this case is permanent and customer-visible — use a unique, clearly-marked QA name.`;

const TYPES = ['Discount/coupon', 'Category cashback', 'Merchant cashback', 'General spend cashback'];
const cases = [];

// ── AC-01 · TC1–TC4 — field present per perk type ───────────────────────────
TYPES.forEach((t) => cases.push({
  title: `Verify the Section field is displayed in Create Perk → Basic details for the "${t}" perk type`,
  priority: 'Critical',
  description: `AC-01 — the "Section (Mobile display)" field is displayed on the Create Perk form's Basic details section for the "${t}" perk type, labelled exactly "Section (Mobile display)" with a required marker.`,
  pre: PRE_BASE,
  steps: [LOGIN, GOTO_CREATE, pickType(t),
    ['Locate the "Section (Mobile display)" field within the Basic details section.',
      'The field is present and visible, rendered as a dropdown with the placeholder "Select section".'],
    ['Read the field\'s label text and required marker.',
      'The label reads exactly "Section (Mobile display)" and carries a red asterisk (*) marking it required.'],
  ],
}));

// ── AC-02 · TC5–TC8 — required, blocks Preview & save ───────────────────────
TYPES.forEach((t) => cases.push({
  title: `Verify Section is required and blocks "Preview & save" when empty for the "${t}" perk type`,
  priority: 'Critical',
  description: `AC-02 — "Section" is required. With no Section selected the admin cannot proceed past "Preview & save", and a validation error is shown against the Section field.`,
  pre: PRE_BASE,
  steps: [LOGIN, GOTO_CREATE, pickType(t),
    ['Observe the Section dropdown without interacting with it.',
      'The Section dropdown is empty — no Section is pre-selected on a fresh form.'],
    ['Click the "Preview & save" button without selecting a Section.',
      'Submission is blocked: the page remains on the Create perk form (URL still #/perks/create) and no preview dialog opens.'],
    ['Inspect the Section field for a validation message.',
      'The Section field is flagged invalid and displays the validation error "This field is required." directly beneath it.'],
  ],
}));

// ── AC-03 · TC9–TC11 ────────────────────────────────────────────────────────
cases.push({
  title: 'Verify the Section dropdown lists existing Sections as bilingual "EN - AR" labels',
  priority: 'High',
  description: 'AC-03 — the Section dropdown lists all existing Sections showing their names, rendered as a bilingual "English - Arabic" label.',
  pre: PRE_SECTIONS,
  steps: [LOGIN, GOTO_CREATE, pickType('Discount/coupon'), OPEN_SECTION_DD,
    ['Read the label of each listed Section option.',
      'Each seeded Section renders as "EN - AR", e.g. "Breadfast - بريدفاست" and "General Purchases - المشتريات العامة".'],
    ['Confirm the seeded "Breadfast" Section is listed.',
      'An option reading exactly "Breadfast - بريدفاست" is present in the list.'],
  ],
});
cases.push({
  title: 'Verify the Section dropdown shows names only and never exposes numeric Section IDs',
  priority: 'High',
  description: 'AC-03 (+ clarification B7) — the Section dropdown must show names only. The separate Category dropdown is the control that legitimately renders "ID <n>"; an ID appearing in the Section list means the two controls have been crossed.',
  pre: PRE_SECTIONS,
  steps: [LOGIN, GOTO_CREATE, pickType('Discount/coupon'), OPEN_SECTION_DD,
    ['Inspect every Section option for a numeric identifier such as "ID 33".',
      'No Section option contains a numeric ID — the labels show Section names only.'],
    ['Confirm the dropdown footer wording.',
      'The footer row reads "+ Add section" and never "+ Add category".'],
  ],
});
cases.push({
  title: 'Verify the design-specified seeded Sections "Food & Beverage" and "Fitness" are available',
  priority: 'Medium',
  description: 'AC-03 — the approved design (nodes 5893-394770 …) lists "Food & Beverage - الأكل والشرب" and "Fitness - الرياضة" among the seeded Sections. KNOWN FAILURE on the current environment (finding F-06): neither exists, and 5 of 7 live Sections are throwaway test data.',
  pre: PRE_SECTIONS,
  steps: [LOGIN, GOTO_CREATE, pickType('Discount/coupon'), OPEN_SECTION_DD,
    ['Look for a Section option reading "Food & Beverage - الأكل والشرب".',
      'The Section "Food & Beverage - الأكل والشرب" is listed.'],
    ['Look for a Section option reading "Fitness - الرياضة".',
      'The Section "Fitness - الرياضة" is listed.'],
  ],
});

// ── AC-03/AC-14 naming ──────────────────────────────────────────────────────
cases.push({
  title: 'Verify the general-spend Section is named "General Purchases" and no bare "General" Section exists',
  priority: 'Critical',
  description: 'AC-03 / AC-14 with clarification B5 (QA-lead override) — "General Purchases" is the correct Section name and the design showing "General - عام" is STALE. A rendered bare "General" is a defect. The build supplies the Arabic name the PO never provided: "المشتريات العامة".',
  pre: PRE_SECTIONS,
  steps: [LOGIN, GOTO_CREATE, pickType('General spend cashback'), OPEN_SECTION_DD,
    ['Look for a Section option beginning "General Purchases".',
      'An option reading "General Purchases - المشتريات العامة" is listed.'],
    ['Confirm no Section is named simply "General".',
      'No option reading "General - عام" (or any bare "General") exists — the design\'s value is stale and must not appear in the build.'],
  ],
});

// ── AC-04 ───────────────────────────────────────────────────────────────────
cases.push({
  title: 'Verify "+ Add section" is pinned at the bottom of the Section dropdown for all four perk types',
  priority: 'High',
  description: 'AC-04 — the Section dropdown includes a "+ Add section" option pinned at the bottom of the list, always visible regardless of how many Sections exist, for every perk type.',
  pre: PRE_SECTIONS,
  steps: [LOGIN, GOTO_CREATE, pickType('Discount/coupon'), OPEN_SECTION_DD,
    ['Confirm the position and exact wording of the last row.',
      'The final row of the list reads exactly "+ Add section" and is pinned below every Section option.'],
    ['Scroll the dropdown list to its end.',
      '"+ Add section" remains visible as the last row and is not scrolled out of reach.'],
    ['Repeat the check for the "Category cashback", "Merchant cashback" and "General spend cashback" perk types.',
      'For every perk type the "+ Add section" row is present, pinned last, and reads "+ Add section".'],
  ],
});

// ── AC-05 · modal structure + AR required ───────────────────────────────────
cases.push({
  title: 'Verify the "Add section" modal structure, title, field labels and required markers',
  priority: 'Critical',
  description: 'AC-05 — clicking "+ Add section" opens a modal titled "Add section" (sentence case per clarification B4) over a dimmed page, with the "Section name EN" and "Section name AR" fields. KNOWN FAILURES on the current build: neither field shows a required marker (F-04) and the placeholders differ from the design (F-05).',
  pre: PRE_SECTIONS,
  steps: [LOGIN, GOTO_CREATE, pickType('Discount/coupon'), OPEN_SECTION_DD, OPEN_MODAL,
    ['Read the modal title.',
      'The title reads exactly "Add section" in sentence case.'],
    ['Confirm the page behind the modal is dimmed.',
      'The underlying page is covered by a dimmed overlay backdrop and is not interactive.'],
    ['Read both field labels and their required markers.',
      'Both fields are labelled "Section name EN" and "Section name AR", and BOTH carry a red asterisk (*) marking them required.'],
    ['Read the placeholder text in each field.',
      'The English field shows the design placeholder "e.g Fitness" and the Arabic field shows "اسم التصنيف".'],
  ],
});
cases.push({
  title: 'Verify the Arabic Section name is enforced as required and an English-only submit is blocked',
  priority: 'Critical',
  description: 'AC-05 — the design marks BOTH name fields required, while AC-05\'s text marks only English as required. Clarification B2 rules the design wins; live behaviour confirms it. AC-05\'s wording is therefore STALE and needs correcting.',
  pre: PRE_NO_DELETE,
  steps: [LOGIN, GOTO_CREATE, pickType('Discount/coupon'), OPEN_SECTION_DD, OPEN_MODAL,
    ['Click "Add section" with both fields left empty.',
      'The modal stays open and "This field is required." is shown for BOTH the EN and the AR field. No create request is sent.'],
    ['Enter a unique English name only (e.g. "QA EnOnly 123456"), leave Arabic empty, and click "Add section".',
      'Submission is blocked: the modal stays open, "This field is required." is shown against the Arabic field, and no Section is created.'],
    ['Clear English, enter an Arabic name only, and click "Add section".',
      'Submission is blocked: the modal stays open, the required error is shown against the English field, and no Section is created.'],
  ],
});

// ── AC-06 ───────────────────────────────────────────────────────────────────
cases.push({
  title: 'Verify the "Add section" modal exposes exactly two CTAs and Cancel saves nothing',
  priority: 'High',
  description: 'AC-06 — the modal has two CTAs: "Add section" (primary, filled) and "Cancel" (secondary text link, closes without saving).',
  pre: PRE_SECTIONS,
  steps: [LOGIN, GOTO_CREATE, pickType('Discount/coupon'), OPEN_SECTION_DD,
    ['Note the current list of Section options, then open the "Add section" modal.',
      'The existing Section list is recorded and the modal opens.'],
    ['Inspect the modal\'s action buttons.',
      'Exactly two CTAs are present: "Add section" rendered as the filled primary button and "Cancel" rendered as a secondary text link.'],
    ['Enter a unique English and Arabic name, then click "Cancel".',
      'The modal closes immediately without any create request being sent.'],
    ['Reopen the Section dropdown and compare the option list with the recorded one.',
      'The Section list is unchanged and the cancelled name does not appear — Cancel created nothing.'],
  ],
});

// ── AC-07 ───────────────────────────────────────────────────────────────────
cases.push({
  title: 'Verify the in-flight loading state of the "Add section" button and that a double-click cannot create two Sections',
  priority: 'High',
  description: 'AC-07 — while the create call is in-flight the "Add section" button shows a spinner and is non-interactive. Extended per HLS 9: a rapid double-click must not create two Sections server-side, and "Cancel" remains enabled (assumption D).',
  pre: PRE_NO_DELETE,
  steps: [LOGIN, GOTO_CREATE, pickType('Discount/coupon'), OPEN_SECTION_DD, OPEN_MODAL,
    ['Enter a unique English and Arabic Section name.',
      'Both fields accept the input and no validation error is shown.'],
    ['Click "Add section" and observe the button during the request (the window is short, ~400 ms — watch closely or sample repeatedly).',
      'The "Add section" button renders a loading spinner and becomes disabled/non-interactive for the duration of the request.'],
    ['Attempt a second click on the "Add section" button while the spinner is showing.',
      'The second click has no effect — the button is non-interactive and only one create request is issued.'],
    ['Wait for the request to complete, then verify how many Sections were created with that name.',
      'Exactly one Section was created; no duplicate row exists.'],
  ],
});

// ── AC-08 ───────────────────────────────────────────────────────────────────
cases.push({
  title: 'Verify successful Section creation closes the modal, shows the success toast, and auto-selects the new Section',
  priority: 'Critical',
  description: 'AC-08 — on success the modal closes, a green "Section created successfully" toast appears, and the newly created Section is auto-selected in the Section dropdown. NOTE: the toast auto-dismisses quickly — check immediately, and keep the page header in view.',
  pre: PRE_NO_DELETE,
  steps: [LOGIN, GOTO_CREATE, pickType('Discount/coupon'), OPEN_SECTION_DD, OPEN_MODAL,
    ['Enter a unique English name and a unique Arabic name, then click "Add section".',
      'The create request succeeds (HTTP 200).'],
    ['Observe the modal immediately after submission.',
      'The modal closes automatically.'],
    ['Observe the page header area immediately after the modal closes.',
      'A green success toast with a tick icon appears reading exactly "Section created successfully".'],
    ['Read the value now shown in the "Section (Mobile display)" dropdown.',
      'The newly created Section is auto-selected, displayed as its bilingual "EN - AR" label.'],
  ],
});

// ── AC-09 · TC18/TC19 ───────────────────────────────────────────────────────
cases.push({
  title: 'Verify a duplicate Section name shows the inline error, keeps the modal open, and preserves the entered values',
  priority: 'Critical',
  description: 'AC-09 — a duplicate name shows the inline error "This section already exists." and the modal remains open. KNOWN FAILURE (finding F-03): the AC also requires the Section-name field to be "highlighted in red"; the build renders only the shared message and leaves both fields visually unchanged (aria-invalid stays false).',
  pre: PRE_SECTIONS,
  steps: [LOGIN, GOTO_CREATE, pickType('Discount/coupon'), OPEN_SECTION_DD,
    ['Note an existing Section\'s exact English and Arabic names, then open the "Add section" modal.',
      'An existing bilingual Section name is recorded (e.g. "Breadfast" / "بريدفاست") and the modal opens.'],
    ['Enter that existing Section\'s English and Arabic names verbatim and click "Add section".',
      'The create request is rejected (HTTP 400) and no new Section is created.'],
    ['Observe the modal and the error message.',
      'The modal remains open and the inline error "This section already exists." is displayed beneath the name fields.'],
    ['Inspect the Section-name fields\' visual state.',
      'The Section-name field is highlighted in red, marking it as the field in error.'],
    ['Confirm the values still in the input fields.',
      'Both the English and Arabic values the admin typed are preserved so they can be corrected without retyping.'],
  ],
});
cases.push({
  title: 'Verify the duplicate-matching rule: EITHER name matches, case-insensitively and trimmed',
  priority: 'Critical',
  description: 'AC-09 with clarification B3 — uniqueness is enforced on EITHER name independently, case-insensitively and trimmed. CRITICAL METHOD NOTE: in every case below the OTHER name must be unique, otherwise a rejection cannot be attributed to the name under test (this was the flaw in the v1 matrix, which varied both names together).',
  pre: PRE_SECTIONS,
  steps: [LOGIN, GOTO_CREATE, pickType('Discount/coupon'), OPEN_SECTION_DD,
    ['Open the modal, enter an EXISTING English name with a UNIQUE Arabic name, and submit.',
      'Rejected with "This section already exists." — proving the English name alone triggers the duplicate check.'],
    ['Cancel, reopen, enter that English name in UPPER CASE with a UNIQUE Arabic name, and submit.',
      'Rejected with "This section already exists." — proving English matching is case-insensitive.'],
    ['Cancel, reopen, enter that English name padded with leading and trailing spaces plus a UNIQUE Arabic name, and submit.',
      'Rejected with "This section already exists." — proving the value is trimmed before matching.'],
    ['Cancel, reopen, enter a UNIQUE English name with an EXISTING Arabic name, and submit.',
      'Rejected with "This section already exists." — proving the Arabic name alone also triggers the duplicate check.'],
    ['Cancel, reopen, enter a unique English AND a unique Arabic name, and submit.',
      'Accepted (HTTP 200) — the control case confirms only genuine collisions are rejected.'],
  ],
});

// ── AC-10 ───────────────────────────────────────────────────────────────────
cases.push({
  title: 'Verify dismissing the "Add section" modal via Cancel and via the X icon clears all inputs without saving',
  priority: 'High',
  description: 'AC-10 — dismissing via Cancel or the X icon clears all inputs and returns focus to the Section dropdown without saving. KNOWN FAILURE (finding F-01): the modal header has NO X close icon — only "Add section" and "Cancel" exist, so half of this AC cannot be exercised as written. The only other dismissal available is the Escape key.',
  pre: PRE_SECTIONS,
  steps: [LOGIN, GOTO_CREATE, pickType('Discount/coupon'), OPEN_SECTION_DD, OPEN_MODAL,
    ['Partially fill the modal (English name only) and click "Cancel".',
      'The modal closes and nothing is saved.'],
    ['Reopen the "Add section" modal and inspect both fields.',
      'Both the English and Arabic fields are empty — the previous input was cleared, not retained.'],
    ['Inspect the modal header for an X close icon.',
      'An X close icon is present in the modal header and dismisses the modal when clicked.'],
    ['Fill both fields, dismiss the modal via the X icon (or Escape if no X exists), then reopen it.',
      'The modal closes without saving and both fields are empty on reopen.'],
    ['Observe where keyboard focus lands after dismissal.',
      'Focus returns to the Section dropdown control.'],
  ],
});

// ── AC-11 ───────────────────────────────────────────────────────────────────
cases.push({
  title: 'Verify a perk is saved with exactly one Section attached',
  priority: 'Critical',
  description: 'AC-11 — the selected Section determines where the perk appears in the Breadfast Pay app, and each perk belongs to exactly one Section. Verified at the create-payload boundary so the attachment is proven, not inferred from the UI. NOTE: the downstream half (Section surfacing in the B10-56757 perks-table Category column) is currently unobservable — the environment has zero perks.',
  pre: PRE_BASE,
  steps: [LOGIN, GOTO_CREATE, pickType('General spend cashback'),
    ['Select the Section "Breadfast - بريدفاست" from the Section dropdown.',
      'The Section dropdown displays "Breadfast - بريدفاست" as the single selected value; the control does not allow a second Section to be chosen.'],
    ['Complete every remaining mandatory field on the form (titles EN/AR, the four images, cashback value, minimum transaction, descriptions, duration and funding type).',
      'All mandatory fields are accepted with no outstanding validation errors.'],
    ['Click "Preview & save" and confirm the save in the Quick Preview dialog.',
      'The perk is submitted and the create request succeeds.'],
    ['Inspect the perk-create request payload for the Section field.',
      'The payload carries exactly one populated Section identifier (a single scalar value, not a list) matching the Section selected.'],
  ],
});

// ── AC-12 ───────────────────────────────────────────────────────────────────
cases.push({
  title: 'Verify a newly created Section is immediately available in a brand-new perk-creation session without a page refresh',
  priority: 'High',
  description: 'AC-12 — newly created Sections are immediately available in the Section dropdown for subsequent perk-creation sessions without a page refresh. Implementation note: the app refetches section/list right after create, so availability is server-driven rather than a client-side cache append.',
  pre: PRE_NO_DELETE,
  steps: [LOGIN, GOTO_CREATE, pickType('Discount/coupon'), OPEN_SECTION_DD, OPEN_MODAL,
    ['Create a Section with a unique English and Arabic name.',
      'The Section is created successfully and auto-selected in the dropdown.'],
    ['Open a brand-new browser session (a separate browser context or profile, cold cache) and log in to the Admin Portal again.',
      'The new session authenticates and reaches the dashboard.'],
    ['In the new session start a new perk, select a perk type, and open the Section dropdown.',
      'The Section dropdown lists the Section created in the first session, with no page refresh performed on the original session.'],
  ],
});

// ── AC-13 ───────────────────────────────────────────────────────────────────
cases.push({
  title: 'Verify Section ordering at the data/API level — Breadfast first, remaining Sections alphabetical [PARTIAL]',
  priority: 'High',
  description: 'AC-13 — the Breadfast section is always first and the rest are ordered alphabetically. PARTIAL COVERAGE per clarification B6: verified at the section/list data level only; on-device Breadfast Pay tab order is deferred to a mobile follow-up. KNOWN FAILURE (finding F-02): the API returns Breadfast first correctly but the remainder in creation/id order, not alphabetically. The admin dropdown\'s own order is NOT in scope and must not be treated as a defect.',
  pre: PRE_SECTIONS,
  steps: [LOGIN, GOTO_CREATE, pickType('Discount/coupon'),
    ['Capture the section/list API response returned when the form loads.',
      'The response returns the full array of Sections in a defined order.'],
    ['Inspect the first entry in the returned array.',
      'The first Section returned is "Breadfast".'],
    ['Compare the remaining entries against the same names sorted alphabetically.',
      'The remaining Sections are returned in alphabetical order.'],
  ],
});

// ── AC-14 ───────────────────────────────────────────────────────────────────
cases.push({
  title: 'Verify the data backfill: existing Breadfast perks assigned to the Breadfast Section and "General cashback 1%" to "General Purchases"',
  priority: 'High',
  description: 'AC-14 — one-time data migration, not UI behaviour. BLOCKED / NOT TESTABLE (finding F-10): the test environment contains ZERO perks ("There are no perks added yet"), so there are no existing perks to have been migrated and no "General cashback 1%" perk to inspect. The target Sections DO exist (Breadfast id=1, General Purchases id=2). Per clarification B8 this is reported "Not Testable — blocked on data", never Pass, until the migration is confirmed and a permitted API/DB read is available.',
  pre: `${PRE_BASE} Requires confirmation from dev/DBA that the AC-14 migration has run on this environment, plus a permitted API or DB read, AND an environment that actually contains the pre-existing perks.`,
  steps: [LOGIN,
    ['Navigate to Card Perks and review the perks list.',
      'The perks list contains the pre-existing Breadfast perks and the "General cashback 1%" perk.'],
    ['Read the Section/Category assigned to each pre-existing Breadfast perk.',
      'Every pre-existing Breadfast perk is assigned to the "Breadfast" Section.'],
    ['Read the Section assigned to the "General cashback 1%" perk.',
      'The "General cashback 1%" perk is assigned to the "General Purchases" Section.'],
  ],
});

// ── Boundary ────────────────────────────────────────────────────────────────
cases.push({
  title: 'Verify Section names are capped at 50 characters with a clear validation message',
  priority: 'Medium',
  description: 'Boundary case — no maximum length is stated in the AC or the design (unlike every sibling field, e.g. Perk title 20 chars). The build enforces 50 characters client-side. Raised as an AC gap: the cap exists but is undocumented and, unlike sibling fields, is not surfaced as a hint next to the label.',
  pre: PRE_SECTIONS,
  steps: [LOGIN, GOTO_CREATE, pickType('Discount/coupon'), OPEN_SECTION_DD, OPEN_MODAL,
    ['Enter an English name longer than 50 characters (e.g. 94 characters) and a similarly long Arabic name.',
      'Both fields accept the typed text — there is no hard input truncation.'],
    ['Click "Add section".',
      'Submission is blocked client-side: the modal stays open, the error "Maximum length should be 50 characters." is shown for each over-long field, and no create request is issued.'],
    ['Reduce both names to 50 characters or fewer and submit.',
      'The Section is created successfully, confirming 50 characters is the accepted boundary.'],
  ],
});

// ── Regression P1 ───────────────────────────────────────────────────────────
cases.push({
  title: 'REGRESSION P1 — verify the Category dropdown and its "+ Add category" flow remain intact and never cross with Section',
  priority: 'Critical',
  description: 'HLS 19 — Section and Category are genuinely separate fields (clarification B7) built from a copy-pasted component, so a change to one can corrupt the other. Category applies to Category-cashback perks; Section applies to all four. Options and footers must never leak between the two lists.',
  pre: `${PRE_BASE} At least one Category and one Section exist.`,
  steps: [LOGIN, GOTO_CREATE, pickType('Category cashback'),
    ['Confirm both the Category and the Section controls are present on this perk type.',
      'The form shows a separate Category dropdown and a separate "Section (Mobile display)" dropdown.'],
    ['Open the Category dropdown and review its options and footer.',
      'Category lists its own options (which legitimately include "ID <n>") and its footer reads "+ Add category". No "+ Add section" row appears.'],
    ['Close it, open the Section dropdown, and review its options and footer.',
      'Section lists Section names only with no numeric IDs, and its footer reads "+ Add section". No "+ Add category" row appears.'],
    ['Compare the two option lists for any shared entries.',
      'No option appears in both lists — there is no bleed of Categories into Sections or vice versa.'],
    ['Use the Category "+ Add category" flow to confirm it still opens its own modal.',
      'The Category creation modal opens and is distinct from the "Add section" modal; the Category flow is unaffected by the Section feature.'],
  ],
});

// ── Regression P2 ───────────────────────────────────────────────────────────
cases.push({
  title: 'REGRESSION P2 — verify a Section created from one perk type is intact and selectable on the other three',
  priority: 'High',
  description: 'HLS 20 — creating a Section from one perk type must not corrupt the Section options offered on the other perk types, and the new Section must be offered consistently across all four. Also covers the rename risk: if "General" is renamed to "General Purchases" the rename must be id-stable so existing perk-to-Section assignments survive rather than being orphaned.',
  pre: PRE_NO_DELETE,
  steps: [LOGIN, GOTO_CREATE, pickType('Merchant cashback'), OPEN_SECTION_DD, OPEN_MODAL,
    ['Create a Section with a unique English and Arabic name from the Merchant cashback form.',
      'The Section is created successfully and auto-selected.'],
    ['Start a new perk, select "Discount/coupon", and open the Section dropdown.',
      'The newly created Section is listed, "+ Add section" is still pinned last, and no numeric IDs appear.'],
    ['Repeat for the "Category cashback" perk type.',
      'The newly created Section is listed and the list remains well-formed for this perk type.'],
    ['Repeat for the "General spend cashback" perk type.',
      'The newly created Section is listed and the list remains well-formed for this perk type.'],
    ['Confirm previously created perks still show their original Section assignment.',
      'Existing perk-to-Section assignments are unchanged — no perk has been orphaned or reassigned.'],
  ],
});

// ── Export for the API uploader AND the specs (single source of truth) ──────
// Required as a module → just hand over the cases. Run directly → write files.
// NOTE: must NOT use a top-level `return` to short-circuit — Playwright transpiles
// spec dependencies through Babel, which rejects "'return' outside of function".
// Wrap the CLI half in emit() instead.
module.exports = { cases, OWNER, PROJECT, TAGS, ISSUES };
if (require.main === module) emit();

// ── Emit ────────────────────────────────────────────────────────────────────
function emit() {
const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
const rows = [HEADER.map(esc).join(',')];

cases.forEach((c) => {
  c.steps.forEach((s, i) => {
    const [step, expected] = s;
    const first = i === 0;
    rows.push([
      '',                                   // Test Case ID
      first ? c.title : '',
      '', '',                               // Folder ID / Folder Path
      first ? 'Active' : '',
      first ? OWNER : '',
      first ? c.priority : '',
      first ? 'Functional' : '',
      first ? 'Not Automated' : '',
      first ? c.description : '',
      first ? c.pre : '',
      first ? 'Steps' : '',
      step,
      expected,
      first ? ISSUES : '',
      first ? TAGS : '',
      '', '', '', '', '', '',
      first ? PROJECT : '',
      '',
    ].map(esc).join(','));
  });
});

const out = path.resolve(__dirname, '../testcases/B10-56750_browserstack_testcases.csv');
fs.writeFileSync(out, rows.join('\n') + '\n', 'utf8');
console.log(`wrote ${out}`);

// ── Markdown execution input, from the SAME case objects (one source of truth) ─
const md = [];
md.push('# Execution Input — B10-56750 (**v2**)', '');
md.push('Manual-execution companion to `B10-56750_browserstack_testcases.csv`. **Generated** from');
md.push('`automation/gen_browserstack_csv.js` — edit the generator, never this file.', '');
md.push('Story: **Admin Portal — Add Section (Selection) to All Perk Types** · Derived from **HLS v2** (2026-07-26)');
md.push('Environment: `https://card-panel-testing.breadfast.tech` (panel v2.4.5) · Scope: **web admin, English UI only**', '');
md.push('> **Read first — the Create perk form is progressive.** Only `Perk type` renders until a type is selected;');
md.push('> the Section field does not exist before then. Every case therefore begins by selecting a perk type.', '');
md.push('> **Test-data warning.** There is no delete-Section flow, so any Section created here is permanent and');
md.push('> customer-visible. Use unique names of the form `QA <purpose> <6-digit stamp>`.', '');
md.push(`**${cases.length} test cases · ${rows.length - 1} steps.**`, '', '---', '');
cases.forEach((c, i) => {
  md.push(`## TC${i + 1} · ${c.title}`, '');
  md.push(`**Priority:** ${c.priority} · **Type:** Functional · **Issue:** ${ISSUES}`, '');
  md.push(`**Description:** ${c.description}`, '');
  md.push(`**Preconditions:** ${c.pre}`, '');
  md.push('| # | Step | Expected Result |', '|---|------|-----------------|');
  c.steps.forEach(([s, e], n) => {
    const clean = (v) => String(v).replace(/\|/g, '\\|');
    md.push(`| ${n + 1} | ${clean(s)} | ${clean(e)} |`);
  });
  md.push('');
});
const mdOut = path.resolve(__dirname, '../testcases/B10-56750_execution_input.md');
fs.writeFileSync(mdOut, md.join('\n'), 'utf8');
console.log(`wrote ${mdOut}`);
console.log(`test cases: ${cases.length}`);
console.log(`total step rows: ${rows.length - 1}`);
cases.forEach((c, i) => console.log(`  TC${i + 1} [${c.priority}] ${c.steps.length} steps — ${c.title.slice(0, 82)}`));
}
