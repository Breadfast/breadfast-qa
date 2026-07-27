'use strict';

/**
 * B10-57393 — offline parity check between the Java story class and BrowserStack.
 *
 * Every automated test's title must be the EXACT BrowserStack test-case name, because results are
 * mapped by name/@TmsLink (docs/ai/browserstack-process.md §10.7). This verifies that BEFORE a suite
 * is run, so a rename never silently detaches results from their case.
 *
 * Usage: node check_test_name_parity.js
 */
const fs = require('fs');
const path = require('path');

const JAVA_CLASS = 'D:/projects/src/test/java/cardService/adminPanel/B10_57393_AppPreviewModalTests.java';
const SPEC_DIR = path.resolve(__dirname, 'tests');
const CASE_MAP = path.resolve(__dirname, 'browserstack_case_map.json');

const src = fs.readFileSync(JAVA_CLASS, 'utf8');
const map = JSON.parse(fs.readFileSync(CASE_MAP, 'utf8'));

/**
 * Split the class into one block per test METHOD and read each block's description + @TmsLink
 * together.
 *
 * Do NOT collect the two as independent lists and zip them by index: a test with no @TmsLink
 * (there is one — the extra outside-merchant case, which has no BrowserStack case) shifts every
 * later pairing by one, and the check then reports 5 "TITLE MISMATCH" lines that are pure
 * artefacts of the zip while the real problem — a test bound to no case at all — is reduced to a
 * count warning. Pairing per method reports each fact where it happens.
 */
const methods = src.split(/(?=@Test\b)/).slice(1).map((block) => {
  // The framework's convention puts a bare class-level @Test above the class declaration too;
  // that block carries no description and no method, and is dropped below.
  const desc = block.match(/description = "((?:[^"\\]|\\.)*)"/);
  const link = block.match(/@TmsLink\("(TC-\d+)"\)/);
  const name = block.match(/(?:public|private|protected)\s+void\s+(\w+)/);
  return {
    description: desc ? desc[1].replace(/\\"/g, '"') : null,
    id: link ? link[1] : null,
    method: name ? name[1] : '(unnamed)',
  };
}).filter((m) => m.description || m.id);

const tmsLinks = methods.filter((m) => m.id).map((m) => m.id);

console.log(`java tests: ${methods.length} · @TmsLink annotations: ${tmsLinks.length}`
  + ` · BrowserStack cases: ${map.cases.length}`);

let failures = 0;
for (const m of methods) {
  if (!m.id) {
    // Not a parity failure: an extra test beyond the approved set is allowed, it just cannot sync.
    console.log(`  NOTE ${m.method}: no @TmsLink — results for this test cannot post to BrowserStack`);
    console.log(`      java: ${m.description}`);
    continue;
  }
  const bsCase = map.cases.find((c) => c.id === m.id);
  if (!bsCase) {
    console.log(`  ${m.id} (${m.method}): no such case in the uploaded folder`);
    failures++;
    continue;
  }
  if (bsCase.title !== m.description) {
    console.log(`  ${m.id} (${m.method}): TITLE MISMATCH`);
    console.log(`      java: ${m.description}`);
    console.log(`      bs  : ${bsCase.title}`);
    failures++;
  }
}

const duplicates = tmsLinks.filter((id, i) => tmsLinks.indexOf(id) !== i);
if (duplicates.length) {
  console.log(`  DUPLICATE @TmsLink: ${[...new Set(duplicates)].join(', ')} — one test per case`);
  failures += new Set(duplicates).size;
}

const automated = new Set(tmsLinks);
const notAutomated = map.cases.filter((c) => !automated.has(c.id));

console.log(failures
  ? `\nJAVA PARITY FAILURES: ${failures}`
  : '\nJAVA PARITY OK — every automated test title matches its BrowserStack case verbatim.');
console.log(`java automated ${automated.size}/${map.cases.length}`);
if (notAutomated.length) {
  console.log('not automated in Java:');
  notAutomated.forEach((c) => console.log(`  ${c.id}  ${c.title}`));
}

// ── Playwright specs — same contract, results map by test NAME (no @TmsLink) ──
const specTitles = [];
for (const file of fs.readdirSync(SPEC_DIR).filter((f) => f.endsWith('.spec.js'))) {
  const spec = fs.readFileSync(path.join(SPEC_DIR, file), 'utf8');
  // test('...') / test("...") — the title is the first argument
  for (const m of spec.matchAll(/\btest\(\s*(['"])((?:[^\\]|\\.)*?)\1\s*,/g)) {
    specTitles.push({ file, title: m[2].replace(/\\'/g, "'").replace(/\\"/g, '"') });
  }
}
const bsTitles = new Set(map.cases.map((c) => c.title));
const specMatched = specTitles.filter((t) => bsTitles.has(t.title));
const specOrphans = specTitles.filter((t) => !bsTitles.has(t.title));

console.log(`\nplaywright tests: ${specTitles.length} · matched to a BrowserStack case: ${specMatched.length}`);
if (specOrphans.length) {
  console.log('playwright titles with NO matching BrowserStack case:');
  specOrphans.forEach((t) => console.log(`  [${t.file}] ${t.title}`));
}
const specCovered = new Set(specMatched.map((t) => t.title));
const notInPlaywright = map.cases.filter((c) => !specCovered.has(c.title));
console.log(`playwright automated ${specCovered.size}/${map.cases.length}`);
if (notInPlaywright.length) {
  console.log('not automated in Playwright:');
  notInPlaywright.forEach((c) => console.log(`  ${c.id}  ${c.title}`));
}

const specFailures = specOrphans.length;
console.log(specFailures ? `\nPLAYWRIGHT PARITY FAILURES: ${specFailures}` : 'PLAYWRIGHT PARITY OK.');
process.exit(failures + specFailures ? 1 : 0);
