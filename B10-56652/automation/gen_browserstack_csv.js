'use strict';

/**
 * B10-56652 — BrowserStack Test Management case generator (single source of truth).
 *
 * The same `cases` array feeds BOTH the CSV (`../testcases/*.csv`) and the API upload
 * (`upload_browserstack.js`), so the CSV, the execution input and BrowserStack can never drift.
 * Shape follows the approved BCard Squad import (docs/ai/browserstack-process.md §10.5): the FIRST
 * row of a case carries all metadata plus step 1; each further step is a row with only
 * Steps + Expected Result populated.
 *
 * Step style is the canonical project standard: one user action per step, EVERY step carries its own
 * expected result, navigation/validation/verification are explicit steps, never combined.
 *
 * Run: node gen_browserstack_csv.js
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
const ISSUES = 'B10-56652';
const FOLDER_ID = '53273426';
const FOLDER_PATH = 'Pay Home -Perks Section Redesign';

// ── Preconditions ───────────────────────────────────────────────────────────
const ACCOUNT = 'a Breadfast customer account whose Breadfast Card wallet is ACTIVE and which has at least two card transactions (e.g. +201189586349 / +201174033834 / +201188369495; Pay passcode 123321, Pay-access OTP = the last 4 digits of the number)';
const PRE_BASE = `The build under test contains the Pay-home perks redesign (iOS bs://30248a98…09ac, Android bs://12bf2be5…cebf, com.breadfast.testing). Tester has ${ACCOUNT}. Login OTP is read from the Google Chat testing space. NOTE: account wallet status "Active" in the card admin panel is NOT sufficient — some Active wallets still show the "Get started" card-acquisition CTA and no perks section at all.`;
const PRE_MANY = `${PRE_BASE} The testing environment has MORE THAN 5 eligible perks (active, within start/end dates, in an active section) — currently 32 active perks, of which section "Breadfast" holds 5 with display_order 1-5.`;
const PRE_FEW = `${PRE_BASE} TEST DATA CHANGE REQUIRED: the environment must be reduced to FEWER THAN 5 eligible perks. Record the current state of every active perk first (evidence/perks-active-baseline.json), deactivate down to the target count via the card admin panel, and RESTORE every perk afterwards, verifying the restore. This is a shared environment — keep the window short.`;
const PRE_FIVE = `${PRE_BASE} TEST DATA CHANGE REQUIRED: the environment must have EXACTLY 5 eligible perks. Same record-deactivate-restore discipline as the "fewer than 5" cases.`;
const PRE_ZERO = `${PRE_BASE} TEST DATA CHANGE REQUIRED: the environment must have ZERO eligible perks. Same record-deactivate-restore discipline. Expected behaviour was NOT defined by any AC and is NOT drawn in Figma — the agreed expectation is that the whole section is hidden.`;
const PRE_SPILL = `${PRE_BASE} TEST DATA CHANGE REQUIRED: the FIRST section (by section display order, currently "Breadfast") must hold FEWER than 5 eligible perks while later sections still hold enough that MORE than 5 eligible perks exist overall. Same record-deactivate-restore discipline.`;
const PRE_AR = `${PRE_BASE} The device language/locale is set to Arabic (ar/EG) — on BrowserStack via the TOP-LEVEL capabilities appium:language=ar and appium:locale=EG, never inside bstack:options.`;

// ── Reusable step macros (the verified route to Pay home) ────────────────────
const LOGIN = ['Launch the Breadfast app, enter the test account mobile number on the login screen and submit it.',
  'The OTP verification screen is displayed showing "Enter the 4-digit verification code sent to <the entered number>".'];
const OTP = ['Retrieve the 4-digit login OTP from the Google Chat testing space and enter it.',
  'The OTP is accepted and the app navigates to the customer Home screen with the bottom navigation bar displayed.'];
const PAY_TAB = ['Tap the "Pay" tab in the bottom navigation bar.',
  'The "Unlock Breadfast Pay" screen is displayed with a 6-digit passcode entry and a numeric keypad.'];
const PASSCODE = ['Enter the 6-digit Pay passcode 123321 on the keypad.',
  'The passcode is accepted and the Pay-access OTP screen is displayed ("Verify your mobile number", 4-digit entry).'];
const PAY_OTP = ['Enter the Pay-access OTP, which is the last 4 digits of the account mobile number.',
  'The OTP is accepted and the "Save card for a faster checkout" interstitial is displayed with "Add card" and "Not now".'];
const NOT_NOW = ['Tap "Not now" on the "Save card for a faster checkout" interstitial.',
  'The interstitial closes and the Pay home screen is displayed, showing the card balance, the "Recent transactions" section and the "Card perks" section.'];
const SCROLL_TO_PERKS = ['Scroll the Pay home screen down until the "Card perks" section and its carousel are fully visible.',
  'The "Card perks" section header, its "See all" control and the perk carousel are fully visible on screen.'];

const ROUTE = [LOGIN, OTP, PAY_TAB, PASSCODE, PAY_OTP, NOT_NOW];

const cases = [];
const add = (c) => cases.push(c);

// ── HLS 1 · AC1 — long subtitle removed ─────────────────────────────────────
add({
  title: 'Verify the old long perks subtitle is no longer displayed in the Card perks section on Pay home',
  priority: 'High',
  hls: 'HLS 1',
  description: 'AC1 — the previous long subtitle ("Unlock exclusive deals...") must no longer be displayed anywhere in the Card perks section. Execute on iOS and Android, in English and in Arabic (the Arabic equivalent string must also be absent).',
  pre: PRE_MANY,
  steps: [...ROUTE, SCROLL_TO_PERKS,
    ['Read all text rendered between the "Card perks" section header and the first perk card.',
      'No subtitle or descriptive paragraph is rendered; the carousel begins directly below the header row. The string "Unlock exclusive deals" (and its Arabic equivalent in the ar/EG run) is absent from the screen.'],
    ['Scroll the Pay home screen fully from top to bottom and read every text element.',
      'The old long subtitle does not appear anywhere on the Pay home screen.']],
});

// ── HLS 2 · AC2 — the four mandated card elements ───────────────────────────
add({
  title: 'Verify each perk card in the carousel displays the cover image, circular logo overlay, title and subheader',
  priority: 'Critical',
  hls: 'HLS 2',
  description: 'AC2 — every perk card in the carousel must show a cover image filling the card, a circular logo overlaid on the cover, the perk title and the subheader. Execute on iOS and Android, in English and in Arabic.',
  pre: PRE_MANY,
  steps: [...ROUTE, SCROLL_TO_PERKS,
    ['Examine the first perk card in the carousel.',
      'The card shows a cover image filling the full width of the card with no letterboxing or padding, a circular logo badge overlaid on the cover, the perk title below the cover, and a subheader line below the title.'],
    ['Verify the logo badge shape and its position relative to the cover image.',
      'The logo is circular (not square or rounded-rectangle) and straddles the boundary between the cover image and the card footer, horizontally centred.'],
    ['Swipe the carousel left one card at a time and examine every remaining card in turn.',
      'Every card in the carousel shows the same four elements: full-fill cover image, circular logo overlay, title and subheader. No card is missing any of the four.'],
    ['Confirm no card renders a broken-image icon, a blank grey cover or a placeholder logo.',
      'All cover images and all logos are rendered as real images on every card.']],
});

// ── HLS 3 · AC2 — subheader resolution (targets F-2) ────────────────────────
add({
  title: 'Verify the perk card subheader shows a human-readable merchant, category or custom name and never a raw code',
  priority: 'Critical',
  hls: 'HLS 3',
  description: 'AC2 — the subheader must be a merchant name, a category name or a custom name. The subheader is DERIVED: for category-cashback perks it is the LOCALIZED CATEGORY NAME (name_en / name_ar), not the perk subheader_en/subheader_ar field and not category_code. Verify against the category record, not against appearances — a category may legitimately be NAMED with digits.',
  pre: `${PRE_MANY} Tester also needs the card admin panel category list (POST /api/v1/web/card/perks/category/list) to resolve what each perk's category is actually named.`,
  steps: [...ROUTE, SCROLL_TO_PERKS,
    ['Read the subheader of every card in the carousel, swiping through all of them.',
      'Every card renders a non-empty subheader line.'],
    ['For each card, look up the perk\'s category in the admin category list and compare its name_en (or name_ar in the Arabic run) against the rendered subheader.',
      'Each rendered subheader is exactly the perk category\'s localized name. NOTE: a subheader that looks like a code (e.g. "1225" / "1554") is CORRECT if that is genuinely the category\'s name_en / name_ar — verify before raising it.'],
    ['Confirm the rendered subheader is NOT the perk\'s category_code value.',
      'The subheader matches the category name, not the category_code (e.g. the category named "1225" has code "65955" — the code must not be what is displayed).'],
    ['For a perk whose subheader_en is empty in the card admin panel, compare the rendered subheader against the panel data.',
      'A subheader is still rendered and it is the resolved category/merchant name, confirming the value is derived rather than read from the perk subheader field.'],
    ['Confirm no card shows an empty reserved subheader row.',
      'No card displays a blank subheader line or a gap where the subheader should be.']],
});

// ── HLS 4 · AC3 — >5 cap + See all present ──────────────────────────────────
add({
  title: 'Verify the carousel renders exactly 5 perks and a See all control when more than 5 eligible perks exist',
  priority: 'Critical',
  hls: 'HLS 4',
  description: 'AC3 — the carousel is limited to a maximum of 5 perks, and when more than 5 eligible perks exist a "See all" control is available to reach the full perks list.',
  pre: PRE_MANY,
  steps: [...ROUTE,
    ['Confirm via the card admin panel perks list that more than 5 eligible (active, in-date, active-section) perks exist.',
      'The panel shows more than 5 eligible perks.'],
    SCROLL_TO_PERKS,
    ['Count the perk cards reachable in the carousel, swiping left until the carousel stops moving.',
      'Exactly 5 perk cards are present. On iOS the accessibility tree exposes exactly 5 perk-card-* nodes.'],
    ['Continue swiping the carousel left after the last card.',
      'The carousel does not advance to a 6th card; it stops at the 5th card.'],
    ['Locate the "See all" control for the Card perks section.',
      'A "See all" control is displayed in the "Card perks" section header row, on the opposite side of the header text.']],
});

// ── HLS 5 · AC4 — ordering is a prefix of the full list ─────────────────────
add({
  title: 'Verify the 5 carousel perks are the first 5 of the full perks list in the same order',
  priority: 'Critical',
  hls: 'HLS 5',
  description: 'AC4 — the carousel must contain the first 5 eligible perks ordered by section order then per-section display order. The full perks list screen is the live oracle: the carousel must be a prefix of it.',
  pre: PRE_MANY,
  steps: [...ROUTE, SCROLL_TO_PERKS,
    ['Record the title and subheader of each of the 5 carousel cards in left-to-right order (right-to-left in Arabic).',
      'An ordered list of 5 perks is captured.'],
    ['Tap "See all" in the Card perks section.',
      'The full "Card perks" list screen opens, showing the section tabs and the first section expanded as a grid.'],
    ['Record the first 5 perks of the full list in reading order, starting from the first section.',
      'An ordered list of the first 5 perks of the full list is captured.'],
    ['Compare the two ordered lists element by element.',
      'The two lists are identical in both membership and order — the carousel is an exact prefix of the full perks list.'],
    ['Open the card admin panel perks list and read the section order and each perk display order.',
      'The carousel order matches section display order first, then per-section perk display order — currently section "Breadfast" perks with display_order 1,2,3,4,5.']],
});

// ── HLS 6 · AC4 — spill into the next section ──────────────────────────────
add({
  title: 'Verify the carousel continues into the next section when the first section has fewer than 5 eligible perks',
  priority: 'Critical',
  hls: 'HLS 6',
  description: 'AC4 (agreed interpretation: FLAT ordering across sections) — when the first section holds fewer than 5 eligible perks but more than 5 exist overall, the carousel must fill the remaining slots from the next section rather than showing fewer than 5.',
  pre: PRE_SPILL,
  steps: [...ROUTE,
    ['Using the card admin panel, confirm the first section holds fewer than 5 eligible perks while more than 5 eligible perks exist overall, and record the expected first 5 across sections.',
      'The data state is confirmed and the expected ordered list of 5 perks (spanning two sections) is recorded.'],
    SCROLL_TO_PERKS,
    ['Count the perk cards reachable in the carousel.',
      'Exactly 5 perk cards are present — the carousel has not stopped at the first section\'s smaller count.'],
    ['Compare the rendered 5 cards against the expected ordered list.',
      'The cards match the expected list: the first section\'s perks in order, followed by the next section\'s perks in order, filling up to 5.'],
    ['Tap "See all" and confirm the full list shows the same overall ordering.',
      'The full perks list shows the same section order and the carousel remains an exact prefix of it.']],
});

// ── HLS 7 · AC4 — <5 branch ────────────────────────────────────────────────
add({
  title: 'Verify the carousel shows all eligible perks with no filler when fewer than 5 eligible perks exist',
  priority: 'Critical',
  hls: 'HLS 7',
  description: 'AC4 — if fewer than 5 perks are eligible, the carousel shows all of them, in order, with no placeholder, filler or empty card. This state has NO Figma frame, so behaviour is judged against the AC text only.',
  pre: PRE_FEW,
  steps: [...ROUTE,
    ['Using the card admin panel, reduce the eligible perks to fewer than 5 (for example 3) and record the expected ordered list.',
      'The environment holds fewer than 5 eligible perks and the expected ordered list is recorded.'],
    SCROLL_TO_PERKS,
    ['Count the perk cards in the carousel.',
      'The number of cards equals exactly the number of eligible perks — no more, no fewer.'],
    ['Compare the cards against the expected ordered list.',
      'All eligible perks are rendered, in the expected order.'],
    ['Swipe the carousel to its end and inspect the trailing area.',
      'There is no placeholder card, no empty card, no skeleton and no filler tile after the last real perk.'],
    ['Confirm the card geometry is unchanged from the >5 state.',
      'Cards keep the same size and layout; the carousel does not stretch cards to fill the row.']],
});

// ── HLS 8 · AC3/AC4 — exactly 5 boundary ───────────────────────────────────
add({
  title: 'Verify the carousel renders all 5 perks when exactly 5 eligible perks exist',
  priority: 'High',
  hls: 'HLS 8',
  description: 'AC3/AC4 upper boundary — with exactly 5 eligible perks the carousel shows all 5 and behaves identically to the capped case.',
  pre: PRE_FIVE,
  steps: [...ROUTE,
    ['Using the card admin panel, set the environment to exactly 5 eligible perks and record their expected order.',
      'The environment holds exactly 5 eligible perks.'],
    SCROLL_TO_PERKS,
    ['Count the perk cards and compare them against the expected order.',
      'Exactly 5 cards are rendered, in the expected order, with no filler.'],
    ['Swipe past the last card.',
      'The carousel stops at the 5th card without showing a placeholder or a 6th slot.']],
});

// ── HLS 9 · zero perks ─────────────────────────────────────────────────────
add({
  title: 'Verify the whole Card perks section is hidden when no eligible perks exist',
  priority: 'High',
  hls: 'HLS 9',
  description: 'Not covered by any AC and not drawn in Figma; agreed expectation is that the entire section (header, "See all" and carousel) is hidden when there are zero eligible perks.',
  pre: PRE_ZERO,
  steps: [...ROUTE,
    ['Using the card admin panel, make every perk ineligible so that zero eligible perks remain.',
      'The environment holds zero eligible perks.'],
    ['Scroll the Pay home screen from top to bottom.',
      'No "Card perks" section header is rendered, no "See all" control for perks is rendered, and no carousel or empty carousel strip is rendered.'],
    ['Verify the sections above and below where the perks section used to be.',
      'The card hero and the "Recent transactions" section render normally and the layout closes up cleanly with no gap, no stray divider and no blank space where the perks section was.'],
    ['Confirm no error message, spinner or broken placeholder is displayed.',
      'The Pay home screen shows no error, no infinite spinner and no broken image in place of the section.']],
});

// ── HLS 10 · See all visibility at <=5 ─────────────────────────────────────
add({
  title: 'Verify the See all control remains visible in the Card perks header when 5 or fewer perks are eligible',
  priority: 'High',
  hls: 'HLS 10',
  description: 'AC3 ties "See all" to "more than 5 perks" while AC4 and AC9 are silent and the design shows it unconditionally. Agreed expectation: "See all" is ALWAYS visible as a section-header affordance.',
  pre: PRE_FEW,
  steps: [...ROUTE,
    ['Reduce the environment to fewer than 5 eligible perks using the card admin panel.',
      'The environment holds fewer than 5 eligible perks.'],
    SCROLL_TO_PERKS,
    ['Look for the "See all" control in the "Card perks" section header row.',
      'The "See all" control is displayed even though 5 or fewer perks are eligible.'],
    ['Tap "See all".',
      'The full perks list screen opens and shows the same reduced set of eligible perks.'],
    ['Repeat the check with exactly 5 eligible perks.',
      'The "See all" control is still displayed at exactly 5 eligible perks.']],
});

// ── HLS 11 · AC9 — no trailing See all ─────────────────────────────────────
add({
  title: 'Verify no See all tile or control appears at the end of the perks carousel or the transactions list',
  priority: 'High',
  hls: 'HLS 11',
  description: 'AC9 — the "See all" button must not appear at the end of the card list. It belongs in the section header row only.',
  pre: PRE_MANY,
  steps: [...ROUTE, SCROLL_TO_PERKS,
    ['Swipe the perks carousel to its very end and inspect the area after the last perk card.',
      'No "See all" card, tile, button or chevron affordance is rendered after the last perk card.'],
    ['Confirm where the perks "See all" control is located.',
      'The only "See all" control for the section is in the section header row, aligned opposite the header text.'],
    ['Scroll to the "Recent transactions" section and inspect the area after the last transaction row.',
      'No "See all" tile or row is rendered at the end of the transactions list; its "See all" is likewise only in the section header row.']],
});

// ── HLS 12 · AC5 — card tap opens the right perk ───────────────────────────
add({
  title: 'Verify tapping a perk card opens the Perk Details screen for that exact perk',
  priority: 'Critical',
  hls: 'HLS 12',
  description: 'AC5 — tapping a perk card must navigate to the Perk Details screen for that specific perk. Verified for the first and the last card in the carousel to catch index/binding errors.',
  pre: PRE_MANY,
  steps: [...ROUTE, SCROLL_TO_PERKS,
    ['Record the title, subheader and cover image of the FIRST perk card.',
      'The first card\'s identity is captured.'],
    ['Tap the first perk card.',
      'The Perk Details screen opens.'],
    ['Compare the details screen title, subheader, cover image and logo against the captured identity.',
      'The Perk Details screen shows the SAME perk — identical title, subheader, cover image and logo. It is not a different perk and not a generic screen.'],
    ['Navigate back to Pay home and scroll to the carousel.',
      'The Pay home screen is displayed again with the Card perks carousel present.'],
    ['Swipe to the LAST perk card, record its identity and tap it.',
      'The Perk Details screen opens for the last card.'],
    ['Compare the details screen against the last card\'s captured identity.',
      'The details screen shows the last card\'s perk, confirming the tap-to-perk binding is correct across the whole carousel.']],
});

// ── HLS 13 · AC6 — See all navigation + return ─────────────────────────────
add({
  title: 'Verify tapping See all in the Card perks section opens the full perks list and back returns to Pay home',
  priority: 'Critical',
  hls: 'HLS 13',
  description: 'AC6 — tapping "See all" navigates to the full perks list screen. Back-navigation must return to Pay home without error.',
  pre: PRE_MANY,
  steps: [...ROUTE, SCROLL_TO_PERKS,
    ['Tap the "See all" control in the "Card perks" section header.',
      'The full "Card perks" list screen opens, titled "Card perks", with section tabs and a two-column grid of perks.'],
    ['Verify the list contains more perks than the carousel did.',
      'The full list shows the complete set of eligible perks across sections, i.e. more than the 5 shown in the carousel.'],
    ['Tap the back control on the full perks list screen.',
      'The app returns to the Pay home screen with no error, no blank screen and no crash.'],
    ['Verify the Pay home screen is fully functional after returning.',
      'The card balance, "Recent transactions" and "Card perks" sections all render and the carousel is scrollable again.']],
});

// ── HLS 14 · eligibility filter ────────────────────────────────────────────
add({
  title: 'Verify expired, planned and inactive-section perks never appear in the Pay home carousel',
  priority: 'High',
  hls: 'HLS 14',
  description: 'Eligibility — only active, in-date perks belonging to an active section may occupy one of the 5 carousel slots.',
  pre: `${PRE_MANY} The environment contains 80 expired perks and at least 1 planned perk, plus at least one inactive section.`,
  steps: [...ROUTE,
    ['In the card admin panel, record the titles of several expired perks, at least one planned perk and the perks of an inactive section.',
      'A list of perks that must NOT appear is recorded.'],
    SCROLL_TO_PERKS,
    ['Read the titles of all 5 carousel cards and compare them against the must-not-appear list.',
      'None of the expired, planned or inactive-section perks appears in the carousel.'],
    ['Tap "See all" and inspect the full perks list.',
      'None of the expired, planned or inactive-section perks appears in the full list either; the section tabs show only active sections.'],
    ['In the admin panel, change one active carousel perk to expired, then reopen Pay home.',
      'That perk is no longer in the carousel and its slot is taken by the next eligible perk in order.']],
});

// ── HLS 15 · AC7 + transactions regression ─────────────────────────────────
add({
  title: 'Verify the Recent transactions header matches the Card perks header and the transactions section is not regressed',
  priority: 'Critical',
  hls: 'HLS 15',
  description: 'AC7 plus the primary regression risk of this story — the transactions section is edited by AC7/AC8/AC10 even though the story is named after the perks section. Header sizing is adjudicated visually against the Figma frame.',
  pre: PRE_BASE,
  steps: [...ROUTE,
    ['Compare the "Recent transactions" header against the "Card perks" header on the same screen.',
      'Both headers render at the same font size and weight, with the same left (or right, in Arabic) alignment and the same spacing above the content below them.'],
    ['Capture the Pay home screen and compare both headers against the Figma Pay-home frame.',
      'The rendered header size and weight match the design frame for both sections.'],
    ['Read every transaction row in the "Recent transactions" list.',
      'Each row shows its merchant or counterparty avatar/icon, the name, the action and time (e.g. "Received at 09:48 AM") and the signed amount, with credits in green and debits in the default colour.'],
    ['Verify the transactions are in the expected order.',
      'Transactions are listed newest first.'],
    ['Tap the "See all" control in the "Recent transactions" section.',
      'The full transactions list screen opens and lists the account transactions.'],
    ['Navigate back to Pay home.',
      'Pay home is displayed again with the transactions section intact.']],
});

// ── HLS 16 · AC8 + AC10 ────────────────────────────────────────────────────
add({
  title: 'Verify the See all control is bold and reads See all in sentence case in both the perks and transactions sections',
  priority: 'High',
  hls: 'HLS 16',
  description: 'AC8 (bolder) and AC10 (sentence case). AC10 is inherently English-only — Arabic has no letter case, so the Arabic run reports Not Applicable with evidence for the casing assertion and verifies the Arabic string instead.',
  pre: PRE_BASE,
  steps: [...ROUTE,
    ['Read the exact text of the "See all" control in the "Recent transactions" section.',
      'The control reads exactly "See all" — sentence case, with a lower-case "all". It is NOT "See All".'],
    ['Read the exact text of the "See all" control in the "Card perks" section.',
      'The control reads exactly "See all" — sentence case.'],
    ['Compare the font weight of both "See all" controls against the Figma Pay-home frame.',
      'Both controls render at the heavier (bold) weight shown in the design, in the brand magenta.'],
    ['In the Arabic run, read both "See all" controls.',
      'Both render the Arabic equivalent ("عرض الكل"). The sentence-case assertion is Not Applicable in Arabic and is reported as such with a screenshot, never as passed.']],
});

// ── HLS 17 · AR/RTL ────────────────────────────────────────────────────────
add({
  title: 'Verify the Card perks section is fully mirrored and localized in the Arabic build',
  priority: 'Critical',
  hls: 'HLS 17',
  description: 'Localization — the whole section must mirror for RTL and use Arabic content. Compared against the Arabic Figma Pay-home frame.',
  pre: PRE_AR,
  steps: [...ROUTE, SCROLL_TO_PERKS,
    ['Check the position of the "Card perks" section header and its "See all" control.',
      'The section header is right-aligned and the "See all" control is on the LEFT of the header row — mirrored from the English layout.'],
    ['Check which perk card occupies the leading edge of the carousel.',
      'The first perk is at the RIGHT edge of the screen, with the peek of the next card on the left.'],
    ['Swipe the carousel from left to right.',
      'The carousel advances to the next perk — the swipe direction is inverted relative to the English build.'],
    ['Read the title and subheader of each card.',
      'Titles and subheaders render in Arabic, taken from the perk Arabic fields, with no English fallback and no mojibake.'],
    ['Compare each card cover image and logo against the Arabic assets configured for those perks in the admin panel.',
      'Where a distinct Arabic cover or logo is configured, the Arabic asset is used rather than the English one.'],
    ['Check the "Recent transactions" section in the same screen.',
      'That section is mirrored too: header right-aligned, "See all" on the left, amounts and times rendered correctly for Arabic.'],
    ['Compare the whole screen against the Arabic Figma Pay-home frame.',
      'Layout, mirroring and typography match the Arabic design frame.']],
});

// ── HLS 18 · text overflow ─────────────────────────────────────────────────
add({
  title: 'Verify long perk titles and subheaders are truncated or wrapped without breaking the card layout',
  priority: 'Medium',
  hls: 'HLS 18',
  description: 'Overflow — title (max 20) and subheader (max 30) at their limits, and longer Arabic strings, must not overlap the logo, clip the card or change its height. No truncation rule is specified, so the assertion is "does not break the layout".',
  pre: `${PRE_MANY} At least one eligible perk must have a title at its maximum length and a subheader at its maximum length, in both English and Arabic. Create or edit such a perk in the card admin panel and place it in the first 5 by display order.`,
  steps: [...ROUTE,
    ['In the card admin panel, ensure a perk with maximum-length English and Arabic title and subheader is within the first 5 by display order.',
      'The long-text perk is positioned inside the carousel range.'],
    SCROLL_TO_PERKS,
    ['Examine the long-text card in the English build.',
      'The title and subheader are either truncated with an ellipsis or wrapped; they do not overlap the circular logo, do not spill outside the card border and do not change the card height relative to its neighbours.'],
    ['Compare the long-text card height and width against the other cards.',
      'All cards in the carousel keep identical dimensions.'],
    ['Repeat the inspection in the Arabic build.',
      'The longer Arabic strings are also truncated or wrapped without overlapping the logo, clipping the card or changing its height.']],
});

// ── HLS 19 · image loading ─────────────────────────────────────────────────
add({
  title: 'Verify perk cover and logo images load on the Pay home carousel including on a degraded connection',
  priority: 'Medium',
  hls: 'HLS 19',
  description: 'The redesign puts 10 remote images (5 covers + 5 logos) on the Pay landing screen where there were none. Covers loading, cache behaviour and failure handling.',
  pre: PRE_MANY,
  steps: [...ROUTE, SCROLL_TO_PERKS,
    ['Observe the carousel immediately as the Pay home screen appears.',
      'Cover and logo images either render immediately or show a defined loading treatment; the section does not flash broken-image icons.'],
    ['Wait for the screen to settle and inspect all 5 cards.',
      'All 10 images (5 covers, 5 logos) are fully rendered with no broken, blank or placeholder tile.'],
    ['Throttle the device connection to a slow network, then leave and re-enter Pay home.',
      'The carousel still renders; images arrive progressively without the layout jumping or the cards collapsing.'],
    ['Disable the network entirely and re-enter Pay home.',
      'The section degrades gracefully — cached images or a defined placeholder are shown, and the app does not crash or render an empty broken section.'],
    ['Restore the connection and re-enter Pay home.',
      'All images render correctly again.']],
});

// ── HLS 20 · nested scroll + cross-platform parity ─────────────────────────
add({
  title: 'Verify Pay home vertical scrolling and carousel horizontal scrolling do not interfere, on both platforms',
  priority: 'High',
  hls: 'HLS 20',
  description: 'A horizontal carousel nested inside a vertical scroll view is a classic gesture-conflict source, and the behaviour must be equivalent on iOS and Android.',
  pre: PRE_MANY,
  steps: [...ROUTE,
    ['Swipe vertically upward with the touch starting ON a perk card.',
      'The Pay home screen scrolls vertically; the carousel does not scroll horizontally.'],
    SCROLL_TO_PERKS,
    ['Swipe horizontally with the touch starting ON a perk card.',
      'The carousel scrolls horizontally; the page does not scroll vertically.'],
    ['Swipe diagonally starting on a perk card.',
      'Exactly one axis wins and the gesture resolves cleanly — the screen does not jitter or move on both axes.'],
    ['Scroll the page so the carousel is half visible at the bottom edge, then swipe horizontally on the visible part.',
      'The carousel still scrolls horizontally at the section boundary.'],
    ['Repeat all of the above on the other platform (iOS and Android).',
      'Both platforms behave equivalently; any difference in overscroll or snap feel is native platform behaviour and does not prevent reaching the 5th card.']],
});

// ── REMOVED 2026-07-28 ────────────────────────────────────────────────────
// Two cases were written here and have been DELETED from BrowserStack (TC-54055, TC-54056)
// because neither is a valid case for this story:
//   • the accessibility-tree case tested a dimension that is NOT in scope for this story;
//   • the "a newly created perk reaches the carousel" case asserted an ordering guarantee the
//     specification does not make — the Pay-screen order is unspecified.
// Both were written from findings that the reporter subsequently rejected. Kept as a comment so the
// deletion is deliberate and traceable rather than looking like an accidental omission.
// Rule going forward: a case may only assert something an AC, a Figma element or a named business
// rule actually states (docs/ai/bug-reporting.md section 1.1, check 1).

module.exports = { cases, ISSUES, FOLDER_ID, FOLDER_PATH, OWNER, PROJECT, TAGS, HEADER };

// ── CSV emitter ────────────────────────────────────────────────────────────
function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

if (require.main === module) {
  const rows = [HEADER];
  cases.forEach((c, idx) => {
    const id = `TC_${String(idx + 1).padStart(2, '0')}`;
    c.steps.forEach(([step, result], i) => {
      if (i === 0) {
        rows.push([id, c.title, FOLDER_ID, FOLDER_PATH, 'Active', OWNER, c.priority, 'Functional',
          'Not Automated', c.description, c.pre, 'Test Case Steps', step, result, ISSUES, TAGS,
          '', '', '', '', '', '', PROJECT, '']);
      } else {
        rows.push(['', '', '', '', '', '', '', '', '', '', '', '', step, result, '', '', '', '', '', '', '', '', '', '']);
      }
    });
  });
  const out = path.resolve(__dirname, '..', 'testcases', 'B10-56652_browserstack_testcases.csv');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n', 'utf8');
  const steps = cases.reduce((n, c) => n + c.steps.length, 0);
  console.log(`${cases.length} cases · ${steps} steps · ${rows.length - 1} CSV rows → ${out}`);
  cases.forEach((c, i) => console.log(`  TC_${String(i + 1).padStart(2, '0')} [${c.hls}] ${c.priority.padEnd(8)} ${c.title.slice(0, 92)}`));
}
