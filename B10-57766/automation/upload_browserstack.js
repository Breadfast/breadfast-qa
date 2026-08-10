'use strict';

/**
 * B10-57766 — upload the APPROVED test cases into the operator-supplied Test Management folder.
 *
 * Destination is FIXED (given by the operator 2026-08-10 as a shared folder link, then resolved and
 * verified against the API): project PR-5 "BCard Squad" · folder 54235790
 * "Admin Portal - Homepage Perks Management" (parent 54229450 "Card Ops.Sprint3.4").
 * This script therefore CREATES NOTHING — no project, no folder. It only adds cases to that folder.
 *
 * API traps this script encodes (docs/ai/browserstack-process.md §10.6):
 *   - Test Management is **v2** (`/api/v2`). v1 answers 401 + an SSO login_url for VALID keys.
 *   - Auth is plain HTTP Basic `tmUsername:tmApiToken` — NOT the App Automate access key.
 *   - The case field is `name`, not `title`.
 *   - Steps go in `test_case_steps`. A `steps` payload returns **200** and silently saves none.
 *   - Asymmetric schema: POST takes `test_case_steps`; GET returns them as `steps` nested under
 *     `data.test_case`. Reading the POST key on the way back yields a false "0 steps".
 *   - `issues` is an array of plain strings.
 *   - A 200 is NOT proof: every case is read back and its step count checked, and the folder's
 *     cases_count is compared against the expected total.
 *
 * Usage:
 *   node upload_browserstack.js --dry     # print the resolved destination + first payload, change nothing
 *   node upload_browserstack.js           # upload, then verify by reading back
 */

const fs = require('fs');
const path = require('path');
const { cases, ISSUES, PROJECT, FOLDER_PATH, BS_PROJECT_ID, BS_FOLDER_ID } = require('./gen_browserstack_csv');
const creds = require('../../automation/config/credentials.js');

const BASE = 'https://test-management.browserstack.com/api/v2';
const DRY = process.argv.includes('--dry');

const user = creds.browserstack.tmUsername();
const key = creds.browserstack.tmApiToken();
if (!user || !key) throw new Error('BrowserStack TM credentials unavailable from the credential loader.');
const AUTH = 'Basic ' + Buffer.from(`${user}:${key}`).toString('base64');

const html = (s) => `<p>${String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p><br/>`;
const CASE_TYPE = { Functional: 'Functional', Regression: 'Regression', Acceptance: 'Acceptance', Usability: 'Usability' };
const AUTOMATION = { 'Not Automated': 'not_automated', Automated: 'automated', 'Automation Not Required': 'automation_not_required' };

