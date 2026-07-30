'use strict';

/**
 * B10-56652 — upload the generated test cases into BrowserStack Test Management.
 *
 * Traps this script encodes (all learned the hard way on B10-56750, docs/ai/browserstack-process.md §10.6):
 *   • the API is **v2** — `https://test-management.browserstack.com/api/v2`. v1 answers `401 Unauthorized`
 *     plus an SSO `login_url` for perfectly valid credentials; that 401 is a wrong-version endpoint, not
 *     an auth problem. Auth is plain HTTP Basic `tmUsername:tmApiToken`.
 *   • the create endpoint is `/projects/{PR-x}/folders/{id}/test-cases` — **`folders` plural**.
 *     `/folder/{id}/test-cases` and `/projects/{p}/test-cases` both 404 "invalid endpoint".
 *   • the case title field is **`name`**, not `title`.
 *   • `issues` is an array of **plain strings**, not objects.
 *   • steps go in **`test_case_steps`**. A `steps` payload returns **HTTP 200 and silently saves none** —
 *     so the folder count and the step counts are verified after the run, never assumed.
 *
 * Case data comes from gen_browserstack_csv.js so the CSV, the execution input and BrowserStack
 * can never drift apart.
 *
 * Usage:
 *   node upload_browserstack.js --dry
 *   node upload_browserstack.js [--project PR-5] [--folder 53273426]
 */

const { cases, ISSUES } = require('./gen_browserstack_csv');
const creds = require('../../automation/config/credentials.js');

const BASE = 'https://test-management.browserstack.com/api/v2';
const arg = (n, d) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : d; };
const PROJECT = arg('--project', 'PR-5');       // PR-5 = "BCard Squad" (/projects/2407303)
const FOLDER = arg('--folder', '53273426');     // "Pay Home -Perks Section Redesign"
const DRY = process.argv.includes('--dry');

const user = process.env.BS_TM_USERNAME || creds.browserstack.tmUsername();
const key = process.env.BS_TM_API_TOKEN || creds.browserstack.tmApiToken();
if (!user || !key) throw new Error('BrowserStack Test Management credentials unavailable from env or the credential loader.');
const AUTH = 'Basic ' + Buffer.from(`${user}:${key}`).toString('base64');

/** BrowserStack stores step/result/preconditions as HTML — match the existing BCard convention. */
const html = (s) => `<p>${String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p><br/>`;

const PRIORITY = { Critical: 'Critical', High: 'High', Medium: 'Medium', Low: 'Low' };

function payload(c) {
  return {
    test_case: {
      name: c.title,
      description: c.description,
      preconditions: html(c.pre),
      case_type: 'Functional',
      priority: PRIORITY[c.priority] || 'Medium',
      status: 'Active',
      template: 'test_case_steps',
      automation_status: 'not_automated',
      tags: ['ai-created'],
      issues: [ISSUES],
      test_case_steps: c.steps.map(([step, result]) => ({ step: html(step), result: html(result) })),
    },
  };
}

async function api(path, init = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { Authorization: AUTH, 'Content-Type': 'application/json', Accept: 'application/json', ...(init.headers || {}) },
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, json };
}

const post = (body) => api(`/projects/${PROJECT}/folders/${FOLDER}/test-cases`, { method: 'POST', body: JSON.stringify(body) });

async function folderInfo() {
  const r = await api(`/projects/${PROJECT}/folders/${FOLDER}`);
  return r.json && r.json.folder ? r.json.folder : null;
}

/**
 * Verify the steps actually landed — a 200 on create does NOT guarantee it.
 *
 * Read-side schema quirks (confirmed live 2026-07-28), which differ from the WRITE side:
 *   • there is **no per-case detail endpoint** in v2 — `/projects/{p}/test-cases/{TC-x}` 404s
 *     ("invalid endpoint"). The LIST endpoint already returns each case in full, so read from it.
 *   • on read the title field is **`title`** (on write it is `name`), and the steps array is
 *     **`steps`** (on write it is `test_case_steps`). Using the write-side names here reports a
 *     false "NO STEPS SAVED".
 * Compares every generated case against the folder by title, and asserts per-case step counts.
 */
async function verifyAll() {
  let page = 1; let all = [];
  for (;;) {
    const r = await api(`/projects/${PROJECT}/test-cases?folder_id=${FOLDER}&page_size=100&page=${page}`);
    const batch = (r.json && r.json.test_cases) || [];
    all = all.concat(batch);
    if (!r.json || !r.json.info || !r.json.info.next) break;
    page += 1;
  }
  const byTitle = new Map(all.map((t) => [t.title, t]));
  const mismatched = [];
  let matched = 0;
  for (const c of cases) {
    const t = byTitle.get(c.title);
    if (!t) { mismatched.push(`MISSING: ${c.title.slice(0, 60)}`); continue; }
    const n = (t.steps || []).length;
    if (n === c.steps.length) matched += 1;
    else mismatched.push(`${t.identifier}: ${n} steps, expected ${c.steps.length}`);
  }
  return {
    ok: matched === cases.length && !mismatched.length,
    inFolder: all.length,
    matched,
    expected: cases.length,
    stepsStored: all.reduce((n, t) => n + (t.steps || []).length, 0),
    stepsExpected: cases.reduce((n, c) => n + c.steps.length, 0),
    mismatched,
  };
}

(async () => {
  const before = await folderInfo();
  console.log(`project ${PROJECT} · folder ${FOLDER} "${before ? before.name : '?'}" · ${cases.length} cases · ${DRY ? 'DRY RUN' : 'LIVE'}`);
  console.log('cases in folder before:', before ? before.cases_count : 'unknown');

  if (DRY) {
    console.log(JSON.stringify(payload(cases[0]), null, 2).slice(0, 1200));
    console.log(`\n… ${cases.length} cases, ${cases.reduce((n, c) => n + c.steps.length, 0)} steps total`);
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
      created.push(id);
      console.log(`  [${String(i + 1).padStart(2)}/${cases.length}] ${id}  ${c.title.slice(0, 74)}`);
    } else {
      failed.push({ i: i + 1, title: c.title, status: r.status, err: JSON.stringify(r.json).slice(0, 220) });
      console.log(`  [${String(i + 1).padStart(2)}/${cases.length}] FAILED ${r.status} ${JSON.stringify(r.json).slice(0, 220)}`);
    }
  }

  const after = await folderInfo();
  console.log(`\ncreated ${created.length}/${cases.length} · failed ${failed.length}`);
  console.log(`cases in folder after: ${after ? after.cases_count : 'unknown'} (was ${before ? before.cases_count : '?'})`);
  if (created.length) {
    const v = await verifyAll();
    console.log(`verification: ${v.inFolder} cases in folder · title+step-count match ${v.matched}/${v.expected} · steps ${v.stepsStored}/${v.stepsExpected}` +
      (v.ok ? ' → OK' : ' → PROBLEMS'));
    v.mismatched.forEach((m) => console.log('   ', m));
    if (!v.ok) process.exitCode = 1;
  }
  if (failed.length) { console.log('\nfailures:'); failed.forEach((f) => console.log('  ', f.i, f.status, f.err)); }
  console.log(`\nfolder: https://test-management.browserstack.com/projects/2407303/folder/${FOLDER}/test-cases`);
  if (failed.length) process.exitCode = 1;
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
