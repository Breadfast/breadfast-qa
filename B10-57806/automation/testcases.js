'use strict';
/**
 * B10-57806 — canonical test-case data. ONE source for: the markdown artifact, the BrowserStack upload,
 * and the automation's @TmsLink/@Test(description) titles. Names here are the exact BrowserStack case
 * names (browserstack-process.md §10.7 — results map by name, so they must match verbatim).
 *
 * Dates are never literals. Steps refer to the named cases in `expiry-dates.js`, which derive every date
 * from the DEVICE clock at run time, so a case reads the same on any calendar day.
 */

const P = { crit: 'Critical', high: 'High', med: 'Medium', low: 'Low' };

/** Shared prelude: reach step 2 of 3 with the form filled but the expiry date not yet entered. */
const reachStep2 = (locale) => [
  { step: `Launch the Breadfast app on a device set to ${locale} and log in with a test account that has a consumed BCard invitation code and has NOT yet applied for a card.`, result: 'The app opens on the Home screen and the bottom navigation bar is displayed.' },
  { step: 'Tap the "Pay" tab in the bottom navigation bar.', result: 'The Pay screen opens showing the wallet balance and the BCard application stepper with step "1 Application".' },
  { step: 'Tap "Apply" on the "1 Application" step.', result: 'The "Apply for your card" introduction screen is displayed.' },
  { step: 'Tap "Next".', result: 'Step 1 of 3 opens showing "Verify your mobile number" and the progress indicator reads 1/3.' },
  { step: 'Enter the card application OTP (the last 4 digits of the account mobile number).', result: 'The OTP is accepted and step 2 of 3 "Enter your ID information" opens with the progress indicator reading 2/3.' },
  { step: 'Enter a valid Arabic first name and remaining name, and a Luhn-valid National ID that has not been used by a previous application.', result: 'All three fields accept the input and no validation error is displayed.' },
];

