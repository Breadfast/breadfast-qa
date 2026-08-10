'use strict';

/**
 * B10-57771 — create the Test Management project/folder and upload the generated test cases.
 *
 * API traps this script encodes (docs/ai/browserstack-process.md §10.6):
 *   - Test Management is **v2** (`/api/v2`). v1 answers 401 + an SSO login_url for VALID keys.
 *   - Auth is plain HTTP Basic `tmUsername:tmApiToken` — NOT the App Automate access key.
 *   - The case field is `name`, not `title`.
 *   - Steps go in `test_case_steps`. A `steps` payload returns **200** and silently saves none,
 *     so the step count is verified by reading every case back after upload.
 *   - `issues` is an array of plain strings.
 *
 * Usage:
 *   node upload_browserstack.js --dry
 *   node upload_browserstack.js            # creates project + folder if absent, then uploads
 *   node upload_browserstack.js --project PR-xx --folder 123
 */

const { cases, ISSUES, PROJECT } = require('./gen_browserstack_csv');
const creds = require('../../automation/config/credentials.js');

const BASE = 'https://test-management.browserstack.com/api/v2';
const arg = (n, d) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : d; };
const DRY = process.argv.includes('--dry');

const user = creds.browserstack.tmUsername();
const key = creds.browserstack.tmApiToken();
if (!user || !key) throw new Error('BrowserStack TM credentials unavailable from the credential loader.');
const AUTH = 'Basic ' + Buffer.from(`${user}:${key}`).toString('base64');

const html = (s) => `<p>${String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p><br/>`;
const PRIORITY = { Critical: 'Critical', High: 'High', Medium: 'Medium', Low: 'Low' };

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
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

(async () => {
  let project = arg('--project');
  let folder = arg('--folder');

  if (DRY) {
    console.log(`DRY RUN · ${cases.length} cases · target project "${PROJECT}"`);
    console.log(JSON.stringify(payload(cases[0]), null, 2).slice(0, 1200));
    return;
  }

  // ── 1. resolve or create the project ────────────────────────────────────────
  if (!project) {
    const list = await call('GET', '/projects');
    const found = (list.json.projects || []).find((p) => p.name === PROJECT);
    if (found) {
      project = found.identifier;
      console.log(`project exists: ${project} "${PROJECT}"`);
    } else {
      const r = await call('POST', '/projects', { project: { name: PROJECT, description: 'QA validation for B10-57771 — Admin Portal Duplicate Perk Action.' } });
      project = r.json.project && r.json.project.identifier;
      if (!project) throw new Error('project create failed: ' + JSON.stringify(r.json).slice(0, 300));
      console.log(`project created: ${project} "${PROJECT}"`);
    }
  }

  // ── 2. resolve or create the folder ─────────────────────────────────────────
  const FOLDER_NAME = 'Duplicate Perk Action';
  if (!folder) {
    const list = await call('GET', `/projects/${project}/folders`);
    const flat = [];
    const walk = (arr) => (arr || []).forEach((f) => { flat.push(f); walk(f.sub_folders || f.folders); });
    walk(list.json.folders);
    const found = flat.find((f) => f.name === FOLDER_NAME);
    if (found) {
      folder = found.id;
      console.log(`folder exists: ${folder} "${FOLDER_NAME}"`);
    } else {
      const r = await call('POST', `/projects/${project}/folders`, { folder: { name: FOLDER_NAME, description: 'B10-57771 test cases.' } });
      folder = r.json.folder && r.json.folder.id;
      if (!folder) throw new Error('folder create failed: ' + JSON.stringify(r.json).slice(0, 300));
      console.log(`folder created: ${folder} "${FOLDER_NAME}"`);
    }
  }

  // ── 3. upload ───────────────────────────────────────────────────────────────
  console.log(`\nuploading ${cases.length} cases → project ${project} / folder ${folder}\n`);
  const created = [];
  const failed = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const r = await call('POST', `/projects/${project}/folders/${folder}/test-cases`, payload(c));
    const tc = r.json && (r.json.test_case || (r.json.data && r.json.data.test_case));
    const id = tc && (tc.identifier || tc.id);
    if (r.status >= 200 && r.status < 300 && id) {
      created.push({ id, title: c.title, expectedSteps: c.steps.length });
      console.log(`  [${String(i + 1).padStart(2)}/${cases.length}] ${id}  ${c.title.slice(0, 72)}`);
    } else {
      failed.push({ i: i + 1, title: c.title, status: r.status, err: JSON.stringify(r.json).slice(0, 240) });
      console.log(`  [${String(i + 1).padStart(2)}/${cases.length}] FAILED ${r.status} ${JSON.stringify(r.json).slice(0, 240)}`);
    }
  }

  // ── 4. VERIFY — a 200 is not proof; read every case back and check its steps ─
  console.log('\nverifying uploaded cases (step counts read back from the API)…');
  const badSteps = [];
  for (const c of created) {
    const r = await call('GET', `/projects/${project}/test-cases/${c.id}`);
    // Asymmetric schema: POST takes `test_case_steps`, GET returns them as `steps`
    // nested under data.test_case. Reading the POST key here yields a false "0 steps".
    const tc = (r.json && r.json.data && r.json.data.test_case) || (r.json && r.json.test_case) || {};
    const arr = tc.steps || tc.test_case_steps || [];
    const n = Array.isArray(arr) ? arr.length : 0;
    if (n !== c.expectedSteps) badSteps.push({ id: c.id, expected: c.expectedSteps, actual: n });
  }
  const fr = await call('GET', `/projects/${project}/folders/${folder}`);
  const count = fr.json && fr.json.folder ? fr.json.folder.cases_count : null;

  console.log(`\ncreated ${created.length}/${cases.length} · failed ${failed.length}`);
  console.log(`folder cases_count = ${count} (expected ${cases.length})`);
  console.log(badSteps.length ? `STEP MISMATCHES: ${JSON.stringify(badSteps)}` : 'step counts: all correct ✓');
  if (failed.length) { console.log('\nfailures:'); failed.forEach((f) => console.log('  ', f.i, f.status, f.err)); }

  require('fs').writeFileSync(
    require('path').join(__dirname, '..', 'browserstack', 'import-result.json'),
    JSON.stringify({ project, folder, created, failed, count, badSteps }, null, 2)
  );
  console.log(`\nproject ${project} · folder ${folder}`);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
