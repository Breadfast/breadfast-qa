'use strict';

/**
 * B10-57771 — offline parity check between the Java test class and BrowserStack.
 *
 * Rule (CLAUDE.md §8): every automated test's @Test(description = ...) must be the EXACT
 * BrowserStack test-case name, and its @TmsLink must be that case's id — otherwise results
 * map onto the wrong case, or onto nothing.
 *
 * Run: node check_tmslink_parity.js        (exits 1 on any mismatch)
 */

const fs = require('fs');
const path = require('path');
const creds = require('../../automation/config/credentials.js');

const TEST_CLASS = 'D:\\projects\\src\\test\\java\\cardService\\adminPanel\\B10_57771_DuplicatePerkTests.java';
const PROJECT = 'PR-66';
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
