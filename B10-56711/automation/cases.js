'use strict';
/**
 * B10-56711 — Perk Details Screen Redesign · canonical test cases (single source of truth).
 *
 * Standard (`docs/ai/testing-process.md` §3.7): granular user-action steps — Login → Navigate →
 * Open → Act → Verify — with **every step carrying its own Expected Result**, navigation and
 * verification as explicit steps, never two actions combined in one step.
 *
 * Consumed by `upload_browserstack.js` (Test Management API v2) and by README.md's traceability
 * table, so the uploaded cases and the documentation cannot drift apart.
 *
 * SCOPE NOTES (from clarification/clarifications.md — operator answers are BINDING)
 *  - AC10: Expiry renders `short_duration_description` **free text, verbatim** — never a formatted
 *    `end_date`. A perk without that field correctly shows no value (TC-14).
 *  - AC3: "header block" means **the perk logo**, so title + tagline sit below the logo, overlaid on
 *    the cover image. Both the AC and the design are correct.
 *  - AC12: branches are authored as **separate lines** in the card panel and **each authored line
 *    renders on its own line** (3 max, 200-char cap). The truncation point is therefore
 *    DETERMINISTIC and device-independent — a difference between iPhone and Android is a defect,
 *    not expected behaviour.
 *  - AC2: assert **logo presence + the locale-correct asset** only. Which logo appears for perks with
 *    no merchant (general-/category-cashback) is out of scope while Figma #30 is "Pending".
 *  - OUT OF SCOPE: the perk-not-found / deeplink view (Figma #39 — existing behaviour, no change),
 *    a coupon-vs-in-store indicator (Figma #31 — deferred), the loading state (no AC),
 *    accessibility / performance / API contract (no AC).
 *
 * FIXTURES (verified live at the prerequisite gate; no seeding required)
 *   DC_17 "BF Bakery 15% Off"    online code BFBAKERY15 · 16 branch lines · cashback ✓ · expiry ✓ · NO tagline
 *   DC_16 "RTE Buy 1 Get 1"      PHYSICAL code BFRTE2FOR1 · 2 branch lines · cashback ✓ · expiry ✓ · tagline ✓
 *   GC_56 "8% on All Spend"      no branches · cashback ✓ · expiry ✓ · tagline ✓
 *   DC_8  "new discount perk 1"  PHYSICAL Code123 · EXACTLY 3 branch lines · NO cashback · NO expiry
 */

const ISSUES = 'B10-56711';

const PRE = 'Breadfast Pay build under test installed. Test account +201188369495 (wallet Active, passcode 123321). '
  + 'The testing card backend is reachable and the Perks List renders perks. '
  + 'Perks DC_17 "BF Bakery 15% Off", DC_16 "RTE Buy 1 Get 1", GC_56 "8% on All Spend" and DC_8 "new discount perk 1" '
  + 'exist and are active on the card admin dashboard with their documented field values.';

const LOGIN_STEPS = [
  ['Launch the Breadfast app and enter the test mobile number 01188369495 on the login screen.', 'The number is accepted and the app requests the login OTP.'],
  ['Enter the login OTP received for that number.', 'The OTP is accepted and the app opens the Home screen.'],
  ['Tap the "Pay" tab in the bottom navigation.', 'The Pay passcode screen "Unlock Breadfast Pay" is displayed.'],
  ['Enter the 6-digit passcode 123321.', 'The passcode is accepted and the "Verify your mobile number" screen requesting the 4-digit Pay-access code is displayed.'],
  ['Enter the 4-digit Pay-access verification code sent to the account number.', 'The code is accepted and the Pay home screen is displayed showing the card balance and the "Card perks" section.'],
];

const TO_LIST_STEPS = [
  ...LOGIN_STEPS,
  ['Locate the "Card perks" section on the Pay home screen.', 'The "Card perks" section header is displayed with a "See all" control beside it.'],
  ['Tap "See all" in the "Card perks" section.', 'The Perks List screen opens and displays the available perk cards.'],
];

/** Steps that land on the Perk Details screen for a named perk. */
const toDetails = (title) => [
  ...TO_LIST_STEPS,
  [`Scroll the Perks List until the perk card "${title}" is visible.`, `The perk card "${title}" is displayed on screen.`],
  [`Tap the perk card "${title}".`, `The Perk Details screen opens for "${title}".`],
];

