'use strict';
/**
 * B10-56717 — Perks List Screen Redesign · canonical test cases (single source of truth).
 *
 * Standard (`docs/ai/testing-process.md` §3.7): granular user-action steps — Login → Navigate →
 * Open → Act → Verify — with **every step carrying its own Expected Result**, navigation and
 * verification as explicit steps, never two actions combined in one step.
 *
 * Consumed by `upload_browserstack.js` (Test Management API v2) and by README.md's traceability
 * table, so the uploaded cases and the documentation cannot drift apart.
 *
 * SCOPE NOTES
 *  - AC14 (card order) is deliberately absent — out of scope per clarifications S-1; it is tracked by
 *    the operator's open bug B10-58360 and is reported as known-open, not re-tested.
 *  - The four combos are iOS + Android x en/US + ar/EG. Cases that are locale-specific say so in the
 *    title; the rest are run on all four.
 */

const ISSUES = 'B10-56717';

// Reusable preconditions.
const PRE_LIST = 'Breadfast Pay build under test installed. Test account 01064507660 (wallet Active, passcode 123321, Pay-access OTP = last 4 digits of the number). At least two sections on the admin dashboard each hold at least one active perk.';
const PRE_ADMIN = PRE_LIST + ' Card admin panel access (agent) to configure sections and perks.';

const LOGIN_STEPS = [
  ['Launch the Breadfast app and enter the test mobile number 01064507660 on the login screen.', 'The number is accepted and the app requests the login OTP.'],
  ['Enter the login OTP received for that number.', 'The OTP is accepted and the app opens the Home screen.'],
  ['Tap the "Pay" tab in the bottom navigation.', 'The Pay passcode screen is displayed.'],
  ['Enter the 6-digit passcode 123321.', 'The passcode is accepted and the Pay-access OTP screen is displayed.'],
  ['Enter the Pay-access OTP (the last 4 digits of the account mobile number).', 'The OTP is accepted and the Pay home screen is displayed.'],
];

const TO_LIST_STEPS = [
  ...LOGIN_STEPS,
  ['Scroll the Pay home screen down until the "Card perks" section header is visible.', 'The "Card perks" section header is displayed with a "See all" control beside it.'],
  ['Tap "See all" in the "Card perks" section.', 'The Perks List screen opens with the title "Card perks".'],
];

