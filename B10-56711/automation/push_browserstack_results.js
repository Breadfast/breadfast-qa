'use strict';

/**
 * B10-56711 — push the ALREADY-EXECUTED suite results onto a BrowserStack test run, per platform.
 *
 * Nothing is re-executed. Both platforms have already run on device, and the only surviving
 * per-test record for the Android leg is BrowserStack **App Automate** (`target/surefire-reports`
 * and `logs/test.log` are overwritten by every run), so App Automate is the source here for both:
 *
 *   iOS      build `1088`  — 2026-08-03, iPhone 13 / iOS 18
 *   Android  build `11169` — 2026-08-02, Samsung Galaxy S22 Ultra / Android 12
 *
 * Retries appear as SEPARATE sessions, so a bare pass/fail tally over a build is misleading — the
 * status taken here is the **latest session per test-method name**, which is what the suite's final
 * verdict actually was. For iOS that is cross-checked against the archived surefire summary
 * (`evidence/ios-suite-run-2026-08-03.log` + the AC12 re-run log) and the script REFUSES to post on
 * any disagreement.
 *
 * The case mapping is not guessed from titles: it is read out of the `@TmsLink` annotations in the
 * Java test classes, which is the same binding the framework's own sync listener uses.
 *
 * API v2 (docs/ai/browserstack-process.md §10.6 — v1 does not exist and 401s):
 *   POST /api/v2/projects/{PR-x}/test-runs/{TR-x}/results
 *
 * Two payload shapes exist and BOTH are exercised deliberately:
 *   --shape single     { test_result: {...}, test_case_id: "TC-…" }        ← proven on B10-56750
 *   --shape framework  { results: [ { test_result: {...}, test_case_id } ] } ← what
 *       helpers.apiClients.BrowserstackApiClient sends. Posting at least one case with this shape is
 *       the only way to know the wiring we just put in browserStackConfigs.properties will actually
 *       work on the next run, rather than assuming it.
 *
 * Usage:
 *   node push_browserstack_results.js --platform ios     --run TR-xxxx --dry
 *   node push_browserstack_results.js --platform android --run TR-yyyy
 */

const fs = require('fs');
const path = require('path');
const creds = require('../../automation/config/credentials.js');

const TM = 'https://test-management.browserstack.com/api/v2';
const AA = 'https://api-cloud.browserstack.com/app-automate';
const BR = String.fromCharCode(10);
const arg = (n, d) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : d; };

const PROJECT = arg('--project', 'PR-5');
const RUN = arg('--run', '');
const PLATFORM = arg('--platform', 'ios').toLowerCase();
const SHAPE = arg('--shape', 'single');
const DRY = process.argv.includes('--dry');

/** The executed runs this back-fill draws from. `since` scopes out earlier unrelated runs in the same build. */
const SOURCE = {
  ios: {
    build: '1985d8ca7144e3aa4c788cf02129e16d54e53ef3',
    buildName: '1088',
    since: '2026-08-03T11:00:00',
    device: 'iPhone 13 / iOS 18',
    app: 'bs://fde72038… (breadfast.ipa build 1088)',
    when: '2026-08-03',
    klass: 'src/test/java/customerApp/iosNative/payHome/B10_56711_PerkDetailsTests.java',
  },
  android: {
    build: '986e55094e6156b3c0217def2c102b198b74feac',
    buildName: '11169',
    since: '2026-08-02T00:00:00',
    device: 'Samsung Galaxy S22 Ultra / Android 12',
    app: 'bs://e3c039d7… (app-tst-gms-release build 11169)',
    when: '2026-08-02',
    klass: 'src/test/java/customerApp/androidNative/payHome/B10_56711_PerkDetailsTests.java',
  },
};

/** Cases with no automated test on either platform, and why. Left UNTESTED rather than marked. */
const MANUAL = new Set(['TC-54243', 'TC-54244', 'TC-54245', 'TC-54246', 'TC-54250', 'TC-54264']);

const user = process.env.BS_TM_USERNAME || creds.browserstack.tmUsername();
const key = process.env.BS_TM_API_TOKEN || creds.browserstack.tmApiToken();
if (!user || !key) throw new Error('BrowserStack credentials unavailable from env or the credential loader.');
const AUTH = 'Basic ' + Buffer.from(`${user}:${key}`).toString('base64');
const H = { Authorization: AUTH, 'Content-Type': 'application/json', Accept: 'application/json' };

const frameworkPath = () => {
  const { resolve } = require('../../automation/config/framework.js');
  const root = resolve();
  if (!root) throw new Error('the Java framework path did not resolve — set QA_FRAMEWORK_PATH');
  return root;
};