const cases = [
  {
    id: 'TC-01', ac: '—', hls: 1,
    title: 'Perk Details opens for the exact perk tapped on the Perks List',
    steps: [
      ...TO_LIST_STEPS,
      ['Note the title displayed on the perk card "BF Bakery 15% Off" on the Perks List.', 'The perk card shows the title "BF Bakery 15% Off".'],
      ['Tap the perk card "BF Bakery 15% Off".', 'The Perk Details screen opens.'],
      ['Read the perk title displayed on the Perk Details screen.', 'The title displayed is "BF Bakery 15% Off" — the same perk that was tapped, not a different perk.'],
    ],
  },
  {
    id: 'TC-02', ac: 'AC1', hls: 2,
    title: 'Perk Details header displays a single full-bleed cover image with no secondary background border',
    steps: [
      ...toDetails('BF Bakery 15% Off'),
      ['Examine the header area at the top of the Perk Details screen.', 'A single cover image is displayed full bleed — it extends to both side edges and to the top edge of the screen, behind the status bar.'],
      ['Check the header for any second, separate "background" image or framed border drawn around or behind the cover image.', 'No second background image and no separate image border is displayed. Only one cover image is present.'],
    ],
  },
  {
    id: 'TC-03', ac: 'AC2', hls: 3,
    title: 'A circular logo overlay is rendered on the cover image',
    steps: [
      ...toDetails('BF Bakery 15% Off'),
      ['Examine the logo displayed over the cover image in the header.', 'A logo is displayed inside a circular container that overlaps the cover image.'],
      ['Check the shape of the logo container.', 'The logo container is circular, not square or rectangular.'],
      ['Open the same perk in the Arabic build and compare the logo image displayed.', 'The Arabic build renders the perk\'s Arabic logo asset. The container remains circular and stays overlaid on the cover image.'],
    ],
  },
  {
    id: 'TC-04', ac: 'AC3', hls: 4,
    title: 'Perk title and tagline are displayed below the header block for a perk that has a tagline',
    steps: [
      ...toDetails('RTE Buy 1 Get 1'),
      ['Locate the perk title on the Perk Details screen.', 'The perk title "RTE Buy 1 Get 1" is displayed in clearly readable type.'],
      ['Check the vertical position of the title relative to the circular logo.', 'The title is displayed below the circular logo, not above or beside it.'],
      ['Locate the short tagline text.', 'The tagline configured for the perk on the dashboard is displayed below the title in clearly readable type.'],
    ],
  },
  {
    id: 'TC-05', ac: 'AC3', hls: 4,
    title: 'Tagline slot collapses cleanly for a perk configured without a tagline',
    steps: [
      ...toDetails('BF Bakery 15% Off'),
      ['Locate the perk title on the Perk Details screen.', 'The perk title "BF Bakery 15% Off" is displayed below the circular logo.'],
      ['Examine the area between the title and the first detail card, where a tagline would appear.', 'No tagline text is displayed, and no empty placeholder line or blank gap is reserved for it. The layout closes up and the first detail card follows the title directly.'],
    ],
  },
  {
    id: 'TC-06', ac: 'AC4', hls: 5,
    title: 'Details section is composed of distinct labelled cards and not one merged block',
    steps: [
      ...toDetails('BF Bakery 15% Off'),
      ['Examine the details section below the header.', 'The details are presented as separate visual cards, each visually distinct with its own background and a visible gap between cards.'],
      ['Read the label at the top of each card, scrolling down as needed.', 'Each card carries a clear label. The labels displayed are "Coupon code", "Usage", "Branches", "Cashback processing" and "Expiry".'],
      ['Check whether the details are rendered as one continuous undifferentiated block of text.', 'The details are not merged into a single block; each labelled card is separated from the next.'],
    ],
  },
  {
    id: 'TC-07', ac: 'AC5', hls: 6,
    title: 'Detail cards are displayed in the mandated order for a perk that has all five cards',
    steps: [
      ...toDetails('BF Bakery 15% Off'),
      ['Read the label of the first detail card below the header.', 'The first card is labelled "Coupon code".'],
      ['Read the label of the second detail card.', 'The second card is labelled "Usage".'],
      ['Read the label of the third detail card.', 'The third card is labelled "Branches".'],
      ['Scroll down and read the label of the fourth detail card.', 'The fourth card is labelled "Cashback processing".'],
      ['Read the label of the fifth detail card.', 'The fifth card is labelled "Expiry".'],
    ],
  },
  {
    id: 'TC-08', ac: 'AC5', hls: 7,
    title: 'Mandated card order is preserved when a conditional card is hidden',
    steps: [
      ...toDetails('8% on All Spend'),
      ['Scroll through the whole details section to the end and list the card labels displayed, in order.', 'The "Branches" card is not displayed because no branches are configured for this perk.'],
      ['Compare the order of the cards that are displayed against the mandated order Coupon code, Usage, Branches, Cashback processing, Expiry.', 'The cards that are displayed appear in the same relative order as the mandated sequence, with the hidden "Branches" card simply omitted and no card displaced out of order.'],
    ],
  },
  {
    id: 'TC-09', ac: 'AC6', hls: 8,
    title: 'Online coupon code is displayed with a tap-to-copy control and copies to the clipboard',
    steps: [
      ...toDetails('BF Bakery 15% Off'),
      ['Locate the "Coupon code" card.', 'The "Coupon code" card is displayed.'],
      ['Read the coupon code shown on the card.', 'The coupon code "BFBAKERY15" is displayed, matching the code configured on the dashboard.'],
      ['Check the coupon code control for a copy affordance.', 'A tap-to-copy control is displayed with the code.'],
      ['Tap the coupon code control.', 'The tap is accepted and copy confirmation feedback is displayed.'],
      ['Move focus to any text input outside the app (for example the device notes app) and paste the clipboard contents.', 'The pasted value is exactly "BFBAKERY15", confirming the code was copied to the system clipboard.'],
    ],
  },
  {
    id: 'TC-10', ac: 'AC7', hls: 9,
    title: 'Copying a code shows "Copied!" for 3 seconds and then displays the code again',
    steps: [
      ...toDetails('BF Bakery 15% Off'),
      ['Locate the "Coupon code" card and confirm the code "BFBAKERY15" is displayed.', 'The coupon code "BFBAKERY15" is displayed on the card.'],
      ['Tap the coupon code control and immediately observe the control.', 'The control displays "Copied!" in place of the code.'],
      ['Keep observing the control for approximately 3 seconds while timing it.', '"Copied!" remains displayed for about 3 seconds.'],
      ['Observe the control after the 3 seconds have elapsed.', '"Copied!" is no longer displayed and the coupon code "BFBAKERY15" is displayed again.'],
    ],
  },
  {
    id: 'TC-11', ac: 'AC8', hls: 10,
    title: 'Physical coupon code is hidden behind a View CTA that opens a bottom sheet with the code and a Close CTA',
    steps: [
      ...toDetails('RTE Buy 1 Get 1'),
      ['Locate the "Coupon code" card.', 'The "Coupon code" card is displayed.'],
      ['Check whether the coupon code value is visible on the card.', 'The coupon code "BFRTE2FOR1" is not displayed on the card.'],
      ['Check the card for a call to action in place of the code.', 'A "View" call to action is displayed on the card.'],
      ['Tap the "View" call to action.', 'A bottom sheet opens over the Perk Details screen.'],
      ['Read the coupon code displayed in the bottom sheet.', 'The bottom sheet displays the coupon code "BFRTE2FOR1".'],
      ['Check the bottom sheet for a dismissal control.', 'A "Close" call to action is displayed in the bottom sheet.'],
    ],
  },
  {
    id: 'TC-12', ac: 'AC8', hls: 11,
    title: 'Bottom sheet Close CTA dismisses the sheet and returns to the Perk Details screen unchanged',
    steps: [
      ...toDetails('RTE Buy 1 Get 1'),
      ['Tap the "View" call to action on the "Coupon code" card.', 'The bottom sheet opens and displays the coupon code "BFRTE2FOR1" with a "Close" call to action.'],
      ['Tap "Close" in the bottom sheet.', 'The bottom sheet is dismissed.'],
      ['Examine the screen displayed after the sheet is dismissed.', 'The Perk Details screen for "RTE Buy 1 Get 1" is displayed again, with the "Coupon code" card still showing the "View" call to action and the coupon code still hidden.'],
    ],
  },
  {
    id: 'TC-13', ac: 'AC9', hls: 12,
    title: 'Usage card displays the usage description from the dashboard including its line breaks',
    steps: [
      ...toDetails('BF Bakery 15% Off'),
      ['Locate the "Usage" card.', 'The "Usage" card is displayed.'],
      ['Compare the text displayed in the "Usage" card against the usage description configured for the perk on the card admin dashboard.', 'The text displayed matches the configured usage description exactly, with no truncation and no altered wording.'],
      ['Check how the line breaks in the configured usage description are rendered.', 'The line breaks configured on the dashboard are preserved, so the text is displayed as separate paragraphs rather than run together.'],
    ],
  },
  {
    id: 'TC-14', ac: 'AC10', hls: 13,
    title: 'Expiry card displays the validity description from the dashboard verbatim',
    steps: [
      ...toDetails('BF Bakery 15% Off'),
      ['Scroll down to the "Expiry" card.', 'The "Expiry" card is displayed.'],
      ['Compare the text displayed in the "Expiry" card against the validity description configured for the perk on the card admin dashboard.', 'The text displayed matches the configured validity description exactly, character for character.'],
      ['Check whether the displayed value has been reformatted into a different date format from the configured text.', 'The value is displayed as the configured free text and has not been reformatted or replaced by a date derived from the perk end date.'],
    ],
  },
  {
    id: 'TC-15', ac: 'AC10', hls: 14,
    title: 'Perk with no validity description configured shows no Expiry value',
    steps: [
      ...toDetails('new discount perk 1'),
      ['Confirm on the card admin dashboard that no validity description is configured for this perk.', 'The perk has no validity description configured, although it does have an end date.'],
      ['Scroll through the whole details section to the end of the screen.', 'The end of the details section is reached.'],
      ['Check for an Expiry value on the Perk Details screen.', 'No validity text is displayed. The screen shows no Expiry value and does not display a date derived from the perk end date.'],
    ],
  },
  {
    id: 'TC-16', ac: 'AC11', hls: 15,
    title: 'Branches card is displayed when branches are configured',
    steps: [
      ...toDetails('RTE Buy 1 Get 1'),
      ['Confirm on the card admin dashboard that branches are configured for this perk.', 'The perk has branches configured.'],
      ['Locate the "Branches" card on the Perk Details screen.', 'The "Branches" card is displayed.'],
      ['Compare the branch lines displayed against the branches configured on the dashboard.', 'The branch lines displayed match the configured branches, each configured line rendered on its own line.'],
    ],
  },
  {
    id: 'TC-17', ac: 'AC11', hls: 16,
    title: 'Branches card is hidden when no branches are configured',
    steps: [
      ...toDetails('8% on All Spend'),
      ['Confirm on the card admin dashboard that no branches are configured for this perk.', 'The perk has no branches configured.'],
      ['Scroll through the whole details section from the top to the very end of the screen.', 'The end of the details section is reached and every card has been seen.'],
      ['Check whether a "Branches" card is displayed anywhere on the screen.', 'No "Branches" card is displayed. The card is hidden and leaves no empty placeholder in its place.'],
    ],
  },
  {
    id: 'TC-18', ac: 'AC12', hls: 17,
    title: 'Branches longer than 3 lines are truncated to 3 lines with a See more control that expands the section',
    steps: [
      ...toDetails('BF Bakery 15% Off'),
      ['Confirm on the card admin dashboard that more than 3 branch lines are configured for this perk.', 'The perk has 16 branch lines configured, each on its own line.'],
      ['Locate the "Branches" card and count the branch lines displayed.', 'Exactly 3 branch lines are displayed.'],
      ['Check the third displayed line for an expand control.', 'A "See more" control is displayed on the third line.'],
      ['Tap "See more".', 'The Branches card expands and displays all 16 configured branch lines, each on its own line.'],
      ['Check the expanded card for a collapse control.', 'A "See less" control is displayed.'],
    ],
  },
  {
    id: 'TC-19', ac: 'AC12', hls: 17,
    title: 'See less collapses the expanded Branches section back to 3 lines',
    steps: [
      ...toDetails('BF Bakery 15% Off'),
      ['Tap "See more" on the "Branches" card.', 'The Branches card expands to display all 16 configured branch lines and a "See less" control is displayed.'],
      ['Tap "See less".', 'The Branches card collapses.'],
      ['Count the branch lines displayed after collapsing.', 'Exactly 3 branch lines are displayed again.'],
      ['Check the third displayed line for the expand control.', 'The "See more" control is displayed again on the third line.'],
    ],
  },
  {
    id: 'TC-20', ac: 'AC12', hls: 18,
    title: 'Perk with exactly 3 branch lines displays all lines with no See more control',
    steps: [
      ...toDetails('new discount perk 1'),
      ['Confirm on the card admin dashboard that exactly 3 branch lines are configured for this perk.', 'The perk has exactly 3 branch lines configured.'],
      ['Locate the "Branches" card and count the branch lines displayed.', 'All 3 configured branch lines are displayed, each on its own line.'],
      ['Check the "Branches" card for a "See more" control.', 'No "See more" control is displayed, because the configured branches do not exceed 3 lines.'],
    ],
  },
  {
    id: 'TC-21', ac: 'AC13', hls: 19,
    title: 'Cashback processing card is displayed when a processing time is configured',
    steps: [
      ...toDetails('BF Bakery 15% Off'),
      ['Confirm on the card admin dashboard that a cashback processing time is configured for this perk.', 'The perk has a cashback processing description configured.'],
      ['Scroll to the "Cashback processing" card on the Perk Details screen.', 'The "Cashback processing" card is displayed.'],
      ['Compare the text displayed against the cashback processing description configured on the dashboard.', 'The text displayed matches the configured description exactly.'],
    ],
  },
  {
    id: 'TC-22', ac: 'AC13', hls: 19,
    title: 'Cashback processing card is hidden when no processing time is configured',
    steps: [
      ...toDetails('new discount perk 1'),
      ['Confirm on the card admin dashboard that no cashback processing time is configured for this perk.', 'The perk has no cashback processing description configured.'],
      ['Scroll through the whole details section from the top to the very end of the screen.', 'The end of the details section is reached and every card has been seen.'],
      ['Check whether a "Cashback processing" card is displayed anywhere on the screen.', 'No "Cashback processing" card is displayed. The card is hidden and leaves no empty placeholder in its place.'],
    ],
  },
  {
    id: 'TC-23', ac: 'AC1-AC13', hls: 20,
    title: 'Arabic build renders the five card labels in Arabic with correct right-to-left mirroring',
    locale: 'ar/EG only',
    steps: [
      ['Set the device language to Arabic (Egypt) and launch the Breadfast Pay build under test.', 'The app starts in Arabic with a right-to-left layout.'],
      ...LOGIN_STEPS.slice(0, 5).map(([s, r]) => [s, r]),
      ['Navigate to the Perks List and open the perk "BF Bakery 15% Off".', 'The Perk Details screen opens in Arabic.'],
      ['Read the label of each detail card from the top of the details section downwards.', 'The card labels are displayed in Arabic as "كود الكوبون", "الاستخدام", "الفروع", "الكاش باك" and "الصلاحية", in that order.'],
      ['Check the position of the back control in the header.', 'The back control is mirrored to the right-hand side of the header.'],
      ['Check the alignment of the card labels and the branch lines.', 'The labels and branch lines are right-aligned and the card layout is mirrored for right-to-left reading.'],
      ['Compare the content of the Usage, Branches, Cashback processing and Expiry cards against the Arabic values configured on the dashboard.', 'Each card displays the Arabic value configured for that field on the dashboard.'],
    ],
  },
];