const cases = [
  {
    id: 'TC01',
    title: 'Perks List — open from Pay home and verify the screen renders the tab row above the perk grid',
    priority: 'Critical',
    description: 'Smoke path for the redesigned Perks List: reachable from Pay home and rendering both of its new components.',
    pre: PRE_LIST,
    acs: ['AC1'],
    steps: [
      ...TO_LIST_STEPS,
      ['Observe the area directly beneath the screen title.', 'A horizontal row of category tab pills is displayed above the perk grid.'],
      ['Observe the area beneath the tab row.', 'A category section header is displayed, followed by perk cards laid out two per row.'],
      ['Observe each perk card.', 'Each card shows a cover image, a circular logo overlay, a title and a subheader.'],
    ],
  },
  {
    id: 'TC02',
    title: 'Perks List — verify the first tab is selected by default and the grid lists every category one under the other',
    priority: 'Critical',
    description: 'AC4: default selection plus the continuous category-grouped grid (the grocery-style display), not a filtered single-category view.',
    pre: PRE_LIST,
    acs: ['AC4'],
    steps: [
      ...TO_LIST_STEPS,
      ['Observe which tab in the row is in the selected state.', 'The first tab ("Breadfast") is selected and no other tab is selected.'],
      ['Observe the first section header below the tab row.', 'The first section header matches the first tab ("Breadfast").'],
      ['Scroll the grid down past the end of the first category.', 'A second category section header is displayed, followed by that category\'s perk cards.'],
      ['Continue scrolling the grid to the bottom.', 'Every category that holds active perks appears in turn, each with its own header and cards, in one continuous scroll.'],
    ],
  },
  {
    id: 'TC03',
    title: 'Perks List — verify the active tab is visually distinguished from the inactive tabs',
    priority: 'High',
    description: 'AC3: filled pill for the active tab versus outlined pill for the inactive ones, and exactly one active tab at a time.',
    pre: PRE_LIST,
    acs: ['AC3'],
    steps: [
      ...TO_LIST_STEPS,
      ['Observe the selected tab.', 'The selected tab is drawn as a filled pill with a coloured label.'],
      ['Observe the unselected tabs.', 'Each unselected tab is drawn as an outlined pill with a neutral label.'],
      ['Count the tabs drawn in the selected style.', 'Exactly one tab is in the selected style.'],
      ['Tap a different tab in the row.', 'The tapped tab becomes the filled pill and the previously selected tab reverts to the outlined style.'],
    ],
  },
  {
    id: 'TC04',
    title: 'Perks List — verify tapping a category tab scrolls the grid to that category without filtering out the others',
    priority: 'Critical',
    description: 'AC5: the tab is a scroll-to control over one continuous list, so the other categories must remain present after the tap.',
    pre: PRE_LIST,
    acs: ['AC5'],
    steps: [
      ...TO_LIST_STEPS,
      ['Note the name of the first category section header.', 'The first category name is recorded.'],
      ['Tap the second tab in the tab row.', 'The grid scrolls so that the second category\'s section header is displayed directly beneath the tab row.'],
      ['Observe the content below the second category\'s cards.', 'The next category\'s section header and cards follow in the same scroll.'],
      ['Scroll the grid back up to the top.', 'The first category\'s section header and its perk cards are still present and are displayed again.'],
    ],
  },
  {
    id: 'TC05',
    title: 'Perks List — verify the tab row scrolls horizontally when the categories exceed the screen width',
    priority: 'High',
    description: 'AC2: horizontal overflow of the tab row, with no wrapping to a second line and no tab pushed out of reach.',
    pre: PRE_LIST + ' Enough sections hold active perks for the tab labels to exceed the screen width.',
    acs: ['AC2'],
    steps: [
      ...TO_LIST_STEPS,
      ['Observe the right-hand edge of the tab row (the left-hand edge in Arabic).', 'A further tab is partially visible at the edge, indicating the row continues beyond the screen.'],
      ['Swipe the tab row horizontally toward the end of the row.', 'The row scrolls horizontally and previously hidden tabs come into view.'],
      ['Observe the tab row layout while it is scrolled.', 'All tabs remain on a single line; the row does not wrap onto a second line.'],
      ['Swipe the tab row back to the start.', 'The row scrolls back and the first tab is displayed again.'],
    ],
  },
  {
    id: 'TC06',
    title: 'Perks List — verify a category with no active perks is hidden from the tab row and from the grid',
    priority: 'Critical',
    description: 'AC6, proven by enumeration: the tab row is swiped to its end and every label compared against the sections that actually hold active perks.',
    pre: PRE_ADMIN + ' At least one section exists that holds zero active perks.',
    acs: ['AC6'],
    steps: [
      ['Open the card admin panel and list the sections together with the perks assigned to each.', 'The list of sections is displayed and the sections holding at least one active perk can be identified.'],
      ['Record the name of a section that holds zero active perks.', 'The name of an empty section is recorded.'],
      ...TO_LIST_STEPS,
      ['Swipe the tab row to its far end and record every tab label seen along the way.', 'The complete set of tab labels is captured.'],
      ['Compare the captured tab labels against the sections that hold at least one active perk.', 'The tab labels match that set exactly, with no extra and no missing category.'],
      ['Search the captured tab labels for the recorded empty section name.', 'The empty section is not present in the tab row.'],
      ['Scroll the whole grid from top to bottom looking for the empty section name.', 'The empty section has no header and no cards anywhere in the grid.'],
    ],
  },
  {
    id: 'TC07',
    title: 'Perks List — verify the tab row reflects a section newly enabled on the admin dashboard',
    priority: 'High',
    description: 'AC7: the tab list is driven by the sections configured and enabled on the dashboard.',
    pre: PRE_ADMIN,
    acs: ['AC7'],
    steps: [
      ['Open the card admin panel and create a new section with a distinctive English and Arabic name.', 'The section is created and appears in the section list.'],
      ...TO_LIST_STEPS,
      ['Swipe the tab row to its end looking for the new section name.', 'The new section is absent from the tab row because it holds no active perks.'],
      ['Return to the admin panel and assign an active perk to the new section.', 'The perk is saved with the new section assigned.'],
      ['Close the app completely and relaunch it, then navigate back to the Perks List.', 'The Perks List is displayed again.'],
      ['Swipe the tab row to its end looking for the new section name.', 'The new section is now present in the tab row.'],
      ['Tap the new section\'s tab.', 'The grid scrolls to the new section\'s header and shows the perk assigned to it.'],
    ],
  },
  {
    id: 'TC08',
    title: 'Perks List — verify every perk card renders its cover image filling the card area',
    priority: 'High',
    description: 'AC8: no broken, blank or placeholder image where a cover photo is configured.',
    pre: PRE_ADMIN,
    acs: ['AC8'],
    steps: [
      ['Open the card admin panel and confirm the active perks under test each have a cover photo configured.', 'Each perk under test has a cover photo configured.'],
      ...TO_LIST_STEPS,
      ['Observe the cover area of each card in the first category.', 'Each cover image fills the width of the card area edge to edge, with no letterboxing.'],
      ['Scroll the grid to the bottom, observing every card.', 'No card shows a broken-image glyph, an empty grey box, or a placeholder in place of its cover.'],
    ],
  },
  {
    id: 'TC09',
    title: 'Perks List — verify the circular logo overlay is shown at the bottom centre of each cover image',
    priority: 'High',
    description: 'AC9: circular logo, bottom-centre of the cover, with the Breadfast logo for Breadfast perks, the merchant logo for merchant perks and the configured logo for general or category perks.',
    pre: PRE_ADMIN,
    acs: ['AC9'],
    steps: [
      ...TO_LIST_STEPS,
      ['Observe the logo on a perk card in the Breadfast section.', 'A circular logo is displayed, horizontally centred and overlapping the bottom edge of the cover image, showing the Breadfast logo.'],
      ['Scroll to a merchant perk card and observe its logo.', 'A circular logo is displayed in the same position, showing that merchant\'s logo.'],
      ['Scroll to a general or category perk card and observe its logo.', 'A circular logo is displayed in the same position, showing the logo configured for that perk.'],
      ['Compare the logo position across the cards observed.', 'Every logo sits in the same bottom-centre position relative to its cover image.'],
    ],
  },
  {
    id: 'TC10',
    title: 'Perks List — verify the perk amount and its subheader are displayed below the cover on every card',
    priority: 'High',
    description: 'AC10: the amount as the card title with the subheader directly beneath it.',
    pre: PRE_LIST,
    acs: ['AC10'],
    steps: [
      ...TO_LIST_STEPS,
      ['Observe the text block below the cover image of the first card.', 'The perk amount is displayed as the card title, in a heavier weight than the line below it.'],
      ['Observe the line directly below the card title.', 'The subheader is displayed in a lighter weight beneath the title.'],
      ['Observe the horizontal alignment of the title and the subheader.', 'Both lines are centred within the card.'],
      ['Locate a perk whose title is longer than the card width.', 'The title is shortened with an ellipsis on a single line and does not wrap or overflow the card.'],
    ],
  },
  {
    id: 'TC11',
    title: 'Perks List — verify the subheader matches its source for merchant, category, Breadfast and general perks',
    priority: 'Critical',
    description: 'AC11: merchant perks show the brand or merchant name, category perks the benefit category, and Breadfast or general perks the configured custom text.',
    pre: PRE_ADMIN + ' At least one active perk of each type exists: merchant cashback, category cashback, general cashback and a Breadfast perk with custom subheader text.',
    acs: ['AC11'],
    steps: [
      ['Open the card admin panel and record, for one perk of each type, the merchant name, the benefit category and the configured subheader text.', 'The expected subheader value for each perk under test is recorded.'],
      ...TO_LIST_STEPS,
      ['Locate the merchant cashback perk and read its subheader.', 'The subheader shows that perk\'s brand or merchant name.'],
      ['Locate the category cashback perk and read its subheader.', 'The subheader shows that perk\'s benefit category.'],
      ['Locate the Breadfast perk and read its subheader.', 'The subheader shows the custom text configured for that perk on the dashboard.'],
      ['Locate the general cashback perk and read its subheader.', 'The subheader shows the custom text configured for that perk on the dashboard.'],
    ],
  },
  {
    id: 'TC12',
    title: 'Perks List — verify cards are laid out two per row with both cards in a row sharing the same height',
    priority: 'Critical',
    description: 'AC12 against the Figma card specs: two columns, dynamic card width, and "card height follows the card next to it" when the two cards carry different amounts of text.',
    pre: PRE_ADMIN + ' One perk has a subheader long enough to wrap onto two lines and its neighbour in the grid has a single-line subheader.',
    acs: ['AC12'],
    steps: [
      ...TO_LIST_STEPS,
      ['Observe how many cards are displayed per row.', 'Exactly two cards are displayed per row.'],
      ['Compare the two cards in a row where one subheader wraps onto two lines and the other does not.', 'Both cards have the same total height; the shorter card gains empty space beneath its subheader rather than shrinking.'],
      ['Compare the left and right card widths and the gap between them.', 'Both cards have equal width and are separated by a consistent gap, together filling the screen width.'],
      ['Scroll to a category that holds an odd number of perks and observe its last row.', 'The final card occupies one column at its normal width and does not stretch across the row.'],
    ],
  },
  {
    id: 'TC13',
    title: 'Perks List — verify tapping a perk card opens the Perk Details screen for that same perk',
    priority: 'Critical',
    description: 'AC13: navigation from a card to its own details, and returning to the list afterwards.',
    pre: PRE_LIST,
    acs: ['AC13'],
    steps: [
      ...TO_LIST_STEPS,
      ['Record the title and the subheader of the first perk card.', 'The identity of the perk to be opened is recorded.'],
      ['Tap that perk card.', 'The Perk Details screen opens.'],
      ['Compare the title shown on the Perk Details screen with the recorded card title.', 'The details screen shows the same perk that was tapped.'],
      ['Navigate back from the Perk Details screen.', 'The Perks List is displayed again with the tab row and the perk grid.'],
    ],
  },
  {
    id: 'TC14',
    title: 'Perks List — verify the screen is fully mirrored in Arabic with the tab row anchored to the right',
    priority: 'Critical',
    description: 'Arabic and RTL correctness for the redesigned screen. Run on the ar/EG combos only.',
    pre: PRE_LIST + ' The device language is Arabic (ar) and the region is Egypt (EG).',
    acs: ['AC1', 'AC3', 'AC4', 'AC10', 'AC12'],
    locale: 'ar',
    steps: [
      ...TO_LIST_STEPS,
      ['Observe the screen title and the back control.', 'The title is displayed in Arabic and the back control is positioned on the right-hand side of the header.'],
      ['Observe the tab row.', 'The tab row starts at the right-hand edge with the first (selected) tab on the right, and further tabs continue toward the left.'],
      ['Swipe the tab row toward the left to reveal the remaining tabs.', 'The row scrolls in the mirrored direction and the remaining tabs come into view.'],
      ['Observe the section headers and the order of the cards in a row.', 'Section headers are right-aligned and the first card of each row is on the right.'],
      ['Read the section names, perk titles and subheaders.', 'All three are displayed in Arabic using the Arabic values configured on the dashboard.'],
    ],
  },
  {
    id: 'TC15',
    title: 'Perks List — verify the Arabic locale uses the Arabic cover photo and logo where they are configured',
    priority: 'Medium',
    description: 'Localisation of the card artwork, per the mobile API contract on the ticket which supplies cover_photo_ar and logo_ar. Run on the ar/EG combos only.',
    pre: PRE_ADMIN + ' At least one active perk has an Arabic cover photo and an Arabic logo that are visibly different from its English ones. The device language is Arabic.',
    acs: ['AC8', 'AC9'],
    locale: 'ar',
    steps: [
      ['Open the card admin panel and note the English and Arabic cover photo and logo configured for the perk under test.', 'The two sets of artwork are noted and are visibly different from each other.'],
      ['Open the Perks List with the device language set to English and observe that perk\'s card.', 'The card shows the English cover photo and the English logo.'],
      ['Change the device language to Arabic, relaunch the app and open the Perks List again.', 'The Perks List is displayed in Arabic.'],
      ['Observe the same perk\'s card.', 'The card shows the Arabic cover photo and the Arabic logo rather than the English artwork.'],
    ],
  },
  {
    id: 'TC16',
    title: 'Perks List — verify the tab row stays pinned to the top while the perk grid scrolls beneath it',
    priority: 'High',
    description: 'AC1: the tab row is sticky, so it must remain visible and usable at any scroll position.',
    pre: PRE_LIST,
    acs: ['AC1'],
    steps: [
      ...TO_LIST_STEPS,
      ['Note the vertical position of the tab row.', 'The tab row is displayed directly beneath the screen title.'],
      ['Scroll the perk grid down by roughly one screen.', 'The perk cards scroll upward and are clipped beneath the tab row, while the tab row itself stays in the same position.'],
      ['Scroll the perk grid to the bottom of the list.', 'The tab row is still displayed in the same position at the top of the screen.'],
      ['Tap a tab while the grid is scrolled to the bottom.', 'The tab responds and the grid scrolls to the corresponding category.'],
    ],
  },
  {
    id: 'TC17',
    title: 'Pay home perks carousel — verify it is unaffected by the Perks List redesign',
    priority: 'Critical',
    description: 'Regression guard: the Pay home carousel consumes the same perks endpoint as the Perks List, so a change to that endpoint reaches both screens.',
    pre: PRE_LIST + ' More than five active perks exist.',
    acs: [],
    steps: [
      ...LOGIN_STEPS,
      ['Scroll the Pay home screen down to the "Card perks" section.', 'The section header "Card perks" is displayed with a "See all" control beside it.'],
      ['Observe the perk cards in the carousel.', 'Each card shows a cover image, a circular logo, a title and a subheader.'],
      ['Swipe the carousel to its end and count the cards.', 'The carousel contains at most five perk cards and no trailing "See all" tile.'],
      ['Tap the first card in the carousel.', 'The Perk Details screen for that perk opens.'],
      ['Navigate back, then tap "See all".', 'The Perks List screen opens.'],
    ],
  },
  {
    id: 'TC18',
    title: 'Perks List — verify the grid scrolls through the full list without blank, duplicated or missing cards',
    priority: 'Medium',
    description: 'Stability of an image-heavy grid: the redesign replaces text rows with two remote images per card.',
    pre: PRE_LIST + ' The environment holds enough active perks for the list to scroll over several screens.',
    acs: [],
    steps: [
      ...TO_LIST_STEPS,
      ['Scroll the grid steadily from the top to the bottom of the list.', 'Cards render continuously; no card is left blank and no card appears twice.'],
      ['Scroll back from the bottom to the top of the list.', 'The same categories and cards are displayed again in the same order.'],
      ['Record the total number of distinct perk cards displayed.', 'The number matches the number of active perks assigned to the categories shown in the tab row.'],
      ['Remain on the screen while the whole list is scrolled once more.', 'The app does not crash, freeze or return to Pay home.'],
    ],
  },
];

module.exports = { cases, ISSUES };

if (require.main === module) {
  const total = cases.reduce((n, c) => n + c.steps.length, 0);
  console.log(`${cases.length} cases, ${total} steps (avg ${(total / cases.length).toFixed(1)})`);
  cases.forEach((c) => console.log(`  ${c.id} [${c.priority}] ${c.steps.length} steps · AC ${c.acs.join(',') || '—'}${c.locale ? ' · ' + c.locale + ' only' : ''}  ${c.title.slice(0, 70)}`));
}