async function call(method, p, body) {
  const res = await fetch(BASE + p, {
    method,
    headers: { Authorization: AUTH, 'Content-Type': 'application/json', Accept: 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, json };
}

function payload(c) {
  return {
    test_case: {
      name: c.title,
      description: c.description,
      preconditions: html(c.pre),
      case_type: CASE_TYPE[c.type] || 'Functional',
      priority: c.priority,
      status: 'Active',
      template: 'test_case_steps',
      automation_status: AUTOMATION[c.automation] || 'not_automated',
      // The traceability tags are the reason AC coverage is computed rather than asserted (§10.2a).
      tags: ['ai-created', ...c.acs.map((a) => `ac:${a}`), ...c.screens.map((s) => `screen:${s}`)],
      issues: [ISSUES],
      test_case_steps: c.steps.map(([step, result]) => ({ step: html(step), result: html(result) })),
    },
  };
}

(async () => {
  const project = BS_PROJECT_ID;
  const folder = BS_FOLDER_ID;

  // ── 0. verify the destination exists and is what we were told, BEFORE writing anything ──
  const fr0 = await call('GET', `/projects/${project}/folders/${folder}`);
  if (fr0.status !== 200 || !fr0.json.folder) {
    throw new Error(`destination folder ${project}/${folder} did not resolve (HTTP ${fr0.status}): ${JSON.stringify(fr0.json).slice(0, 200)}`);
  }
  const f0 = fr0.json.folder;
  console.log(`destination: project ${project} "${PROJECT}" · folder ${folder} "${f0.name}"`);
  console.log(`             folder path "${FOLDER_PATH}" · cases_count before = ${f0.cases_count}`);

  if (DRY) {
    console.log(`\nDRY RUN · ${cases.length} cases · ${cases.reduce((n, c) => n + c.steps.length, 0)} steps · nothing written`);
    console.log('\nfirst payload:\n' + JSON.stringify(payload(cases[0]), null, 2).slice(0, 1600));
    return;
  }

  // ── 1. upload ──────────────────────────────────────────────────────────────
  console.log(`\nuploading ${cases.length} cases → ${project} / folder ${folder}\n`);
  const created = [];
  const failed = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const r = await call('POST', `/projects/${project}/folders/${folder}/test-cases`, payload(c));
    const tc = r.json && (r.json.test_case || (r.json.data && r.json.data.test_case));
    const id = tc && (tc.identifier || tc.id);
    if (r.status >= 200 && r.status < 300 && id) {
      created.push({ id, ref: `C-${String(i + 1).padStart(2, '0')}`, title: c.title, expectedSteps: c.steps.length });
      console.log(`  [${String(i + 1).padStart(2)}/${cases.length}] ${id}  ${c.title.slice(0, 70)}`);
    } else {
      failed.push({ i: i + 1, title: c.title, status: r.status, err: JSON.stringify(r.json).slice(0, 240) });
      console.log(`  [${String(i + 1).padStart(2)}/${cases.length}] FAILED ${r.status} ${JSON.stringify(r.json).slice(0, 240)}`);
    }
  }

  // ── 2. VERIFY — a 200 is not proof ─────────────────────────────────────────
  console.log('\nverifying (reading every case back)…');
  const badSteps = [];
  const badTags = [];
  for (const c of created) {
    const r = await call('GET', `/projects/${project}/test-cases/${c.id}`);
    const tc = (r.json && r.json.data && r.json.data.test_case) || (r.json && r.json.test_case) || {};
    const arr = tc.steps || tc.test_case_steps || [];
    const n = Array.isArray(arr) ? arr.length : 0;
    if (n !== c.expectedSteps) badSteps.push({ id: c.id, ref: c.ref, expected: c.expectedSteps, actual: n });
    const tags = (tc.tags || []).map(String);
    if (!tags.some((t) => /^ac:AC-/.test(t))) badTags.push({ id: c.id, ref: c.ref, tags });
  }
  const fr = await call('GET', `/projects/${project}/folders/${folder}`);
  const count = fr.json && fr.json.folder ? fr.json.folder.cases_count : null;
  const sub = fr.json && fr.json.folder ? fr.json.folder.sub_folders_count : null;

  console.log(`\ncreated ${created.length}/${cases.length} · failed ${failed.length}`);
  console.log(`folder cases_count = ${count} (expected ${f0.cases_count + created.length})`);
  console.log(`folder sub_folders_count = ${sub} (expected 0 — cases must land directly, not in a nested folder)`);
  console.log(badSteps.length ? `STEP MISMATCHES: ${JSON.stringify(badSteps)}` : 'step counts: all correct');
  console.log(badTags.length ? `MISSING ac: TAGS: ${JSON.stringify(badTags)}` : 'ac: tags: present on every case');
  if (failed.length) { console.log('\nfailures:'); failed.forEach((x) => console.log('  ', x.i, x.status, x.err)); }

  const outDir = path.join(__dirname, '..', 'browserstack');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'import-result.json'),
    JSON.stringify({ project, folder, folderName: f0.name, folderPath: FOLDER_PATH,
      countBefore: f0.cases_count, countAfter: count, subFolders: sub,
      created, failed, badSteps, badTags }, null, 2));
  console.log(`\nresult → ${path.join(outDir, 'import-result.json')}`);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
