'use strict';

/**
 * B10-57393 — test-case source of truth.
 *
 * One module feeds BOTH the BrowserStack upload (`upload_browserstack.js`) and the CSV
 * (`--csv`), so the two can never drift. Step granularity follows the project standard:
 * one user action per step, every step with its own expected result, navigation and
 * verification as explicit steps (docs/ai/testing-process.md §3.7).
 *
 * Scope reminder: this is a WEB ADMIN story — English admin UI only. The card panel has no
 * Arabic admin UI (prerequisites.md item 10), so HLS-15 (Arabic *admin* UI) has no test case;
 * it is reported Not Applicable. Arabic IS covered as preview *content* via the
 * "Preview language" radio (TC07/TC08/TC14).
 *
 * Usage: node gen_browserstack_csv.js --csv > ../testcases/B10-57393_browserstack_testcases.csv
 */

const ISSUES = 'B10-57393';

const PRE_BASE =
  'Admin user has valid Breadfast Pay Admin Portal credentials (card-panel-testing, panel Version 2.4.5) with ' +
  'perk-creation permission. The "App preview" modal is deployed to the environment under test. ' +
  'NOTE: the Create perk form is PROGRESSIVE — only "Perk type" renders until a type is selected, and ' +
  '"Perk subheader EN/AR" only render after a Section is selected.';

const PRE_VALID_FORM =
  PRE_BASE +
  ' A Merchant-cashback perk form is filled with valid values in every mandatory field: Perk type = ' +
  '"Merchant cashback"; Merchant = a merchant with all branches selected; Section = "Breadfast"; Perk title ' +
  'EN/AR; Perk subheader EN/AR; Value type = Percentage with a cashback percentage, cashback limit and minimum ' +
  'transaction amount; Short perk description EN; Short usage description EN; all four images uploaded ' +
  '(Cover EN/AR at exactly 1080x1080 and <=500KB, Logo EN/AR at exactly 240x180 and <=80KB — other sizes are ' +
  'rejected and silently block Preview & save); Start/End date & time; Funding type.';

const STEP_LOGIN = ['Log in to the Breadfast Pay Admin Portal with a user that has perk-creation permission.',
  'The user is authenticated and the Admin Portal dashboard is displayed.'];
const STEP_NAV = ['Click "Card Perks" in the left navigation, then click "Add perk".',
  'The "Create perk" page opens showing the "Basic details" section with only the "Perk type" field rendered.'];
const STEP_FILL = ['Fill every mandatory field of the Create perk form with valid data for a "Merchant cashback" perk (see Preconditions), including all four images.',
  'All mandatory fields accept the values and no field-level validation error is displayed.'];
const STEP_OPEN = ['Click the "Preview & save" button at the bottom of the form.',
  'The "App preview" modal opens over the Create perk page, titled "App preview" with a close (X) icon top-right.'];

