'use strict';

/**
 * B10-57393 — upload the generated test cases into BrowserStack Test Management.
 *
 * API notes carried forward from B10-56750 (do not re-learn these the hard way):
 *   - The Test Management REST API is **v2** (`/api/v2`). v1 answers `401 Unauthorized` +
 *     an SSO `login_url` for perfectly valid credentials — a wrong-version endpoint, not an
 *     auth or SSO problem.
 *   - The case-name field is `name`, NOT `title`.
 *   - `issues` is an array of PLAIN STRINGS.
 *   - Steps go in **`test_case_steps`**, NOT `steps`. A `steps` payload returns HTTP 200 and
 *     the steps are SILENTLY DROPPED. Always verify step counts after upload.
 *   - The folder comes from the URL path (`/folders/{id}/test-cases`, plural "folders").
 *
 * Destination for this story (operator-supplied 2026-07-27): project PR-5 "BCard Squad",
 * folder 53134541 "Mobile App Preview for Perk Creation in Admin Portal"
 * (under 53115562 "Card Core_Sprint3.3").
 *
 * Usage:
 *   node upload_browserstack.js --dry
 *   node upload_browserstack.js [--project PR-5] [--folder 53134541]
 *   node upload_browserstack.js --verify            # re-read the folder and report step counts
 */

const { cases, ISSUES } = require('./gen_browserstack_csv');
const creds = require('../../automation/config/credentials.js');

const BASE = 'https://test-management.browserstack.com/api/v2';
const arg = (n, d) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : d; };
const PROJECT = arg('--project', 'PR-5');
const FOLDER = arg('--folder', '53134541');
const DRY = process.argv.includes('--dry');
const VERIFY_ONLY = process.argv.includes('--verify');

const user = process.env.BS_TM_USERNAME || creds.browserstack.tmUsername();
const key = process.env.BS_TM_API_TOKEN || creds.browserstack.tmApiToken();
if (!user || !key) throw new Error('BrowserStack credentials unavailable from env or the credential loader.');
const AUTH = 'Basic ' + Buffer.from(`${user}:${key}`).toString('base64');

const html = (s) => `<p>${String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p><br/>`;
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
 * Re-read the folder's cases and confirm the steps actually landed (the `steps` trap).
 * NOTE the asymmetry, learned live 2026-07-27: cases are CREATED at
 *   POST /projects/{p}/folders/{id}/test-cases
 * but LISTED at
 *   GET  /projects/{p}/test-cases?folder_id={id}
 * A GET on the create path returns 404 "You have stumbled on an invalid endpoint".
 */
async function verify() {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const r = await fetch(`${BASE}/projects/${PROJECT}/test-cases?folder_id=${FOLDER}&p=${page}`, { headers: { Authorization: AUTH, Accept: 'application/json' } });
    const j = await r.json().catch(() => null);
    const list = (j && j.test_cases) || [];
    if (!list.length) break;
    const fresh = list.filter((tc) => !out.some((o) => (o.identifier || o.id) === (tc.identifier || tc.id)));
    if (!fresh.length) break;              // same page echoed back → stop
    out.push(...fresh);
  }
  return out.map((tc) => ({
    id: tc.identifier || tc.id,
    name: tc.name || tc.title,   // POST echoes `name`; the GET listing uses `title`
    steps: Array.isArray(tc.test_case_steps) ? tc.test_case_steps.length
      : Array.isArray(tc.steps) ? tc.steps.length : (tc.steps_count ?? null),
  }));
}

(async () => {
  const before = await folderInfo();
  console.log(`project ${PROJECT} · folder ${FOLDER} "${before ? before.name : '?'}" · ${cases.length} cases · ${DRY ? 'DRY RUN' : VERIFY_ONLY ? 'VERIFY' : 'LIVE'}`);

  if (VERIFY_ONLY) {
    const v = await verify();
    console.log(`folder reports cases_count=${before && before.cases_count}; listed ${v.length}`);
    v.forEach((x) => console.log(`  ${x.id}  steps=${String(x.steps).padStart(2)}  ${String(x.name).slice(0, 78)}`));
    if (!v.length) { console.log('\nWARNING: listing returned NO cases — cannot confirm steps landed.'); return; }
    const zero = v.filter((x) => x.steps === 0);
    const unknown = v.filter((x) => x.steps === null);
    if (zero.length) console.log(`\nWARNING: ${zero.length} case(s) landed with ZERO steps.`);
    else if (unknown.length === v.length) console.log('\nNOTE: the list endpoint does not return steps; step counts confirmed per-case below.');
    else console.log(`\nAll ${v.length} listed cases have steps.`);
    if (before && before.cases_count !== v.length) console.log(`WARNING: folder cases_count=${before.cases_count} but listing returned ${v.length}.`);
    return;
  }

  console.log('cases in folder before:', before && before.cases_count);
  if (DRY) { console.log(JSON.stringify(payload(cases[0]), null, 2).slice(0, 1100)); return; }

  const created = []; const failed = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const r = await post(payload(c));
    const tc = r.json && (r.json.test_case || (r.json.data && r.json.data.test_case));
    const id = tc && (tc.identifier || tc.id);
    if (r.status >= 200 && r.status < 300 && id) {
      created.push({ id, title: c.title, steps: Array.isArray(tc.test_case_steps) ? tc.test_case_steps.length : null });
      console.log(`  [${String(i + 1).padStart(2)}/${cases.length}] ${id}  steps=${String(created[created.length - 1].steps).padStart(2)}  ${c.title.slice(0, 66)}`);
    } else {
      failed.push({ i: i + 1, title: c.title, status: r.status, err: JSON.stringify(r.json).slice(0, 220) });
      console.log(`  [${String(i + 1).padStart(2)}/${cases.length}] FAILED ${r.status} ${JSON.stringify(r.json).slice(0, 220)}`);
    }
  }

  const after = await folderInfo();
  console.log(`\ncreated ${created.length}/${cases.length} · failed ${failed.length}`);
  console.log(`cases in folder after: ${after && after.cases_count} (was ${before && before.cases_count})`);
  const noSteps = created.filter((c) => c.steps === 0);
  if (noSteps.length) console.log(`WARNING: ${noSteps.length} case(s) reported ZERO steps — check the payload key.`);
  if (failed.length) { console.log('\nfailures:'); failed.forEach((f) => console.log('  ', f.i, f.status, f.err)); }
  console.log(`\nfolder: https://test-management.browserstack.com/projects/2407303/folder/${FOLDER}/test-cases`);

  // emit the id↔title map the automation layer needs for @TmsLink binding
  require('fs').writeFileSync(require('path').resolve(__dirname, 'browserstack_case_map.json'),
    JSON.stringify({ project: PROJECT, folder: FOLDER, uploadedAt: new Date().toISOString(), cases: created }, null, 2));
  console.log('→ browserstack_case_map.json written (id ↔ title map for @TmsLink)');
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
