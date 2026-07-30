'use strict';

/**
 * B10-56750 — push Playwright results onto a BrowserStack test run.
 *
 * API v2 (docs/ai/browserstack-process.md §10.6):
 *   POST /api/v2/projects/{PR-x}/test-runs/{TR-x}/results
 *   body: { test_result: { status, description, issues }, test_case_id: "TC-…" }
 *
 * The mapping below is EXPLICIT on purpose. Test cases and automated tests are not
 * 1:1: one spec test can satisfy two cases (TC9/TC10), one case can require four
 * spec tests to pass (TC13, one per perk type), and two cases have no spec at all
 * (TC11 retracted, TC25 verified via the API by hand). Guessing that mapping from
 * titles would silently mis-report, so it is declared and asserted instead.
 *
 * Usage:
 *   node push_browserstack_results.js --run TR-6662 --report ../execution-reports/run3.json [--dry]
 */

const fs = require('fs');
const path = require('path');
const creds = require('../../automation/config/credentials.js');

const BASE = 'https://test-management.browserstack.com/api/v2';
const BR = String.fromCharCode(10); // newline for multi-line result descriptions
const arg = (n, d) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : d; };
const PROJECT = arg('--project', 'PR-5');
const RUN = arg('--run', 'TR-6662');
const FOLDER = Number(arg('--folder', '53074476'));
const REPORT = path.resolve(__dirname, arg('--report', '../execution-reports/run3.json'));
const DRY = process.argv.includes('--dry');

const user = process.env.BS_TM_USERNAME || creds.browserstack.tmUsername();
const key = process.env.BS_TM_API_TOKEN || creds.browserstack.tmApiToken();
const AUTH = 'Basic ' + Buffer.from(`${user}:${key}`).toString('base64');
const H = { Authorization: AUTH, 'Content-Type': 'application/json', Accept: 'application/json' };

/**
 * Cases with NO automated test, and why. Everything else is matched by EXACT
 * NAME: each Playwright test title is the BrowserStack case name (the specs read
 * their titles from gen_browserstack_csv.js, the same source the cases were
 * uploaded from), so no hand-maintained index mapping is needed — and a rename
 * can never silently mis-report against the wrong case.
 */
const MANUAL = {
  'Verify the design-specified seeded Sections "Food & Beverage" and "Fitness" are available': {
    status: 'skipped',
    reason: 'NOT APPLICABLE — retracted, and deliberately not automated. This case asserted that the design\'s '
      + 'seeded sections "Food & Beverage" / "Fitness" exist. Sections are user-created content with no fixed '
      + 'expected set, so an absent section is not a defect (it can simply be added). Bug B10-58196 was filed '
      + 'against this and withdrawn. Left unexecuted rather than failed.',
  },
};

/** Bug key to cite when a given case fails. */
const BUGS = {
  'Verify the "Add section" modal structure, title, field labels and required markers': 'B10-58194 / B10-58195',
  'Verify a duplicate Section name shows the inline error, keeps the modal open, and preserves the entered values': 'B10-58193',
  'Verify dismissing the "Add section" modal via Cancel and via the X icon clears all inputs without saving': 'B10-58191',
  'Verify Section ordering at the data/API level — Breadfast first, remaining Sections alphabetical [PARTIAL]': 'B10-58192',
};

function readSpecResults(file) {
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = [];
  const walk = (suite) => {
    (suite.suites || []).forEach(walk);
    (suite.specs || []).forEach((sp) => {
      const t = sp.tests && sp.tests[0];
      const last = t && t.results && t.results[t.results.length - 1];
      out.push({ title: sp.title, ok: !!sp.ok, status: last ? last.status : 'unknown', error: last && last.error ? String(last.error.message || '').split('\n')[0].slice(0, 200) : null });
    });
  };
  (report.suites || []).forEach(walk);
  return out;
}

async function casesInFolder() {
  const out = [];
  for (let p = 1; p <= 20; p += 1) {
    const r = await fetch(`${BASE}/projects/${PROJECT}/test-cases?p=${p}`, { headers: H });
    const j = await r.json().catch(() => null);
    const list = (j && j.test_cases) || [];
    if (!list.length) break;
    out.push(...list.filter((t) => t.folder_id === FOLDER));
  }
  return out.sort((a, b) => Number(String(a.identifier).replace(/\D/g, '')) - Number(String(b.identifier).replace(/\D/g, '')));
}

(async () => {
  const specs = readSpecResults(REPORT);
  console.log(`spec results: ${specs.length} (${specs.filter((s) => s.ok).length} pass / ${specs.filter((s) => !s.ok).length} fail)`);

  const cases = await casesInFolder();
  console.log(`cases in folder: ${cases.length}`);

  const byTitle = new Map(specs.map((sp) => [sp.title.trim(), sp]));
  const rows = [];
  const unmatched = [];

  for (const c of cases) {
    const title = (c.name || c.title || '').trim();
    const manual = MANUAL[title];
    if (manual) { rows.push({ tcId: c.identifier, title, status: manual.status, description: manual.reason }); continue; }

    const spec = byTitle.get(title);
    if (!spec) { unmatched.push(`${c.identifier} :: ${title}`); continue; }

    const status = spec.ok ? 'passed' : 'failed';
    const lines = [
      `Automated by Playwright: B10-56750/automation/tests (test name matches this case name exactly).`,
      `Result: ${spec.ok ? 'PASS' : 'FAIL'} (${spec.status})`,
    ];
    if (!spec.ok) {
      lines.push('', 'Failure detail:', `  ${spec.error || '(see the run report)'}`);
      if (BUGS[title]) lines.push('', `Defect: ${BUGS[title]} — asserted deliberately against the spec, so this failure IS the documented defect.`);
    }
    rows.push({ tcId: c.identifier, title, status, description: lines.join(BR) });
  }

  if (unmatched.length) {
    console.log(`
!! ${unmatched.length} case(s) have NO matching automated test and no MANUAL entry:`);
    unmatched.forEach((u) => console.log('   ', u));
    throw new Error('every case must either match an automated test by name or be declared in MANUAL');
  }

  const tally = rows.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
  console.log('\nplanned results:', JSON.stringify(tally));
  rows.forEach((r) => console.log(`  ${r.tcId}  ${r.status.toUpperCase().padEnd(7)} ${r.title.slice(0, 74)}`));

  if (DRY) { console.log('\nDRY RUN — nothing posted.'); return; }

  console.log('\nposting…');
  let ok = 0; const failures = [];
  for (const r of rows) {
    const body = {
      test_result: {
        status: r.status,
        description: r.description,
        issues: ['B10-56750'],
      },
      test_case_id: r.tcId,
    };
    const res = await fetch(`${BASE}/projects/${PROJECT}/test-runs/${RUN}/results`, { method: 'POST', headers: H, body: JSON.stringify(body) });
    if (res.ok) { ok += 1; console.log(`  + ${r.tcId} ${r.status}`); }
    else { const t = await res.text(); failures.push(`${r.tcId} -> ${res.status} ${t.slice(0, 180)}`); console.log(`  ! ${r.tcId} -> ${res.status} ${t.slice(0, 180)}`); }
  }
  console.log(`\nposted ${ok}/${rows.length}`);
  if (failures.length) failures.forEach((f) => console.log('  ', f));
  console.log(`\nrun: https://test-management.browserstack.com/projects/2407303/test-runs/${RUN}`);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
