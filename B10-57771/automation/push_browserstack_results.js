'use strict';

/**
 * B10-57771 — post the real execution results into BrowserStack run TR-6751.
 *
 * Why this exists: `automation/browserstack_test_run.js` sources results from **App Automate**,
 * which only works when the suite ran on BrowserStack. This story's Selenium suite ran **locally**
 * against Chrome, so there are no App Automate sessions and that tool correctly posts nothing
 * (`--no-results`). The results are still real — they come from the surefire run — so they are
 * pushed here instead of leaving a run full of `untested` cases next to a green suite.
 *
 * Endpoint (discovered live 2026-08-09, none of it documented in our notes):
 *   POST /api/v2/projects/{PR-x}/test-runs/{TR-x}/results
 *   body { test_case_id: "TC-xxxxx", test_result: { status, comment } }
 *   - `POST …/test-cases/{tc}/results` 404s even though the same path GETs fine.
 *   - status comes back capitalised ("Passed") but is stored lower-case on the case.
 * Every write is read back, because a 200 is not proof on this API.
 *
 * Usage: node push_browserstack_results.js [--dry]
 */

const creds = require('../../automation/config/credentials.js');

const B = 'https://test-management.browserstack.com/api/v2';
const PROJECT = 'PR-66';
const RUN = 'TR-6751';
const DRY = process.argv.includes('--dry');
const AUTH = 'Basic ' + Buffer.from(`${creds.browserstack.tmUsername()}:${creds.browserstack.tmApiToken()}`).toString('base64');

const SUITE = 'Java/Selenium suite b10-57771-tests.xml (run 4): Tests run 21, Failures 0, Errors 0, Skipped 0.';
const MANUAL = 'Executed manually with evidence (screenshots + evidence/manual-cases.json).';

// 21 automated + 2 manual — every case in the folder, all passing.
const RESULTS = [
  ['TC-54743', 'passed', SUITE], ['TC-54744', 'passed', SUITE], ['TC-54745', 'passed', SUITE],
  ['TC-54746', 'passed', SUITE], ['TC-54747', 'passed', SUITE], ['TC-54748', 'passed', SUITE],
  ['TC-54749', 'passed', SUITE], ['TC-54750', 'passed', SUITE], ['TC-54751', 'passed', SUITE],
  ['TC-54752', 'passed', SUITE], ['TC-54753', 'passed', SUITE],
  ['TC-54754', 'passed', `${MANUAL} Merchant-cashback duplicate of MC_74: type, titles EN/AR, merchant "elaraby", cashback value 22, 4 images and both dates all pre-filled.`],
  ['TC-54755', 'passed', SUITE], ['TC-54756', 'passed', SUITE], ['TC-54757', 'passed', SUITE],
  ['TC-54758', 'passed', SUITE],
  ['TC-54759', 'passed', `${MANUAL} Seeded disposable planned source DC_55, duplicated to DC_56, deleted DC_55: duplicate survived and its logo + cover still return HTTP 200.`],
  ['TC-54760', 'passed', SUITE], ['TC-54761', 'passed', SUITE], ['TC-54762', 'passed', SUITE],
  ['TC-54763', 'passed', SUITE], ['TC-54764', 'passed', SUITE], ['TC-54765', 'passed', SUITE],
];

async function call(method, path, body) {
  const r = await fetch(B + path, {
    method,
    headers: { Authorization: AUTH, 'Content-Type': 'application/json', Accept: 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 200) }; }
  return { status: r.status, json: j };
}

(async () => {
  console.log(`${RESULTS.length} results -> ${PROJECT}/${RUN} ${DRY ? '(DRY)' : ''}`);
  if (DRY) { console.log(JSON.stringify(RESULTS.slice(0, 2), null, 1)); return; }

  const failed = [];
  for (const [caseId, status, comment] of RESULTS) {
    const r = await call('POST', `/projects/${PROJECT}/test-runs/${RUN}/results`,
      { test_case_id: caseId, test_result: { status, comment } });
    if (r.status < 200 || r.status >= 300) {
      failed.push({ caseId, status: r.status, err: JSON.stringify(r.json).slice(0, 160) });
      console.log(`  ${caseId} FAILED ${r.status}`);
    } else {
      console.log(`  ${caseId} -> ${status}`);
    }
  }

  // VERIFY by read-back — a 200 is not proof on this API.
  const run = await call('GET', `/projects/${PROJECT}/test-runs/${RUN}`);
  const cases = (run.json.test_run && run.json.test_run.test_cases) || [];
  const notPassed = cases.filter((c) => c.latest_status !== 'passed')
    .map((c) => `${c.identifier}=${c.latest_status}`);

  console.log(`\nposted ${RESULTS.length - failed.length}/${RESULTS.length} · failed ${failed.length}`);
  console.log('run progress:', JSON.stringify(run.json.test_run.overall_progress));
  console.log(notPassed.length ? `NOT PASSED: ${notPassed.join(', ')}` : `all ${cases.length} cases read back as passed`);
  console.log(`url: https://test-management.browserstack.com/projects/4013732/test-runs/${RUN}`);
  if (failed.length) process.exit(1);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
