'use strict';
/**
 * B10-56711 — upload the generated test cases into BrowserStack Test Management.
 *
 * Destination supplied by the operator 2026-07-29:
 *   https://test-management.browserstack.com/projects/2407303/folder/53347724/test-cases
 *   numeric project 2407303 → identifier **PR-5** ("BCard Squad"); folder 53347724 =
 *   "Perks List - Screen Redesign" (verified empty at the prerequisite gate, cases_count: 0).
 *
 * API TRAPS (carried from B10-56750, all re-verified live on this run):
 *   - The API is **v2** (`/api/v2`). v1 does not exist and answers `401` + an SSO `login_url` for
 *     perfectly valid Basic credentials — a wrong-version endpoint, not an auth problem.
 *   - Create path is `POST /projects/{PR-x}/folders/{id}/test-cases` (folders **plural**).
 *     `GET /folders/{id}/test-cases` is NOT a valid endpoint and 404s — that 404 is our own wrong
 *     path, not a permission issue. Folder metadata comes from `GET /projects/{p}/folders/{id}`.
 *   - The field is `name`, not `title`.
 *   - `issues` is an array of PLAIN STRINGS.
 *   - Steps go in **`test_case_steps`**. A `steps` payload returns HTTP 200 and SILENTLY DROPS every
 *     step, so the step count must be verified after the upload — a 200 is not proof.
 *
 * Usage:
 *   node upload_browserstack.js --dry
 *   node upload_browserstack.js [--project PR-5] [--folder 53347724]
 */

const { cases, ISSUES } = require('./cases.js');
const creds = require('../../automation/config/credentials.js');

const BASE = 'https://test-management.browserstack.com/api/v2';
const arg = (n, d) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : d; };
const PROJECT = arg('--project', 'PR-5');
const FOLDER = arg('--folder', '53434687');
const DRY = process.argv.includes('--dry');

const user = process.env.BS_TM_USERNAME || creds.browserstack.tmUsername();
const key = process.env.BS_TM_API_TOKEN || creds.browserstack.tmApiToken();
if (!user || !key) throw new Error('BrowserStack credentials unavailable from env or the credential loader.');
const AUTH = 'Basic ' + Buffer.from(`${user}:${key}`).toString('base64');

const html = (s) => `<p>${String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p><br/>`;

function payload(c) {
  return {
    test_case: {
      name: c.title,
      description: c.description,
      preconditions: html(c.pre),
      case_type: 'Functional',
      status: 'Active',
      template: 'test_case_steps',
      automation_status: 'not_automated',
      priority: c.priority,
      tags: ['ai-created', 'B10-56711', ...(c.locale ? [`locale-${c.locale}`] : [])],
      issues: [ISSUES],
      test_case_steps: c.steps.map(([step, result]) => ({ step: html(step), result: html(result) })),
    },
  };
}

async function post(body) {
  const res = await fetch(`${BASE}/projects/${PROJECT}/folders/${FOLDER}/test-cases`, {
    method: 'POST',
    headers: { Authorization: AUTH, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, json };
}

async function folderInfo() {
  const r = await fetch(`${BASE}/projects/${PROJECT}/folders/${FOLDER}`, { headers: { Authorization: AUTH, Accept: 'application/json' } });
  const j = await r.json().catch(() => null);
  return j && j.folder ? j.folder : null;
}

/**
 * Post-create verification: a 200 on create does not prove the steps landed.
 *
 * TWO MORE v2 QUIRKS found on this run (2026-07-29):
 *   1. The only working read path is the **folder-filtered list**
 *      `GET /projects/{p}/test-cases?folder_id={id}`. Per-case reads
 *      (`/test-cases/{id}`, `/folders/{id}/test-cases/{id}`, `/test-cases/{id}/details`)
 *      all 404 with "You have stumbled on an invalid endpoint" — our wrong path, not a permission gap.
 *   2. **The read model is named differently from the write model.** Create sends `name` +
 *      `test_case_steps`; the list returns **`title`** + **`steps`**. Verifying against `name`/
 *      `test_case_steps` reports a false 0/18 mismatch on a perfectly good upload.
 */
async function verify(expected) {
  const r = await fetch(`${BASE}/projects/${PROJECT}/test-cases?folder_id=${FOLDER}`, {
    headers: { Authorization: AUTH, Accept: 'application/json' },
  });
  const j = await r.json().catch(() => null);
  const all = (j && j.test_cases) || [];
  const byTitle = new Map(all.map((t) => [t.title, t]));
  return expected.map((e) => {
    const t = byTitle.get(e.title);
    return {
      caseId: e.caseId,
      id: t ? t.identifier : null,
      found: !!t,
      steps: t && Array.isArray(t.steps) ? t.steps.length : null,
      sentSteps: e.sentSteps,
      priority: t ? t.priority : null,
      sentPriority: e.priority,
    };
  });
}

(async () => {
  const before = await folderInfo();
  console.log(`project ${PROJECT} · folder ${FOLDER} ("${before ? before.name : '?'}") · ${cases.length} cases · ${DRY ? 'DRY RUN' : 'LIVE'}`);
  console.log('cases in folder before:', before ? before.cases_count : '?');

  if (DRY) {
    const p = payload(cases[0]);
    console.log('sample payload (case 1):');
    console.log(JSON.stringify({ ...p, test_case: { ...p.test_case, test_case_steps: p.test_case.test_case_steps.slice(0, 2) } }, null, 2));
    console.log(`... ${p.test_case.test_case_steps.length} steps in total for ${cases[0].id}`);
    return;
  }

  const created = [];
  const failed = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const r = await post(payload(c));
    const tc = r.json && (r.json.test_case || (r.json.data && r.json.data.test_case));
    const id = tc && (tc.identifier || tc.id);
    if (r.status >= 200 && r.status < 300 && id) {
      created.push({ id, caseId: c.id, title: c.title, sentSteps: c.steps.length, priority: c.priority });
      console.log(`  [${String(i + 1).padStart(2)}/${cases.length}] ${id}  ${c.id}  ${c.title.slice(0, 66)}`);
    } else {
      failed.push({ i: i + 1, caseId: c.id, status: r.status, err: JSON.stringify(r.json).slice(0, 220) });
      console.log(`  [${String(i + 1).padStart(2)}/${cases.length}] FAILED ${r.status} ${JSON.stringify(r.json).slice(0, 220)}`);
    }
  }

  const after = await folderInfo();
  console.log(`\ncreated ${created.length}/${cases.length} · failed ${failed.length}`);
  console.log(`cases in folder after: ${after ? after.cases_count : '?'} (was ${before ? before.cases_count : '?'})`);
  if (failed.length) { console.log('\nfailures:'); failed.forEach((f) => console.log('  ', f.i, f.caseId, f.status, f.err)); }

  console.log('\nVERIFY (steps must be non-zero — a 200 on create does not prove they landed):');
  const checks = await verify(created);
  let stepMismatch = 0;
  checks.forEach((v) => {
    const ok = v.found && v.steps === v.sentSteps && v.priority === v.sentPriority;
    if (!ok) stepMismatch++;
    console.log(`  ${v.caseId} -> ${v.id}  steps=${v.steps}/${v.sentSteps}  priority=${v.priority}  ${ok ? 'OK' : '*** MISMATCH ***'}`);
  });
  console.log(`\nverification failures: ${stepMismatch}`);
  console.log(`folder: https://test-management.browserstack.com/projects/2407303/folder/${FOLDER}/test-cases`);
  if (failed.length || stepMismatch) process.exitCode = 1;
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