const cases = [
  {
    id: 'TC01', name: 'Warning modal is shown for a National ID expiring within 2 months', priority: P.crit, hls: [1], acs: ['AC-1'],
    dataCase: 'wellInside',
    steps: [
      ...reachStep2('English'),
      { step: 'Enter a National ID expiry date approximately one month from the current device date into the "National ID expiry date" field.', result: 'The field displays the date in DD / MM / YYYY format and the "Submit" button becomes enabled.' },
      { step: 'Tap "Submit".', result: 'The "Renew ID before pickup" warning modal is displayed over the ID information screen.' },
      { step: 'Read the modal content.', result: 'The modal shows an amber alert icon, the title "Renew ID before pickup", the body "Your ID expires soon. Renew it before picking up your card to avoid any issues.", a primary "Continue" button and a secondary "Go back" button, in that order.' },
    ],
  },
  {
    id: 'TC02', name: 'Warning modal is shown one day inside the 2-month boundary', priority: P.crit, hls: [2], acs: ['AC-1'],
    dataCase: 'boundaryMinus1',
    steps: [
      ...reachStep2('English'),
      { step: 'Enter an expiry date of (current device date + 2 calendar months, clamped to the end of the month) minus one day.', result: 'The field displays the computed date in DD / MM / YYYY format.' },
      { step: 'Tap "Submit".', result: 'The "Renew ID before pickup" warning modal is displayed.' },
    ],
  },
  {
    id: 'TC03', name: 'No warning is shown one day outside the 2-month boundary', priority: P.crit, hls: [3], acs: ['AC-4'],
    dataCase: 'boundaryPlus1',
    steps: [
      ...reachStep2('English'),
      { step: 'Enter an expiry date of (current device date + 2 calendar months, clamped to the end of the month) plus one day.', result: 'The field displays the computed date in DD / MM / YYYY format.' },
      { step: 'Tap "Submit".', result: 'No warning modal is displayed and step 3 of 3 "Complete card setup" opens with the progress indicator reading 3/3.' },
    ],
  },
  {
    id: 'TC04', name: 'No warning is shown for a far future National ID expiry date', priority: P.crit, hls: [4], acs: ['AC-4'],
    dataCase: 'farFuture',
    steps: [
      ...reachStep2('English'),
      { step: 'Enter an expiry date approximately two years from the current device date.', result: 'The field displays the computed date in DD / MM / YYYY format.' },
      { step: 'Tap "Submit".', result: 'No warning modal is displayed and step 3 of 3 "Complete card setup" opens directly with no interruption.' },
    ],
  },
  {
    id: 'TC05', name: 'Continue on the warning modal proceeds to step 3 of 3', priority: P.crit, hls: [5], acs: ['AC-2'],
    dataCase: 'wellInside',
    steps: [
      ...reachStep2('English'),
      { step: 'Enter an expiry date approximately one month from the current device date and tap "Submit".', result: 'The "Renew ID before pickup" warning modal is displayed.' },
      { step: 'Tap "Continue" on the warning modal.', result: 'The modal closes and step 3 of 3 "Complete card setup" opens with the progress indicator reading 3/3 and a "Next" button.' },
    ],
  },
  {
    id: 'TC06', name: 'Go back on the warning modal returns to the ID information step with the entered data preserved', priority: P.crit, hls: [6], acs: ['AC-3'],
    dataCase: 'wellInside',
    steps: [
      ...reachStep2('English'),
      { step: 'Enter an expiry date approximately one month from the current device date and tap "Submit".', result: 'The "Renew ID before pickup" warning modal is displayed.' },
      { step: 'Tap "Go back" on the warning modal.', result: 'The modal closes and the "Enter your ID information" screen is displayed with the progress indicator still reading 2/3.' },
      { step: 'Inspect the four input fields.', result: 'The first name, remaining name, National ID and National ID expiry date all still contain exactly the values entered before Submit was tapped.' },
    ],
  },
  {
    id: 'TC07', name: 'Swiping the warning modal down returns to the ID information step', priority: P.high, hls: [7], acs: ['AC-3'],
    dataCase: 'wellInside',
    steps: [
      ...reachStep2('English'),
      { step: 'Enter an expiry date approximately one month from the current device date and tap "Submit".', result: 'The "Renew ID before pickup" warning modal is displayed with a drag handle at the top.' },
      { step: 'Swipe the modal downwards from its drag handle.', result: 'The modal is dismissed, the "Enter your ID information" screen is displayed, the progress indicator still reads 2/3 and the flow has not advanced.' },
    ],
  },
  {
    id: 'TC08', name: 'Tapping outside the warning modal returns to the ID information step', priority: P.high, hls: [7], acs: ['AC-3'],
    dataCase: 'wellInside',
    steps: [
      ...reachStep2('English'),
      { step: 'Enter an expiry date approximately one month from the current device date and tap "Submit".', result: 'The "Renew ID before pickup" warning modal is displayed over a dimmed background.' },
      { step: 'Tap the dimmed area outside the modal.', result: 'The modal is dismissed, the "Enter your ID information" screen is displayed and the flow has not advanced to step 3 of 3.' },
    ],
  },
  {
    id: 'TC09', name: 'Android hardware back on the warning modal does not advance the flow', priority: P.high, hls: [8], acs: ['AC-3'], platform: 'Android only',
    dataCase: 'wellInside',
    steps: [
      ...reachStep2('English'),
      { step: 'Enter an expiry date approximately one month from the current device date and tap "Submit".', result: 'The "Renew ID before pickup" warning modal is displayed.' },
      { step: 'Press the Android hardware back button.', result: 'The modal is dismissed and the "Enter your ID information" screen is displayed with the progress indicator reading 2/3.' },
      { step: 'Inspect the four input fields and the progress indicator.', result: 'All entered values are preserved and the flow has not advanced to step 3 of 3.' },
    ],
  },
  {
    id: 'TC10', name: 'No card application is created when the warning modal is dismissed', priority: P.high, hls: [9], acs: ['AC-3'],
    dataCase: 'wellInside',
    steps: [
      ...reachStep2('English'),
      { step: 'Enter an expiry date approximately one month from the current device date and tap "Submit".', result: 'The "Renew ID before pickup" warning modal is displayed.' },
      { step: 'Tap "Go back" and then navigate back out of the card application flow to the Pay screen.', result: 'The Pay screen is displayed.' },
      { step: 'Inspect the BCard application stepper on the Pay screen.', result: 'The stepper still shows step "1 Application" with an "Apply" action, confirming that no card application was created.' },
      { step: 'Re-enter the application flow with the same account.', result: 'Step 2 of 3 "Enter your ID information" can be reached again, confirming the account was not consumed.' },
    ],
  },
  {
    id: 'TC11', name: 'Warning modal is displayed in Arabic with localized button labels', priority: P.crit, hls: [10], acs: ['AC-5'],
    dataCase: 'wellInside',
    steps: [
      ...reachStep2('Arabic'),
      { step: 'Enter an expiry date approximately one month from the current device date and tap "إرسال".', result: 'The Arabic warning modal is displayed.' },
      { step: 'Read the modal title and body.', result: 'The title reads "جدد بطاقتك قبل الاستلام" and the body reads "بطاقتك ستنتهي قريباً. جددها قبل استلام الكارت لتجنب أي مشاكل.".' },
      { step: 'Read the two action buttons.', result: 'The primary button reads "متابعة" and the secondary button reads "الرجوع"; no English text is present anywhere in the modal.' },
      { step: 'Inspect the text layout and rendering.', result: 'All Arabic text renders right-to-left with correct shaping and no truncated, clipped or overlapping text.' },
    ],
  },
  {
    id: 'TC12', name: 'Behaviour when the entered National ID expiry date is already in the past', priority: P.high, hls: [11], acs: [], note: 'No AC and no design frame cover this case — REPORT the observed behaviour, do not fail the case.',
    dataCase: 'alreadyExpired',
    steps: [
      ...reachStep2('English'),
      { step: 'Enter an expiry date approximately one month BEFORE the current device date.', result: 'The field displays the past date in DD / MM / YYYY format.' },
      { step: 'Tap "Submit" and observe the result.', result: 'Record the observed behaviour: whether a blocking validation error is shown, the advisory warning modal is shown, or the flow proceeds to step 3 of 3. No acceptance criterion defines this case, so the observation is reported to product rather than judged pass or fail.' },
    ],
  },
  {
    id: 'TC13', name: 'Warning modal is shown when the National ID expires on the current date', priority: P.med, hls: [12], acs: ['AC-1'],
    dataCase: 'expiresToday',
    steps: [
      ...reachStep2('English'),
      { step: 'Enter an expiry date equal to the current device date.', result: 'The field displays the current date in DD / MM / YYYY format.' },
      { step: 'Tap "Submit".', result: 'The "Renew ID before pickup" warning modal is displayed and the date is not treated as already expired.' },
    ],
  },
  {
    id: 'TC14', name: 'Warning modal is shown again when Submit is tapped a second time with an unchanged date', priority: P.med, hls: [13], acs: ['AC-1'],
    dataCase: 'wellInside',
    steps: [
      ...reachStep2('English'),
      { step: 'Enter an expiry date approximately one month from the current device date and tap "Submit".', result: 'The "Renew ID before pickup" warning modal is displayed.' },
      { step: 'Tap "Go back".', result: 'The modal closes and the "Enter your ID information" screen is displayed with the date unchanged.' },
      { step: 'Tap "Submit" again without changing any field.', result: 'The "Renew ID before pickup" warning modal is displayed again.' },
    ],
  },
  {
    id: 'TC15', name: 'Changing the expiry date to outside the window after dismissing the modal proceeds without a warning', priority: P.high, hls: [14], acs: ['AC-3', 'AC-4'],
    dataCase: 'wellInside -> boundaryPlus1',
    steps: [
      ...reachStep2('English'),
      { step: 'Enter an expiry date approximately one month from the current device date and tap "Submit".', result: 'The "Renew ID before pickup" warning modal is displayed.' },
      { step: 'Tap "Go back".', result: 'The "Enter your ID information" screen is displayed with the entered data preserved.' },
      { step: 'Clear the expiry date and enter a date one day beyond (current device date + 2 calendar months, clamped).', result: 'The field displays the new date in DD / MM / YYYY format.' },
      { step: 'Tap "Submit".', result: 'No warning modal is displayed and step 3 of 3 "Complete card setup" opens.' },
    ],
  },
  {
    id: 'TC16', name: 'Entered ID data is preserved when the warning modal opens while the keypad is displayed', priority: P.high, hls: [15], acs: ['AC-1', 'AC-3'],
    dataCase: 'wellInside',
    steps: [
      ...reachStep2('English'),
      { step: 'Tap the "National ID expiry date" field and enter an expiry date approximately one month from the current device date, leaving the numeric keypad open.', result: 'The date is displayed in the field and the numeric keypad remains visible.' },
      { step: 'Tap "Submit" while the keypad is still open.', result: 'The numeric keypad is dismissed and the "Renew ID before pickup" warning modal is displayed without any visual overlap or clipping.' },
      { step: 'Tap "Go back" and inspect every field.', result: 'All four field values are unchanged and no field has lost focus state, been cleared or been corrupted.' },
    ],
  },
  {
    id: 'TC17', name: 'Progress indicator remains 2/3 while the warning modal is shown', priority: P.med, hls: [16], acs: ['AC-1', 'AC-2'],
    dataCase: 'wellInside',
    steps: [
      ...reachStep2('English'),
      { step: 'Enter an expiry date approximately one month from the current device date and tap "Submit".', result: 'The warning modal is displayed and the progress indicator behind it still reads 2/3.' },
      { step: 'Tap "Continue".', result: 'The progress indicator changes to 3/3 exactly once and step 3 of 3 is displayed; the flow does not advance more than one step.' },
    ],
  },
  {
    id: 'TC18', name: 'iOS and Android show the same warning decision for the same expiry date', priority: P.crit, hls: [17], acs: ['AC-1', 'AC-4'],
    dataCase: 'boundaryMinus1 + boundaryExact + boundaryPlus1',
    steps: [
      { step: 'On Android, reach step 2 of 3 and submit an expiry date of (current device date + 2 calendar months, clamped) minus one day.', result: 'Record whether the warning modal is displayed.' },
      { step: 'On Android, submit an expiry date of exactly (current device date + 2 calendar months, clamped).', result: 'Record whether the warning modal is displayed.' },
      { step: 'On Android, submit an expiry date of (current device date + 2 calendar months, clamped) plus one day.', result: 'Record whether the warning modal is displayed.' },
      { step: 'Repeat all three submissions on iOS using the same device date and the same three computed dates.', result: 'Record whether the warning modal is displayed for each.' },
      { step: 'Compare the two sets of results.', result: 'iOS and Android produce an identical warn / no-warn decision for all three dates.' },
    ],
  },
  {
    id: 'TC19', name: 'Warning modal matches the approved design in English and Arabic', priority: P.high, hls: [18], acs: ['AC-1', 'AC-5'],
    dataCase: 'wellInside',
    steps: [
      ...reachStep2('English'),
      { step: 'Enter an expiry date approximately one month from the current device date, tap "Submit" and capture the modal.', result: 'The English modal is captured.' },
      { step: 'Compare the captured English modal against Figma frame 7544:791.', result: 'The alert icon, title, body copy, button labels, button order and primary/secondary styling all match the approved design.' },
      { step: 'Repeat the capture with the app language set to Arabic and compare against Figma frame 7544:855.', result: 'The Arabic modal matches the approved design including both localized button labels; the known 10 pt height difference caused by the longer Arabic body text is expected and is not a defect.' },
    ],
  },
  {
    id: 'TC20', name: 'BCard application completes end to end after the warning modal is accepted', priority: P.crit, hls: [19], acs: ['AC-2'],
    dataCase: 'wellInside',
    steps: [
      ...reachStep2('English'),
      { step: 'Enter an expiry date approximately one month from the current device date and tap "Submit".', result: 'The "Renew ID before pickup" warning modal is displayed.' },
      { step: 'Tap "Continue".', result: 'Step 3 of 3 "Complete card setup" is displayed.' },
      { step: 'Tap "Next" and create a 6-digit passcode.', result: 'The passcode creation screen accepts the passcode and asks for confirmation.' },
      { step: 'Re-enter the same passcode to confirm.', result: 'The confirmation is accepted and the application completes.' },
      { step: 'Observe the final screen and then return to the Pay tab.', result: 'The congratulations screen is displayed and the Pay screen stepper has advanced past "1 Application", confirming the application was created.' },
    ],
  },
];