/** @type {{title:string, priority:string, description:string, pre:string, steps:[string,string][]}[]} */
const cases = [
  {
    title: 'Verify clicking "Preview & save" on a valid Create perk form opens the "App preview" modal',
    priority: 'Critical',
    description: 'AC1 / HLS-1 — a fully and validly filled Create-perk form opens the App preview modal showing the mobile mockup of the perk being created.',
    pre: PRE_BASE,
    steps: [
      STEP_LOGIN, STEP_NAV,
      ['Select "Merchant cashback" from the "Perk type" dropdown.',
        'The perk type is set and the rest of the Create perk form renders (Basic details, Value, Usage, Branches, Cashback processing, Duration, Cashback limit, Funding).'],
      STEP_FILL, STEP_OPEN,
      ['Read the modal header and footer controls.',
        'The modal shows the title "App preview", a close (X) icon, a "Preview language" radio group (English / Arabic), and footer buttons "Save" and "Cancel".'],
    ],
  },
  {
    title: 'Verify the "App preview" modal renders both the Card perks tile view and the perk detail screen',
    priority: 'Critical',
    description: 'AC1 / HLS-2 — the modal shows BOTH mobile views side by side, each inside a device frame, reflecting the data entered on the form.',
    pre: PRE_VALID_FORM,
    steps: [
      STEP_LOGIN, STEP_NAV, STEP_FILL, STEP_OPEN,
      ['Observe the number of device frames rendered inside the modal.',
        'Exactly two iPhone device frames are rendered side by side.'],
      ['Inspect the LEFT device frame.',
        'The left frame shows the Card perks tile view: a status bar (9:41), a back chevron with the centred title "Card perks", a pink category chip, a bold category heading, and one perk tile with the cover image, circular logo, perk title and perk subheader.'],
      ['Inspect the RIGHT device frame.',
        'The right frame shows the perk detail screen: a full-bleed hero cover image with a circular logo, the perk subheader, the perk title, the short perk description, and below the hero the section cards for the entered content.'],
      ['Compare the text shown in both frames against the values entered on the form.',
        'The perk title, subheader and descriptions displayed in both frames match exactly what was entered on the Create perk form.'],
    ],
  },
  {
    title: 'Verify the "App preview" device frame measures 375 x 812 (iPhone 13 mini)',
    priority: 'Medium',
    description: 'AC1 / HLS-1 — the perk card and detail screen must render inside a 375 x 812 (iPhone 13 mini) device frame, so the preview reflects true on-device proportions.',
    pre: PRE_VALID_FORM,
    steps: [
      STEP_LOGIN, STEP_NAV, STEP_FILL, STEP_OPEN,
      ['Inspect the rendered size of the device-frame element in the modal (browser element inspector or a scripted getBoundingClientRect / offsetWidth-offsetHeight read).',
        'The device frame measures exactly 375 x 812 CSS pixels.'],
      ['Inspect the rendered size of the inner screen (content viewport) element inside the device frame.',
        'The content viewport measures 375 x 812 CSS pixels, giving the iPhone 13 mini aspect ratio of 0.4618.'],
      ['Check for any CSS transform / zoom applied to the device frame or an ancestor.',
        'The preview is presented at true scale, so the admin sees the perk at genuine on-device proportions.'],
    ],
  },
  {
    title: 'Verify scrolling within the device frame reveals all remaining perk detail content',
    priority: 'High',
    description: 'AC2 / HLS-3 — when the detail content exceeds the visible frame height, scrolling inside the device frame reveals the remaining content (usage, branches, cashback processing, expiry).',
    pre: PRE_VALID_FORM + ' The form also has Branches, Cashback processing and Short duration description filled so the detail content exceeds the frame height.',
    steps: [
      STEP_LOGIN, STEP_NAV, STEP_FILL, STEP_OPEN,
      ['Note which detail sections are visible in the right device frame before scrolling.',
        'The hero and the first section cards are visible; later content is cut off at the bottom edge of the device frame.'],
      ['Scroll downwards inside the right device frame (mouse wheel over the frame).',
        'The content scrolls WITHIN the device frame only — the frame itself and the modal do not move, and the page behind the modal does not scroll.'],
      ['Continue scrolling to the bottom of the detail content.',
        'All remaining sections become visible (Usage, Branches, Cashback processing, Expiry) and scrolling stops exactly at the end of the content with no clipped or unreachable text.'],
    ],
  },
  {
    title: 'Verify tapping a detail-screen section header expands and collapses that section',
    priority: 'High',
    description: 'AC3 / HLS-4 — the detail screen sections are collapsible: tapping a section header expands/collapses that section, mirroring live app behaviour.',
    pre: PRE_VALID_FORM + ' The form has Usage, Branches, Cashback processing and Short duration description filled so all four section cards render.',
    steps: [
      STEP_LOGIN, STEP_NAV, STEP_FILL, STEP_OPEN,
      ['Inspect the section headers ("Usage", "Branches", "Cashback processing", "Expiry") in the right device frame for a collapse affordance.',
        'Each section header presents a collapse/expand affordance (for example a chevron) and indicates its expanded or collapsed state.'],
      ['Click the "Usage" section header.',
        'The "Usage" section toggles state — its body content collapses (hidden) or expands (shown) and the affordance updates to reflect the new state.'],
      ['Click the "Usage" section header a second time.',
        'The "Usage" section returns to its previous state, confirming the toggle works in both directions.'],
      ['Repeat the tap on the "Cashback processing" and "Expiry" section headers.',
        'Each section independently expands and collapses on tap, mirroring the live in-app behaviour.'],
    ],
  },
  {
    title: 'Verify the tile preview shows only the new perk\'s own category and tile, excluding all other categories and perks',
    priority: 'Critical',
    description: 'AC4 / HLS-5 — the card/tile preview must show only the category and tile for the perk being created, excluding all other existing categories and perks even when many exist.',
    pre: PRE_VALID_FORM + ' The environment already contains MULTIPLE existing perks across MULTIPLE categories (verified: 15 perks across 4 categories including "Breadfast", "b for book" and "General Purchases"). The perk under test is assigned to the "Breadfast" section, which already holds other perks.',
    steps: [
      STEP_LOGIN,
      ['Click "Card Perks" in the left navigation and note the existing perks and their categories in the perks table.',
        'The perks table lists multiple existing perks across multiple categories, including other perks already assigned to the "Breadfast" category.'],
      ['Click "Add perk", then fill every mandatory field for a "Merchant cashback" perk and set "Section (Mobile display)" to "Breadfast".',
        'The form accepts all values with no validation error and the perk is assigned to the "Breadfast" section.'],
      STEP_OPEN,
      ['Inspect every category heading shown in the LEFT (Card perks tile) device frame.',
        'Exactly ONE category is shown — "Breadfast", the category of the perk being created. No other existing category appears.'],
      ['Count the perk tiles shown under that category in the left device frame.',
        'Exactly ONE tile is shown — the perk being created. None of the other perks already assigned to "Breadfast", and no perk from any other category, appears.'],
    ],
  },
  {
    title: 'Verify selecting the "Arabic" preview language renders the preview in Arabic with correct RTL layout',
    priority: 'Critical',
    description: 'AC5 / HLS-6 — selecting the Arabic preview-language radio updates the preview to the Arabic localized content with the correct right-to-left text direction and mirrored layout.',
    pre: PRE_VALID_FORM + ' Arabic values are entered for every bilingual field (title AR, subheader AR, description AR, usage AR, branches AR, cashback processing AR, duration AR).',
    steps: [
      STEP_LOGIN, STEP_NAV, STEP_FILL, STEP_OPEN,
      ['Select the "Arabic" radio button in the "Preview language" group.',
        'The Arabic radio becomes selected and the English radio is deselected.'],
      ['Read the text content of both device frames.',
        'All preview content is displayed in Arabic — the perk title, subheader, description and every section body show the Arabic values entered on the form, and the section labels are translated (for example "الاستخدام" for Usage, "الفروع" for Branches, "الصلاحية" for Expiry).'],
      ['Inspect the text direction and alignment inside both device frames.',
        'Both frames render right-to-left: text is right-aligned, section labels and icons sit on the right, and values/chips sit on the left.'],
      ['Inspect the navigation chevron in the tile view header and the back button in the detail hero.',
        'Both are mirrored to point/sit on the right-hand side, matching RTL convention.'],
      ['Read the modal chrome (title, "Preview language" label, radio labels, Save and Cancel).',
        'The modal chrome remains in English — only the preview content localizes, as the admin portal itself is English-only.'],
    ],
  },
  {
    title: 'Verify selecting the "English" preview language returns the preview to English with LTR layout',
    priority: 'High',
    description: 'AC5 / HLS-6 — switching back from Arabic to English restores the English content and left-to-right direction, so the toggle works in both directions.',
    pre: PRE_VALID_FORM + ' The App preview modal is open and the "Arabic" preview language is currently selected.',
    steps: [
      STEP_LOGIN, STEP_NAV, STEP_FILL, STEP_OPEN,
      ['Select the "Arabic" radio button in the "Preview language" group.',
        'The preview switches to Arabic content with RTL layout.'],
      ['Select the "English" radio button in the "Preview language" group.',
        'The English radio becomes selected and the Arabic radio is deselected.'],
      ['Read the text content and inspect the direction of both device frames.',
        'All preview content returns to the English values entered on the form and both frames render left-to-right, with no residual Arabic text and no residual RTL alignment.'],
    ],
  },
  {
    title: 'Verify the "App preview" modal opens with English pre-selected as the default preview language',
    priority: 'Medium',
    description: 'HLS-7 — the modal opens in English by default: the English preview-language radio is pre-selected and the content renders LTR.',
    pre: PRE_VALID_FORM,
    steps: [
      STEP_LOGIN, STEP_NAV, STEP_FILL, STEP_OPEN,
      ['Inspect the state of the "Preview language" radio group immediately after the modal opens, without interacting with it.',
        'The "English" radio is pre-selected and the "Arabic" radio is not selected.'],
      ['Read the preview content and inspect its direction.',
        'The preview shows the English content and renders left-to-right.'],
    ],
  },
  {
    title: 'Verify clicking "Save" in the "App preview" modal creates the perk and it appears in the perks list',
    priority: 'Critical',
    description: 'AC6 / HLS-8 — clicking Save in the modal creates/publishes the perk, and the new perk is then present in the perks list.',
    pre: PRE_VALID_FORM,
    steps: [
      STEP_LOGIN, STEP_NAV, STEP_FILL, STEP_OPEN,
      ['Note the perk title shown in the preview, then click the "Save" button in the modal footer.',
        'The save is submitted and a success confirmation "Card perk created successfully" is displayed.'],
      ['Observe the modal and the page after the save completes.',
        'The App preview modal closes and the user is returned to the perks list, filtered to the perk\'s section.'],
      ['Locate the newly created perk in the perks table.',
        'The new perk is listed with the entered title, the correct Category ("Breadfast") and Type ("Merchant cashback"), a newly assigned Perk ID, and status "Active".'],
    ],
  },
  {
    title: 'Verify clicking "Cancel" in the "App preview" modal closes it without saving and keeps the form data',
    priority: 'Critical',
    description: 'AC6 / HLS-9 — clicking Cancel closes the modal without creating the perk and returns the admin to the Create perk form with the entered data intact.',
    pre: PRE_VALID_FORM,
    steps: [
      STEP_LOGIN, STEP_NAV, STEP_FILL, STEP_OPEN,
      ['Click the "Cancel" button in the modal footer.',
        'The App preview modal closes with no success message and no perk-created confirmation.'],
      ['Observe the page underneath the closed modal.',
        'The Create perk page is displayed again and remains on the create route.'],
      ['Inspect the values in the Create perk form fields.',
        'Every previously entered value is still present and unchanged, including the uploaded images.'],
      ['Navigate to the perks list and search for the perk title used in the preview.',
        'No perk with that title exists — Cancel did not create or publish anything.'],
    ],
  },
  {
    title: 'Verify clicking "Preview & save" with missing mandatory fields blocks the preview and shows field-level errors',
    priority: 'Critical',
    description: 'HLS-10 — clicking Preview & save while mandatory fields are missing or invalid must block the modal and surface field-level validation errors instead.',
    pre: PRE_BASE,
    steps: [
      STEP_LOGIN, STEP_NAV,
      ['Select "Merchant cashback" from the "Perk type" dropdown and leave the rest of the form empty.',
        'The full Create perk form renders with all mandatory fields empty.'],
      ['Click the "Preview & save" button.',
        'The "App preview" modal does NOT open.'],
      ['Inspect the form for validation feedback.',
        'Field-level validation errors reading "This field is required." are displayed against every unfilled mandatory field, and the mandatory image slots (Cover photo EN/AR, Logo EN/AR) are also flagged as required.'],
      ['Fill every mandatory field with valid data, then click "Preview & save" again.',
        'All validation errors clear and the "App preview" modal now opens, confirming the block was validation-driven.'],
    ],
  },
  {
    title: 'Verify every entered Create perk field renders in the correct place in the preview (Merchant cashback)',
    priority: 'High',
    description: 'HLS-11 — each value entered on the Create perk form appears in its correct location in the mobile preview: title, subheader, image, logo, description, usage, branches, cashback processing and expiry.',
    pre: PRE_VALID_FORM + ' Branches, Cashback processing and Short duration description are also filled.',
    steps: [
      STEP_LOGIN, STEP_NAV, STEP_FILL, STEP_OPEN,
      ['Compare the tile in the left device frame against the form values.',
        'The tile shows the Cover photo as the tile image, the Logo as the circular badge, the Perk title EN as the tile title and the Perk subheader EN beneath it.'],
      ['Compare the hero of the right device frame against the form values.',
        'The hero shows the Cover photo full-bleed, the Logo as a circular badge, the Perk subheader above the Perk title, and the Short perk description below the title.'],
      ['Compare each detail section card against the corresponding form field.',
        'The "Usage" card shows the Short usage description; "Branches" shows the list of valid branches; "Cashback processing" shows the short cashback description; "Expiry" shows the short duration description — each under its own labelled, icon-prefixed card.'],
      ['Confirm the category shown in the tile view matches the selected Section.',
        'The category chip and heading show the Section selected on the form ("Breadfast").'],
    ],
  },
  {
    title: 'Verify the Coupon code section renders with the coupon code chip for a "Discount/coupon" perk',
    priority: 'High',
    description: 'HLS-11 — the Coupon code section is depicted in the Figma design and is exclusive to the Discount/coupon perk type; it must render in the preview with the entered code, in both English and Arabic.',
    pre: PRE_BASE + ' NOTE: for the "Discount/coupon" perk type, Short perk description AR and Short usage description AR are ALSO mandatory (they are optional on Merchant cashback), and "Coupon type" (Online / Physical) only renders after a coupon code is entered.',
    steps: [
      STEP_LOGIN, STEP_NAV,
      ['Select "Discount/coupon" from the "Perk type" dropdown.',
        'The Discount/coupon variant of the form renders, including a "Coupon code (if any)" field under the Value section.'],
      ['Fill every mandatory field for the Discount/coupon perk, entering a coupon code (for example "BFCOFFEE20") and selecting the "Online" coupon type, plus all four images.',
        'All fields accept the values and no validation error is displayed.'],
      STEP_OPEN,
      ['Locate the Coupon code section in the right device frame.',
        'A "Coupon code" card is rendered with a leading tag icon, the label "Coupon code", and the entered coupon code shown in a chip with a copy icon.'],
      ['Select the "Arabic" radio in the "Preview language" group and locate the same section.',
        'The card renders as "كود الكوبون" with the label and icon on the right and the coupon code chip mirrored to the left, and the coupon code value itself is unchanged.'],
    ],
  },
  {
    title: 'Verify the perk cover image and logo render correctly in both preview views',
    priority: 'Medium',
    description: 'HLS-12 — the perk image and logo render in the preview at the correct position and aspect ratio in both the tile view and the detail hero.',
    pre: PRE_VALID_FORM + ' Cover photo EN/AR are exactly 1080x1080 (1:1) and Logo EN/AR are exactly 240x180 (4:3).',
    steps: [
      STEP_LOGIN, STEP_NAV, STEP_FILL, STEP_OPEN,
      ['Inspect the tile image in the left device frame.',
        'The uploaded Cover photo is displayed as the tile image, filling the tile width without distortion, stretching or letterboxing.'],
      ['Inspect the logo badge in the left device frame.',
        'The uploaded Logo is displayed as a circular badge overlapping the bottom edge of the tile image, not distorted.'],
      ['Inspect the hero image and logo in the right device frame.',
        'The Cover photo fills the hero area full-bleed at the top of the screen and the Logo is displayed as a centred circular badge over it, both undistorted.'],
      ['Select the "Arabic" radio and re-inspect both images.',
        'The Arabic cover photo and logo are displayed in the same positions with the same aspect ratios, correctly placed for the RTL layout.'],
    ],
  },
  {
    title: 'Verify closing the "App preview" modal with the X icon restores the Create perk page cleanly',
    priority: 'High',
    description: 'HLS-13 — closing via the X icon must restore the Create perk page with no stuck backdrop, no background scroll lock and the form data preserved.',
    pre: PRE_VALID_FORM,
    steps: [
      STEP_LOGIN, STEP_NAV, STEP_FILL, STEP_OPEN,
      ['Click the close (X) icon in the top-right corner of the modal.',
        'The App preview modal closes immediately with no perk created.'],
      ['Inspect the page for a leftover modal overlay or backdrop.',
        'No modal backdrop or overlay remains on the page — the Create perk page is fully visible and not dimmed.'],
      ['Scroll the Create perk page and interact with a form field.',
        'The page scrolls normally (no background scroll lock) and the form fields accept focus and input, confirming the page is interactive again.'],
      ['Inspect the values in the Create perk form and click "Preview & save" once more.',
        'All entered values are still intact and the App preview modal reopens successfully.'],
    ],
  },
  {
    title: 'Verify the preview reflects the Create perk form values at the moment the modal is opened',
    priority: 'Medium',
    description: 'HLS-14 — the preview binds to the form values at open time; editing the form after closing and reopening the modal shows the updated values.',
    pre: PRE_VALID_FORM,
    steps: [
      STEP_LOGIN, STEP_NAV, STEP_FILL, STEP_OPEN,
      ['Note the perk title displayed in the preview, then click "Cancel".',
        'The preview shows the current form title and the modal closes with the form data intact.'],
      ['Change the "Perk title EN" field to a different value on the Create perk form.',
        'The field accepts the new title and no validation error is displayed.'],
      ['Click "Preview & save" to reopen the modal.',
        'The App preview modal opens again.'],
      ['Read the perk title shown in both device frames.',
        'Both frames display the NEW title, confirming the preview reflects the form values as of the moment it was opened.'],
    ],
  },
  {
    title: 'Verify maximum-length content does not break the preview layout, scrolling or the "See more" expander',
    priority: 'Medium',
    description: 'HLS-16 — content at the documented field caps must render without breaking layout: the detail frame still scrolls to the end, no card overflows, and the truncation "See more" expander works.',
    pre: PRE_BASE + ' Field caps: Perk title 20, Perk subheader 30, Short perk description 80, Short usage description 200, Short cashback description 45, Short duration description 40 characters. The form REJECTS content above a cap with "Maximum length should be N characters." and blocks Preview & save, so content must sit exactly at the caps.',
    steps: [
      STEP_LOGIN, STEP_NAV, STEP_FILL,
      ['Set every text field to content exactly at its documented character cap, and enter a long multi-line list of branches.',
        'All fields accept the content and no "Maximum length" validation error is displayed.'],
      STEP_OPEN,
      ['Inspect each section card in the right device frame for clipped or overflowing text.',
        'All text wraps within its card — no card overflows horizontally and no text is clipped or overlapping.'],
      ['Locate the truncated branches list and click its "See more" link.',
        'The branches list expands to reveal the remaining entries and the detail content grows accordingly.'],
      ['Scroll to the bottom of the right device frame.',
        'The frame scrolls smoothly and stops exactly at the end of the expanded content, with all content reachable.'],
      ['Select the "Arabic" radio and repeat the layout inspection.',
        'The Arabic preview also renders max-length content without clipping or overflow, with correct RTL wrapping.'],
    ],
  },
  {
    title: 'Verify optional sections left empty are omitted from the perk detail preview',
    priority: 'Medium',
    description: 'HLS-17 — when optional content (Branches, Cashback processing, Short duration description) is left blank, the preview omits those sections rather than rendering empty cards.',
    pre: PRE_BASE,
    steps: [
      STEP_LOGIN, STEP_NAV,
      ['Fill only the mandatory fields for a "Merchant cashback" perk, deliberately leaving "List of valid branches", "Short cashback description" and "Short duration description" empty.',
        'The form accepts the values and no validation error is raised for the intentionally empty optional fields.'],
      STEP_OPEN,
      ['Inspect the section cards rendered in the right device frame.',
        'Only the sections that have content are rendered (the "Usage" card) — no "Branches", "Cashback processing" or "Expiry" card appears.'],
      ['Check for empty section cards, orphan labels or blank space where the omitted sections would be.',
        'No empty card, stray label or placeholder gap is rendered for the omitted sections; the layout closes up cleanly.'],
      ['Select the "Arabic" radio and repeat the inspection.',
        'The Arabic preview also renders only the populated sections, with no empty cards.'],
    ],
  },
  {
    title: 'Verify a failed save keeps the "App preview" modal open, preserves the data and surfaces an error message',
    priority: 'High',
    description: 'HLS-18 — when the perk-creation request fails, the modal must stay open with the entered data preserved and a clear error message must be shown to the admin; no perk may be created.',
    pre: PRE_VALID_FORM + ' The perk-creation API request can be made to fail (for example by simulating a server error / 500 response on the create endpoint).',
    steps: [
      STEP_LOGIN, STEP_NAV, STEP_FILL, STEP_OPEN,
      ['Arrange for the perk-creation request to fail, then click the "Save" button in the modal footer.',
        'The save request is submitted and fails.'],
      ['Observe the Save button and the modal.',
        'The Save button returns from its loading state to an actionable state (it does not remain stuck in a spinner), and the App preview modal stays open with both preview frames still rendered.'],
      ['Look for an error message on screen.',
        'A clear, human-readable error message is displayed telling the admin the perk could not be created.'],
      ['Close the modal and inspect the Create perk form values.',
        'All entered values are preserved so the admin can retry without re-entering the form.'],
      ['Navigate to the perks list and search for the perk title.',
        'No perk was created — the failed save left no partial or orphaned record.'],
    ],
  },
  {
    title: 'Verify the existing Create perk form and publish flow are not regressed by the "App preview" modal',
    priority: 'High',
    description: 'HLS-19 — regression check: the pre-existing Create-perk form behaviour (progressive rendering, field validation, image-spec validation) and the perk publish path still work with the new preview modal in place.',
    pre: PRE_BASE,
    steps: [
      STEP_LOGIN, STEP_NAV,
      ['Select each perk type in turn ("Discount/coupon", "Category cashback", "Merchant cashback", "General spend cashback") and observe the form.',
        'For each type the form renders its correct field set progressively, with no console-visible breakage and no missing sections.'],
      ['Attempt to upload an image that does not match a slot\'s required specification (for example a 240x180 image into a Cover photo slot).',
        'The image is rejected with an invalid-resolution message and the slot remains empty, exactly as before the preview modal existed.'],
      ['Fill the form validly for a "Merchant cashback" perk and click "Preview & save", then click "Save".',
        'The App preview modal opens and Save publishes the perk with the success confirmation "Card perk created successfully".'],
      ['Open the perks list and verify the published perk, then navigate to another Bcard Dashboard area and back.',
        'The perk is listed correctly with status "Active", and navigation around the dashboard continues to work normally with no stuck overlay from the modal.'],
    ],
  },
  {
    title: 'Verify the "App preview" modal visual fidelity matches the Figma design in English and Arabic',
    priority: 'Medium',
    description: 'HLS-20 / AC1 — the rendered modal must match the approved Figma design for layout, component inventory, ordering, spacing, fonts and copy, in both preview languages.',
    pre: PRE_VALID_FORM + ' The approved Figma baselines for this story are available: the English preview frame and the "Preview - AR" frame from the Perks-Admin-Dashboard file.',
    steps: [
      STEP_LOGIN, STEP_NAV, STEP_FILL, STEP_OPEN,
      ['Compare the modal chrome against the English Figma baseline.',
        'The title "App preview", the close (X) icon, the "Preview language" label with English/Arabic radios, and the "Save" (filled) plus "Cancel" (text) footer buttons all match the design in wording, styling and position.'],
      ['Compare the two device frames and the tile view against the English Figma baseline.',
        'Frame count, side-by-side arrangement, status bar, back chevron and centred "Card perks" title, the category chip above the category heading, and the single tile composition (image, circular logo, title, subheader) all match the design.'],
      ['Compare the detail screen hero and section cards against the English Figma baseline.',
        'The full-bleed hero with circular logo, the subheader/title/description order, and the white icon-prefixed section cards match the design in structure, ordering and styling.'],
      ['Select the "Arabic" radio and compare against the "Preview - AR" Figma baseline.',
        'The Arabic preview matches the AR design: right-to-left direction, right-aligned text, mirrored chevron and back button, section label plus icon on the right with values/chips on the left, translated section labels and translated "See more", while the modal chrome stays English.'],
      ['Compare the Arabic preview copy against the AR design copy.',
        'All Arabic strings match the approved design copy, including the Card perks screen title.'],
    ],
  },
];