// The uploader reads `pre` per case; this story keeps ONE shared precondition block, so attach it
// here rather than repeating it 23 times (and rather than letting it upload as "undefined").
cases.forEach((c) => { if (!c.pre) c.pre = PRE; });

/**
 * Risk-based priority. Set EXPLICITLY: leaving it undefined makes BrowserStack default every case to
 * "Medium", which then reads as a verification mismatch and, worse, gives a run no ordering signal.
 *
 * High  — the redesign's core structure (AC4/AC5) and the two NEW interactions (AC6/AC7 copy,
 *         AC8 bottom sheet, AC12 expand/collapse), plus the entry point every other case depends on.
 * Medium— content fidelity and the conditional show/hide branches.
 * Low   — none; every scenario here maps to an AC.
 */
const HIGH = new Set(['TC-01', 'TC-06', 'TC-07', 'TC-08', 'TC-09', 'TC-10', 'TC-11', 'TC-12', 'TC-18', 'TC-19', 'TC-23']);
cases.forEach((c) => { if (!c.priority) c.priority = HIGH.has(c.id) ? 'High' : 'Medium'; });

module.exports = { cases, ISSUES, PRE, LOGIN_STEPS, TO_LIST_STEPS, toDetails };

if (require.main === module) {
  const total = cases.reduce((a, c) => a + c.steps.length, 0);
  console.log(`${cases.length} test cases, ${total} steps (avg ${(total / cases.length).toFixed(1)})`);
  const byAc = {};
  cases.forEach((c) => c.ac.split(/[,\s]+/).filter(Boolean).forEach((a) => { byAc[a] = (byAc[a] || 0) + 1; }));
  console.log('AC coverage:', JSON.stringify(byAc));
  const hls = [...new Set(cases.map((c) => c.hls))].sort((a, b) => a - b);
  console.log(`HLS covered: ${hls.join(', ')} (${hls.length}/20)`);
  cases.forEach((c) => console.log(`  ${c.id}  ${String(c.ac).padEnd(9)} HLS${String(c.hls).padStart(2)}  ${c.steps.length} steps  ${c.title}`));
}