module.exports = { cases };

if (require.main === module) {
  const fs = require('fs');
  const totalSteps = cases.reduce((n, c) => n + c.steps.length, 0);
  const lines = [
    '# Test Cases — B10-57806 (ID Expiry Warning at BCard Sign-Up)', '',
    '**Generated from** [`../automation/testcases.js`](../automation/testcases.js) — the single source shared by this',
    'document, the BrowserStack upload and the automation titles, so the three cannot drift apart.', '',
    `**${cases.length} cases / ${totalSteps} steps** · Scope: iOS + Android × EN + AR · Destination: BrowserStack **PR-5** folder **53445037**`, '',
    '> **Dates are never literals.** Every expiry date is described relative to the *current device date* and is',
    '> computed at run time by [`../automation/expiry-dates.js`](../automation/expiry-dates.js), so a case gives the',
    '> same verdict on any calendar day. A hard-coded date would rot within weeks and start passing by accident.', '',
    '| # | Case | Priority | HLS | ACs |', '|---|---|---|---|---|',
    ...cases.map((c) => `| ${c.id} | ${c.name} | ${c.priority} | ${(c.hls || []).join(', ')} | ${(c.acs || []).join(', ') || '—'} |`),
    '', '---', '',
  ];
  for (const c of cases) {
    lines.push(`## ${c.id} — ${c.name}`, '');
    lines.push(`**Priority:** ${c.priority} · **HLS:** ${(c.hls || []).join(', ')} · **ACs:** ${(c.acs || []).join(', ') || 'none — see note'}${c.platform ? ` · **Platform:** ${c.platform}` : ''}`);
    lines.push(`**Test data case:** \`${c.dataCase}\` (derived from the device clock)`, '');
    if (c.note) lines.push(`> ⚠️ ${c.note}`, '');
    lines.push('| # | Step | Expected Result |', '|---|---|---|');
    c.steps.forEach((s, i) => lines.push(`| ${i + 1} | ${s.step} | ${s.result} |`));
    lines.push('');
  }
  fs.mkdirSync('d:/breadfast-qa/B10-57806/testcases', { recursive: true });
  fs.writeFileSync('d:/breadfast-qa/B10-57806/testcases/test-cases.md', lines.join('\n'));
  console.log(`wrote ${cases.length} cases / ${totalSteps} steps -> B10-57806/testcases/test-cases.md`);
}
