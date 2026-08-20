'use strict';

/**
 * Offline parity check between a story's Java test class and BrowserStack.
 *
 * Rule (CLAUDE.md §8): every automated test's @Test(description = ...) must be the EXACT
 * BrowserStack test-case name, and its @TmsLink must be that case's id — otherwise results
 * map onto the wrong case, or onto nothing.
 *
 * Run: node automation/browserstack/check_tmslink_parity.js --project PR-5 --class <path to the story's Tests.java>
 *      (exits 1 on any mismatch)
 */

const fs = require('fs');
const path = require('path');
const creds = require('../config/credentials.js');

// Promoted 2026-08-10 out of a story folder — the project is an argument now.
const argOf = (n, d) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : d; };
const PROJECT = argOf('--project');
// --class was hardcoded to B10-57771's file when this was promoted, so every later story ran the check
// against the WRONG class — and on a machine where that file no longer exists it just died with ENOENT
// (found on B10-57777). The story's class is an argument like the project.
const TEST_CLASS = argOf('--class');
if (!PROJECT) {
  console.error('check_tmslink_parity: missing --project <PR-x> (the project identifier from the shared folder link).');
  process.exit(1);
}
if (!TEST_CLASS) {
  console.error('check_tmslink_parity: missing --class <path to the story test class>, e.g.\n'
    + '  --class D:\\projects\\src\\test\\java\\cardService\\adminPanel\\B10_57777_CategoriesManagementTests.java');
  process.exit(1);
}
if (!fs.existsSync(TEST_CLASS)) {
  console.error(`check_tmslink_parity: no such test class: ${TEST_CLASS}`);
  process.exit(1);
}
const BASE = 'https://test-management.browserstack.com/api/v2';
const AUTH = 'Basic ' + Buffer.from(`${creds.browserstack.tmUsername()}:${creds.browserstack.tmApiToken()}`).toString('base64');

/** Pull (description, tmsLink) pairs out of the Java source, in file order. */
function parseJavaTests(source) {
  const found = [];
  // description = "..." possibly spanning lines, then @TmsLink("TC-xxxxx")
  const re = /description\s*=\s*"((?:[^"\\]|\\.)*)"[\s\S]*?@TmsLink\("([^"]+)"\)/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    found.push({ description: m[1].replace(/\\"/g, '"'), tmsLink: m[2] });
  }
  return found;
}

(async () => {
  const source = fs.readFileSync(TEST_CLASS, 'utf8');
  const tests = parseJavaTests(source);
  console.log(`parsed ${tests.length} @TmsLink-bound tests from ${path.basename(TEST_CLASS)}\n`);

  const problems = [];

  // duplicate @TmsLink ids would silently overwrite each other's result
  const seen = new Map();
  tests.forEach((t) => {
    if (seen.has(t.tmsLink)) problems.push(`DUPLICATE @TmsLink ${t.tmsLink} used by two tests`);
    seen.set(t.tmsLink, t.description);
  });

  for (const t of tests) {
    const r = await fetch(`${BASE}/projects/${PROJECT}/test-cases/${t.tmsLink}`, {
      headers: { Authorization: AUTH, Accept: 'application/json' },
    });
    if (r.status !== 200) { problems.push(`${t.tmsLink}: HTTP ${r.status} — case not found in ${PROJECT}`); continue; }
    const j = await r.json();
    const tc = (j.data && j.data.test_case) || j.test_case || {};
    const bsName = (tc.title || tc.name || '').trim();
    if (bsName !== t.description.trim()) {
      problems.push(`${t.tmsLink}: title mismatch\n      java: ${t.description}\n      bstack: ${bsName}`);
      console.log(`  ✗ ${t.tmsLink}`);
    } else {
      console.log(`  ✓ ${t.tmsLink}  ${bsName.slice(0, 68)}`);
    }
  }

  console.log();
  if (problems.length) {
    console.log(`PARITY FAILED — ${problems.length} problem(s):`);
    problems.forEach((p) => console.log('  - ' + p));
    process.exit(1);
  }
  console.log(`PARITY OK — ${tests.length}/${tests.length} descriptions match their BrowserStack case name.`);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
