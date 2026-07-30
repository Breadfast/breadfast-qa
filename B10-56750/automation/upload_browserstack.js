'use strict';

/**
 * B10-56750 — upload the generated test cases into BrowserStack Test Management.
 *
 * IMPORTANT (learned 2026-07-26): the Test Management REST API is **v2**:
 *     https://test-management.browserstack.com/api/v2/...
 * The repo's older `automation/import_browserstack_csv.js` targets **v1**, which
 * answers `401 Unauthorized` + an SSO `login_url` for perfectly valid credentials.
 * That 401 is NOT an auth problem and NOT an SSO requirement — it is a wrong-version
 * endpoint. Auth is plain HTTP Basic `username:access_key`.
 *
 * Case data is imported from gen_browserstack_csv.js so the CSV, the markdown
 * execution input and this upload can never drift apart.
 *
 * Usage:
 *   node upload_browserstack.js --dry
 *   node upload_browserstack.js [--project PR-5] [--folder 53074476]
 */

const { cases, ISSUES } = require('./gen_browserstack_csv');
const creds = require('../../automation/config/credentials.js');

const BASE = 'https://test-management.browserstack.com/api/v2';
const arg = (n, d) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : d; };
const PROJECT = arg('--project', 'PR-5');            // PR-5 = "BCard Squad" (/projects/2407303)
const FOLDER = arg('--folder', '53074476');          // "Admin Portal  Add Section(Selection to All Perk Types)"
const DRY = process.argv.includes('--dry');

const user = process.env.BS_TM_USERNAME || creds.browserstack.tmUsername();
const key = process.env.BS_TM_API_TOKEN || creds.browserstack.tmApiToken();
if (!user || !key) throw new Error('BrowserStack credentials unavailable from env or the credential loader.');
const AUTH = 'Basic ' + Buffer.from(`${user}:${key}`).toString('base64');

/** BrowserStack stores step/result/preconditions as HTML. Match the existing convention. */
const html = (s) => `<p>${String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p><br/>`;

/** Map our generator's priority vocabulary onto BrowserStack's. */
const PRIORITY = { Critical: 'Critical', High: 'High', Medium: 'Medium', Low: 'Low' };

function payload(c) {
  return {
    test_case: {
      // Schema quirks confirmed live 2026-07-26 against /api/v2:
      //   - the field is `name`, NOT `title` (a `title` payload 400s with
      //     "did not contain a required property of 'name'")
      //   - `issues` is an array of PLAIN STRINGS, not {jira_id,issue_type}
      //     objects (the API echoes objects back, but rejects them on input)
      //   - the steps array is `test_case_steps`, NOT `steps`. A payload using
      //     `steps` is accepted with HTTP 200 and the steps are SILENTLY DROPPED —
      //     the case is created with zero steps. Always verify step counts after
      //     an upload; a 200 here does not mean the steps landed.
      //   - folder comes from the URL path, so no folder_id in the body
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

async function post(body) {
  // NOTE: `folders` (plural). `/folder/{id}/test-cases` and
  // `/projects/{p}/test-cases` both 404 ("invalid endpoint").
  const res = await fetch(`${BASE}/projects/${PROJECT}/folders/${FOLDER}/test-cases`, {
    method: 'POST',
    headers: { Authorization: AUTH, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, json };
}

async function folderCount() {
  const r = await fetch(`${BASE}/projects/${PROJECT}/folders/${FOLDER}`, { headers: { Authorization: AUTH, Accept: 'application/json' } });
  const j = await r.json().catch(() => null);
  return j && j.folder ? j.folder.cases_count : null;
}

(async () => {
  console.log(`project ${PROJECT} · folder ${FOLDER} · ${cases.length} cases · ${DRY ? 'DRY RUN' : 'LIVE'}`);
  const before = await folderCount();
  console.log('cases in folder before:', before);

  if (DRY) {
    console.log(JSON.stringify(payload(cases[0]), null, 2).slice(0, 900));
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
      console.log(`  [${String(i + 1).padStart(2)}/${cases.length}] ${id}  ${c.title.slice(0, 76)}`);
    } else {
      failed.push({ i: i + 1, title: c.title, status: r.status, err: JSON.stringify(r.json).slice(0, 220) });
      console.log(`  [${String(i + 1).padStart(2)}/${cases.length}] FAILED ${r.status} ${JSON.stringify(r.json).slice(0, 220)}`);
    }
  }

  const after = await folderCount();
  console.log(`\ncreated ${created.length}/${cases.length} · failed ${failed.length}`);
  console.log(`cases in folder after: ${after} (was ${before})`);
  if (failed.length) { console.log('\nfailures:'); failed.forEach((f) => console.log('  ', f.i, f.status, f.err)); }
  console.log(`\nfolder: https://test-management.browserstack.com/projects/2407303/folder/${FOLDER}/test-cases`);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
