#!/usr/bin/env node
/**
 * Reconcile a WHOLE BrowserStack folder against a story's approved CSV — update / create / delete
 * by `TC-xxxx`, in one auditable pass.
 *
 * `sync_test_case.js` updates ONE case. Workflow 2 phase 4 needs the folder-level operation: after
 * validation reconciles the approved suite, the deltas are applied to the EXISTING folder. Re-running
 * `upload_browserstack.js` would post the whole CSV again, duplicating the folder and orphaning every
 * `@TmsLink` (browserstack-process.md §10.5).
 *
 * Usage:
 *   node automation/browserstack/reconcile_folder.js --story-dir B10-57774 --plan <plan.json> --dry
 *   node automation/browserstack/reconcile_folder.js --story-dir B10-57774 --plan <plan.json>
 *
 * The plan is explicit, because "figure out the deltas by matching titles" is how a reconcile quietly
 * deletes the wrong case. It maps every case in the approved CSV to either an existing TC id (update)
 * or null (create), and lists the ids to delete:
 *
 *   { "project": "PR-5", "folder": 54241929,
 *     "cases":  [ {"n": 1, "tc": "TC-54946"}, ..., {"n": 11, "tc": null} ],
 *     "delete": [ "TC-54950", "TC-54957", ... ] }
 *
 * Safety properties, each earned from a real failure mode:
 *   - the plan must cover EVERY case in the CSV (`n` = 1-based order), or it exits before writing;
 *   - an id may not appear in both `cases` and `delete`;
 *   - the live folder is READ FIRST: every update target and every delete target must actually be
 *     there, and any case in the folder that the plan does not mention is reported as unaccounted —
 *     a reconcile that silently ignores strangers is how a stale case survives a re-scope;
 *   - **deletes run LAST**, after updates and creates have been verified. A crash mid-run then leaves a
 *     superset of the intended folder, never a gap;
 *   - every write is verified by READING IT BACK. A 200 from this API is not proof;
 *   - `--dry` prints the full effect including per-case title and step-count diffs, and writes nothing.
 *
 * Two v2 traps this handles (browserstack-process.md §10.6 · [[browserstack-tm-field-asymmetry]]):
 *   - the payload is wrapped in a `test_case` envelope and steps go in `test_case_steps` (a bare
 *     `steps` array returns 200 and saves nothing);
 *   - POST/PATCH take `name`/`test_case_steps` but GET returns `title`/`steps`, so the read-back
 *     verifier compares against the READ-side keys or it falsely reports the write as missing.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const creds = require(path.join(REPO, 'automation/config/credentials.js'));
const P = require(path.join(REPO, 'qa-workflow/lib/testcases/parse.js'));

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i < 0 ? d : args[i + 1]; };
const has = (n) => args.includes(`--${n}`);

const STORY = flag('story-dir');
const PLAN_PATH = flag('plan');
const DRY = has('dry');
if (!STORY || !PLAN_PATH) {
  console.error('usage: --story-dir <dir> --plan <plan.json> [--dry]');
  process.exit(2);
}

const storyDir = path.resolve(REPO, STORY);
const plan = JSON.parse(fs.readFileSync(path.resolve(PLAN_PATH), 'utf8'));
const PROJECT = plan.project || 'PR-5';
const FOLDER = plan.folder;
if (!FOLDER) { console.error('plan has no `folder`'); process.exit(2); }

const BASE = 'https://test-management.browserstack.com/api/v2';
const AUTH = 'Basic ' + Buffer.from(`${creds.browserstack.tmUsername()}:${creds.browserstack.tmApiToken()}`).toString('base64');

async function call(method, p, body) {
  const res = await fetch(BASE + p, {
    method,
    headers: { Authorization: AUTH, 'Content-Type': 'application/json', Accept: 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 400) }; }
  return { status: res.status, json };
}
const unwrapCase = (j) => (j.data || j).test_case || j.test_case || j;
const strip = (s) => String(s == null ? '' : s).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ').trim();

const CASE_TYPE = { Functional: 'Functional', Regression: 'Regression', Acceptance: 'Acceptance', Smoke: 'Smoke' };
const AUTOMATION = { 'Not Automated': 'not_automated', Automated: 'automated', 'Automation Not Required': 'automation_not_required' };

const payloadFor = (c) => ({
  test_case: {
    name: c.title,
    description: c.description,
    preconditions: c.preconditions,
    case_type: CASE_TYPE[c.type] || 'Functional',
    priority: c.priority,
    status: 'Active',
    template: 'test_case_steps',
    automation_status: AUTOMATION[c.automationStatus] || 'not_automated',
    tags: c.tags,
    issues: c.issues ? [c.issues] : [],
    test_case_steps: c.steps.map((s) => ({ step: s.step, result: s.expected })),
  },
});

/** Read every case currently in the folder, following pagination. */
async function listFolder() {
  let page = 1; const all = [];
  for (;;) {
    const r = await call('GET', `/projects/${PROJECT}/test-cases?folder_id=${FOLDER}&p=${page}`);
    if (r.status !== 200) throw new Error(`listing folder ${FOLDER} page ${page}: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
    const d = r.json.data || r.json;
    const arr = d.test_cases || d.testcases || [];
    all.push(...arr);
    const count = (r.json.info || d.info || {}).count;
    if (!arr.length || (count != null && all.length >= count) || page > 40) break;
    page++;
  }
  return all;
}

(async () => {
  // ── the approved CSV is the source of truth for CONTENT ────────────────────
  const csvPath = path.join(storyDir, 'testcases/testcases.csv');
  const approvedPath = path.join(storyDir, 'testcases/testcases.approved.csv');
  const csvText = fs.readFileSync(csvPath, 'utf8');
  if (fs.existsSync(approvedPath) && fs.readFileSync(approvedPath, 'utf8') !== csvText) {
    console.error('REFUSING: testcases.csv differs from testcases.approved.csv — the CSV changed after');
    console.error('approval. Re-run the review gate, or re-approve, before syncing.');
    process.exit(1);
  }
  const { cases, headerOk, orphanRows } = P.parseTestCases(csvText);
  if (!headerOk) { console.error('REFUSING: CSV header is not the canonical 24 columns'); process.exit(1); }
  if (orphanRows.length) { console.error(`REFUSING: ${orphanRows.length} orphan step row(s)`); process.exit(1); }
  console.log(`approved CSV: ${cases.length} cases · ${cases.reduce((n, c) => n + c.steps.length, 0)} steps`);

  // ── validate the plan against the CSV ─────────────────────────────────────
  const byN = new Map();
  for (const e of plan.cases || []) {
    if (!Number.isInteger(e.n) || e.n < 1 || e.n > cases.length) {
      console.error(`REFUSING: plan case n=${JSON.stringify(e.n)} is outside 1..${cases.length}`); process.exit(1);
    }
    if (byN.has(e.n)) { console.error(`REFUSING: plan has duplicate n=${e.n}`); process.exit(1); }
    byN.set(e.n, e.tc || null);
  }
  const missing = [];
  for (let n = 1; n <= cases.length; n++) if (!byN.has(n)) missing.push(n);
  if (missing.length) { console.error(`REFUSING: plan does not cover case(s) ${missing.join(', ')}`); process.exit(1); }

  const del = [...new Set(plan.delete || [])];
  const updIds = [...byN.values()].filter(Boolean);
  const both = updIds.filter((tc) => del.includes(tc));
  if (both.length) { console.error(`REFUSING: ${both.join(', ')} appear in both cases and delete`); process.exit(1); }

  // ── read the live folder BEFORE deciding anything ─────────────────────────
  const live = await listFolder();
  const liveIds = new Set(live.map((c) => String(c.identifier)));
  const liveById = new Map(live.map((c) => [String(c.identifier), c]));
  console.log(`live folder ${FOLDER}: ${live.length} case(s)`);

  const updMissing = updIds.filter((tc) => !liveIds.has(tc));
  const delMissing = del.filter((tc) => !liveIds.has(tc));
  const unaccounted = [...liveIds].filter((tc) => !updIds.includes(tc) && !del.includes(tc));
  if (updMissing.length) { console.error(`REFUSING: update target(s) not in the folder: ${updMissing.join(', ')}`); process.exit(1); }
  if (delMissing.length) { console.error(`REFUSING: delete target(s) not in the folder: ${delMissing.join(', ')}`); process.exit(1); }
  if (unaccounted.length) {
    console.error(`REFUSING: ${unaccounted.length} case(s) in the folder are in neither list: ${unaccounted.join(', ')}`);
    console.error('Add them to `delete` or map them in `cases`. A reconcile must account for every case.');
    process.exit(1);
  }

  const creates = [...byN.entries()].filter(([, tc]) => !tc).map(([n]) => n).sort((a, b) => a - b);
  console.log(`\nplan: update ${updIds.length} · create ${creates.length} · delete ${del.length}`);
  console.log(`      ${live.length} live  →  ${live.length - del.length + creates.length} after\n`);

  // ── the effect, per case ──────────────────────────────────────────────────
  console.log('UPDATE (in place, TC id preserved)');
  for (let n = 1; n <= cases.length; n++) {
    const tc = byN.get(n); if (!tc) continue;
    const c = cases[n - 1]; const before = liveById.get(tc);
    const oldTitle = strip(before.title || before.name);
    const oldSteps = (before.steps || before.test_case_steps || []).length;
    const titleChanged = oldTitle !== strip(c.title);
    console.log(`  ${tc}  C-${String(n).padStart(2, '0')}  steps ${oldSteps} -> ${c.steps.length}${oldSteps !== c.steps.length ? '  *' : ''}`);
    if (titleChanged) {
      console.log(`      title CHANGED`);
      console.log(`        was: ${oldTitle}`);
      console.log(`        now: ${strip(c.title)}`);
    }
  }
  console.log('\nCREATE (new TC id assigned by BrowserStack)');
  creates.forEach((n) => console.log(`  C-${String(n).padStart(2, '0')}  ${cases[n - 1].steps.length} steps  ${cases[n - 1].title}`));
  console.log('\nDELETE');
  del.forEach((tc) => console.log(`  ${tc}  ${strip((liveById.get(tc) || {}).title).slice(0, 78)}`));

  if (DRY) { console.log('\nDRY RUN — nothing written.'); return; }

  // ── writes: updates, then creates, then deletes ───────────────────────────
  const map = { project: PROJECT, folder: FOLDER, folderName: plan.folderName || null, story: path.basename(storyDir), cases: [] };
  const fail = [];

  console.log('\n── updating ──');
  for (let n = 1; n <= cases.length; n++) {
    const tc = byN.get(n); if (!tc) continue;
    const c = cases[n - 1];
    const r = await call('PATCH', `/projects/${PROJECT}/test-cases/${tc}`, payloadFor(c));
    if (r.status >= 400) { fail.push(`PATCH ${tc}: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`); continue; }
    const back = unwrapCase((await call('GET', `/projects/${PROJECT}/test-cases/${tc}`)).json);
    const got = (back.steps || back.test_case_steps || []);
    const okTitle = strip(back.title || back.name) === strip(c.title);
    const okSteps = got.length === c.steps.length
      && c.steps.every((s, i) => strip(got[i].result) === strip(s.expected));
    console.log(`  ${tc}  C-${String(n).padStart(2, '0')}  HTTP ${r.status}  title ${okTitle ? 'ok' : 'MISMATCH'}  steps ${got.length}/${c.steps.length} ${okSteps ? 'ok' : 'MISMATCH'}`);
    if (!okTitle || !okSteps) {
      fail.push(`${tc} read-back mismatch (title ${okTitle}, steps ${okSteps})`);
      if (!okSteps) c.steps.forEach((s, i) => { if (strip((got[i] || {}).result) !== strip(s.expected)) console.log(`      step ${i + 1}\n        want: ${strip(s.expected).slice(0, 150)}\n        got : ${strip((got[i] || {}).result).slice(0, 150)}`); });
    }
    map.cases.push({ ref: `C-${String(n).padStart(2, '0')}`, tc, title: c.title, steps: c.steps.length, action: 'updated', verified: okTitle && okSteps });
  }

  console.log('\n── creating ──');
  for (const n of creates) {
    const c = cases[n - 1];
    const r = await call('POST', `/projects/${PROJECT}/folders/${FOLDER}/test-cases`, payloadFor(c));
    if (r.status >= 400) { fail.push(`POST C-${n}: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`); continue; }
    const made = unwrapCase(r.json);
    const tc = String(made.identifier || made.id);
    const back = unwrapCase((await call('GET', `/projects/${PROJECT}/test-cases/${tc}`)).json);
    const got = (back.steps || back.test_case_steps || []);
    // Verify by TITLE, not by position: a positional map shifts every later binding by one if a
    // single create fails, and every @TmsLink then points at the wrong case.
    const okTitle = strip(back.title || back.name) === strip(c.title);
    const okSteps = got.length === c.steps.length;
    console.log(`  ${tc}  C-${String(n).padStart(2, '0')}  HTTP ${r.status}  title ${okTitle ? 'ok' : 'MISMATCH'}  steps ${got.length}/${c.steps.length} ${okSteps ? 'ok' : 'MISMATCH'}`);
    if (!okTitle || !okSteps) fail.push(`${tc} (created) read-back mismatch`);
    map.cases.push({ ref: `C-${String(n).padStart(2, '0')}`, tc, title: c.title, steps: c.steps.length, action: 'created', verified: okTitle && okSteps });
  }

  if (fail.length) {
    console.error('\nSTOPPING BEFORE DELETES — updates/creates did not all verify:');
    fail.forEach((f) => console.error('  ' + f));
    console.error('\nNothing was deleted. The folder is a superset of the intended state; fix and re-run.');
    process.exit(1);
  }

  console.log('\n── deleting ──');
  const delFail = [];
  for (const tc of del) {
    const r = await call('DELETE', `/projects/${PROJECT}/test-cases/${tc}`);
    const gone = await call('GET', `/projects/${PROJECT}/test-cases/${tc}`);
    const ok = r.status < 400 && gone.status === 404;
    console.log(`  ${tc}  DELETE HTTP ${r.status}  read-back ${gone.status}  ${ok ? 'gone' : 'STILL PRESENT'}`);
    if (!ok) delFail.push(`${tc}: delete ${r.status}, read-back ${gone.status}`);
  }

  // ── final verification against the folder itself ──────────────────────────
  const after = await listFolder();
  const expect = cases.length;
  console.log(`\nfolder ${FOLDER}: ${after.length} case(s)  (expected ${expect})`);
  const afterIds = new Set(after.map((c) => String(c.identifier)));
  const leftover = del.filter((tc) => afterIds.has(tc));
  const wanted = map.cases.map((m) => m.tc);
  const absent = wanted.filter((tc) => !afterIds.has(tc));

  fs.mkdirSync(path.join(storyDir, 'testcases'), { recursive: true });
  fs.writeFileSync(path.join(storyDir, 'testcases/tc-map.json'), JSON.stringify(map, null, 2));
  console.log(`wrote testcases/tc-map.json (${map.cases.length} entries)`);

  const problems = [...delFail];
  if (after.length !== expect) problems.push(`folder holds ${after.length} cases, expected ${expect}`);
  if (leftover.length) problems.push(`still present after delete: ${leftover.join(', ')}`);
  if (absent.length) problems.push(`expected but absent: ${absent.join(', ')}`);
  if (problems.length) { console.error('\nRECONCILE INCOMPLETE:'); problems.forEach((p) => console.error('  ' + p)); process.exit(1); }

  console.log('\nReconcile complete and verified.');
  console.log(`  ${map.cases.filter((c) => c.action === 'updated').length} updated · `
    + `${map.cases.filter((c) => c.action === 'created').length} created · ${del.length} deleted`);
})().catch((e) => { console.error('RECONCILE FAILED:', e.message); process.exit(1); });
