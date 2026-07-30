'use strict';

/**
 * Offline guard: every BrowserStack test-case name must appear VERBATIM as an
 * automated test title (or be explicitly declared as not-automated).
 *
 * Why this exists: the test run maps automated results onto BrowserStack cases by
 * NAME. If a name is edited on one side only, results silently land on the wrong
 * case — or not at all. This check catches that in a second, without a browser and
 * without touching the environment, so it can run any time (including when the
 * panel is down) and in CI before a suite is ever executed.
 *
 * 2026-07-27 (Selenium migration): the automated suite is now the Java class
 * B10_56750_AddSectionToPerksTests in the Breadfast Java framework, where each
 * title lives in @Test(description = "..."). This guard scans that class (framework
 * path resolved via automation/config/framework.js), falling back to any archived
 * *.spec.js. @TmsLink ids give an even stronger runtime join, but the description
 * must STILL match verbatim — it is what humans and reports correlate on.
 *
 * Usage:  node check_test_name_parity.js
 * Exit 0 = in sync, exit 1 = drift (prints exactly what drifted).
 */

const fs = require('fs');
const path = require('path');
const { cases } = require('./gen_browserstack_csv');
const framework = require('../../automation/config/framework');

const JAVA_TEST_CLASS = 'src/test/java/cardService/adminPanel/B10_56750_AddSectionToPerksTests.java';
const TESTS_DIR = path.join(__dirname, 'tests');

/**
 * Cases deliberately WITHOUT an automated test, and why. Anything not listed here
 * must have a matching test name.
 */
const NOT_AUTOMATED = new Map([
  [
    'Verify the design-specified seeded Sections "Food & Beverage" and "Fitness" are available',
    'Expectation RETRACTED — Sections are user-created content with no fixed expected set, so an absent '
      + 'section is not a defect (bug B10-58196 filed then withdrawn). Left as a manual/not-automated case.',
  ],
]);

const sources = [];
const frameworkPath = framework.resolve();
if (frameworkPath && fs.existsSync(path.join(frameworkPath, JAVA_TEST_CLASS))) {
  sources.push(path.join(frameworkPath, JAVA_TEST_CLASS));
} else if (fs.existsSync(TESTS_DIR)) {
  sources.push(...fs.readdirSync(TESTS_DIR)
    .filter((f) => f.endsWith('.spec.js'))
    .map((f) => path.join(TESTS_DIR, f)));
}
if (!sources.length) {
  console.error('No automation source found: neither the Java story class nor spec files exist.');
  process.exit(1);
}

// Java string literals escape quotes; unescape so titles containing "quotes"
// compare verbatim against the CSV titles.
const blob = sources
  .map((f) => fs.readFileSync(f, 'utf8'))
  .join('\n')
  .replace(/\\"/g, '"');
const specFiles = sources;

const missing = [];
const declared = [];
for (const c of cases) {
  if (NOT_AUTOMATED.has(c.title)) { declared.push(c.title); continue; }
  if (!blob.includes(c.title)) missing.push(c.title);
}

// Also flag stale declarations (a case name that no longer exists at all).
const titles = new Set(cases.map((c) => c.title));
const staleDeclarations = [...NOT_AUTOMATED.keys()].filter((t) => !titles.has(t));

console.log(`spec files            : ${specFiles.length}`);
console.log(`generated cases       : ${cases.length}`);
console.log(`declared not-automated: ${declared.length}`);
console.log(`expected automated    : ${cases.length - declared.length}`);

let bad = false;

if (missing.length) {
  bad = true;
  console.log(`\n✗ ${missing.length} case name(s) have NO verbatim Playwright test:`);
  missing.forEach((t) => console.log(`   ${t}`));
  console.log('\n  Fix by making the test title exactly equal to the case name, or by adding the case');
  console.log('  to NOT_AUTOMATED in this file with a reason.');
}

if (staleDeclarations.length) {
  bad = true;
  console.log(`\n✗ ${staleDeclarations.length} NOT_AUTOMATED entr(ies) no longer match any generated case:`);
  staleDeclarations.forEach((t) => console.log(`   ${t}`));
}

// Mojibake canary: these sequences mean a UTF-8 title was written through a
// non-UTF-8 codec somewhere (it happened — "→" became "â†’" — which silently
// breaks every name match while still looking almost right in a diff).
const MOJIBAKE = ['â†’', 'â€”', 'â€“', 'â€™', 'Â·'];
const mojibake = MOJIBAKE.filter((m) => blob.includes(m));
if (mojibake.length) {
  bad = true;
  console.log(`\n✗ mojibake found in spec files: ${JSON.stringify(mojibake)}`);
  console.log('  A title was re-encoded through the wrong codec. Repair the characters and re-check.');
}

if (bad) process.exit(1);
console.log('\n✓ every automatable case name matches a Playwright test name verbatim; no mojibake.');