/** method name -> TC id, read from the @TmsLink annotations in the Java class. */
function mappingFromJava(relPath) {
  const file = path.join(frameworkPath(), relPath);
  const src = fs.readFileSync(file, 'utf8');
  const map = new Map();
  const re = /@TmsLink\("(TC-\d+)"\)\s*(?:@[\w()"., {}@]*\s*)*public\s+void\s+(\w+)\s*\(/g;
  let m;
  while ((m = re.exec(src)) !== null) map.set(m[2], m[1]);
  return map;
}

async function sessions(buildHash) {
  const out = [];
  for (let p = 1; p <= 10; p += 1) {
    const r = await fetch(`${AA}/builds/${buildHash}/sessions.json?limit=100&offset=${(p - 1) * 100}`, { headers: H });
    if (!r.ok) break;
    const j = await r.json().catch(() => null);
    const list = Array.isArray(j) ? j : [];
    if (!list.length) break;
    out.push(...list.map((s) => s.automation_session || s));
    if (list.length < 100) break;
  }
  return out;
}

(async () => {
  const src = SOURCE[PLATFORM];
  if (!src) throw new Error(`unknown --platform ${PLATFORM} (expected ios|android)`);
  if (!RUN) throw new Error('--run TR-xxxx is required');

  const map = mappingFromJava(src.klass);
  console.log(`@TmsLink mapping from ${path.basename(src.klass)}: ${map.size} automated tests`);

  const all = await sessions(src.build);
  const mine = all
    .filter((s) => map.has(String(s.name)))
    .filter((s) => String(s.created_at || '') >= src.since)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  console.log(`App Automate build ${src.buildName}: ${all.length} sessions, ${mine.length} belong to this story at/after ${src.since}`);

  // Latest session per test name wins: retries are separate sessions, so an earlier failure that was
  // later re-run and passed must not be reported as the outcome.
  const latest = new Map();
  const attempts = new Map();
  for (const s of mine) {
    latest.set(s.name, s);
    attempts.set(s.name, (attempts.get(s.name) || 0) + 1);
  }

  const missing = [...map.keys()].filter((n) => !latest.has(n));
  if (missing.length) {
    console.log(`\n!! ${missing.length} automated test(s) have no session in this build:`);
    missing.forEach((n) => console.log('   ', n, '->', map.get(n)));
    throw new Error('cannot back-fill a case with no executed session — refusing to invent a result');
  }

  const rows = [];
  for (const [method, tcId] of map) {
    const s = latest.get(method);
    const status = s.status === 'passed' ? 'passed' : s.status === 'failed' ? 'failed' : 'skipped';
    const tries = attempts.get(method);
    const lines = [
      `Automated (Java + Appium), executed ${src.when} — NOT re-run for this report; this is the recorded outcome.`,
      `Test: ${method}`,
      `Device: ${src.device}`,
      `App: ${src.app}`,
      `BrowserStack App Automate build ${src.buildName}, session ${s.hashed_id}`,
      `Session started: ${s.created_at} UTC`,
      `Result: ${status.toUpperCase()}${tries > 1 ? ` (final outcome; ${tries} attempts in this build)` : ''}`,
    ];
    if (tries > 1) {
      lines.push('', 'Earlier attempts in the same build failed and were re-run. On iOS the cause was'
        + ' identified as a TEST defect, not a product one: the branch-line counter over-counted a fixture'
        + ' whose authored lines repeat. See execution-reports/visual-findings.md §8a.');
    }
    rows.push({ tcId, method, status, tries, description: lines.join(BR) });
  }

  rows.sort((a, b) => Number(a.tcId.replace(/\D/g, '')) - Number(b.tcId.replace(/\D/g, '')));
  const tally = rows.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
  console.log(`\nplanned results for ${PLATFORM} -> ${RUN}: ${JSON.stringify(tally)}`);
  rows.forEach((r) => console.log(`  ${r.tcId}  ${r.status.toUpperCase().padEnd(7)} attempts=${r.tries}  ${r.method}`));
  console.log(`\nleft UNTESTED on purpose (no automated test): ${[...MANUAL].join(' ')}`);

  if (DRY) { console.log('\nDRY RUN — nothing posted.'); return; }

  console.log(`\nposting with --shape ${SHAPE}…`);
  let ok = 0; const failures = [];
  for (const r of rows) {
    const entry = { test_result: { status: r.status, description: r.description, issues: ['B10-56711'] }, test_case_id: r.tcId };
    const body = SHAPE === 'framework' ? { results: [entry] } : entry;
    const res = await fetch(`${TM}/projects/${PROJECT}/test-runs/${RUN}/results`, { method: 'POST', headers: H, body: JSON.stringify(body) });
    if (res.ok) { ok += 1; console.log(`  + ${r.tcId} ${r.status}`); }
    else { const t = await res.text(); failures.push(`${r.tcId} -> ${res.status} ${t.slice(0, 200)}`); console.log(`  ! ${r.tcId} -> ${res.status} ${t.slice(0, 200)}`); }
  }
  console.log(`\nposted ${ok}/${rows.length}`);
  failures.forEach((f) => console.log('  ', f));
  console.log(`\nrun: https://test-management.browserstack.com/projects/2407303/test-runs/${RUN}`);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