const ORDER = ['Test Case ID', 'Title', 'Folder ID', 'Folder Path', 'State', 'Owner', 'Priority',
  'Type of Test Case', 'Automation Status', 'Description', 'Preconditions', 'Template', 'Steps',
  'Expected Result', 'Issues', 'Tags', 'Status (latest)', 'Attachments', 'Created At', 'Created By',
  'Last Updated At', 'Last Updated By', 'Project Name', 'Test Case URL'];

const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';

/** BrowserStack CSV: first row carries the case metadata, later rows carry step/result only. */
function toCsv() {
  const out = [ORDER.map(q).join(',')];
  for (const c of cases) {
    c.steps.forEach(([step, result], i) => {
      const row = {};
      ORDER.forEach((k) => { row[k] = ''; });
      if (i === 0) {
        Object.assign(row, {
          Title: c.title, State: 'Active', Owner: 'Fintech', Priority: c.priority,
          'Type of Test Case': 'Functional', 'Automation Status': 'Not Automated',
          Description: c.description, Preconditions: c.pre, Template: 'Steps',
          Issues: ISSUES, Tags: 'ai-created', 'Project Name': 'BCard Squad',
        });
      }
      row.Steps = step;
      row['Expected Result'] = result;
      out.push(ORDER.map((k) => q(row[k])).join(','));
    });
  }
  return out.join('\n');
}

module.exports = { cases, ISSUES, toCsv };

if (require.main === module) {
  if (process.argv.includes('--csv')) process.stdout.write(toCsv() + '\n');
  else {
    console.log(`${cases.length} cases · ${cases.reduce((n, c) => n + c.steps.length, 0)} steps total`);
    cases.forEach((c, i) => console.log(`  ${String(i + 1).padStart(2)}. [${c.priority}] ${c.steps.length} steps · ${c.title}`));
  }
}
