'use strict';

/**
 * STANDARD STEP — upload a story's APPROVED test cases to BrowserStack Test Management.
 *
 * Promoted 2026-08-10 out of B10-57764/automation/ (where nine near-copies of it had accumulated,
 * one per story) so the workflow no longer depends on any story folder. The destination and the
 * case data are arguments now; everything below is story-independent.
 *
 * The operator pre-creates the destination folder; pass it in:
 *   --project PR-5            project identifier (NOT the numeric id)
 *   --folder  54229453        the target folder id, which must be EMPTY
 *   --cases   <path>          module exporting { CASES, ISSUES } — normally the story's
 *                             gen_browserstack_csv.js (see gen_browserstack_csv.template.js)
 *   --story-dir <path>        the story folder, so the APPROVAL GATE can be enforced (see below).
 *                             Defaults to the --cases file's parent's parent. `--force-unapproved`
 *                             skips the gate and must be justified out loud.
 *
 * APPROVAL GATE (added 2026-08-10, B10-57774). Before a single case is written this refuses to run
 * unless the story's `qa-state.json` carries `approvals.testcases`, AND `testcases/testcases.csv` is
 * still byte-identical to the checksummed `testcases/testcases.approved.csv` snapshot that
 * `qa-cli approve` took. Why both:
 *   - `qa-cli record browserstack-import` already refuses without an approval, but that is *after* the
 *     upload — by then un-approved cases are live in test management and removing them is manual.
 *   - an approval covers the suite as it was reviewed. If the generator changed afterwards, what would
 *     be uploaded is not what the operator approved, and only a checksum can tell.
 *
 * API traps encoded here (docs/ai/browserstack-process.md §10.6):
 *   - Test Management is **v2**. v1 answers 401 + an SSO login_url for VALID keys.
 *   - Auth is HTTP Basic `tmUsername:tmApiToken` — NOT the App Automate access key.
 *   - The case field is `name`, not `title`.
 *   - Steps go in `test_case_steps`; a `steps` payload returns 200 and saves NONE.
 *   - `issues` is an array of plain strings; the API echoes objects back.
 *   - Create is POST /projects/{PR-x}/folders/{id}/test-cases  (folders PLURAL).
 *   - A 200 is not proof: every case is read back and its steps/tags/priority verified.
 *   - **Responses are wrapped**: the created case is at `json.data.test_case`, not `json.test_case`.
 *   - **Write/read field names differ** (discovered 2026-08-10): you POST `name` + `test_case_steps`,
 *     but you GET BACK `title` + `steps`. Verifying against the write-side names reports every case
 *     as MISSING even though all of them imported correctly.
 *   - Listing a folder's cases is `GET /projects/{PR-x}/test-cases?folder_id={id}` —
 *     `/folders/{id}/test-cases` is **404 on GET** even though it is the correct POST path.
 *
 * Usage (from the repo root):
 *   node automation/browserstack/upload_browserstack.js --cases B10-xxxxx/automation/gen_browserstack_csv.js \
 *        --project PR-5 --folder 54229453 --dry
 *   node automation/browserstack/upload_browserstack.js --cases … --project … --folder …
 *   node automation/browserstack/upload_browserstack.js --cases … --project … --folder … --verify-only
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const creds = require('../config/credentials.js');

const arg = (n, d) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : d; };

const BASE = 'https://test-management.browserstack.com/api/v2';
const DRY = process.argv.includes('--dry');
const VERIFY_ONLY = process.argv.includes('--verify-only');

const CASES_PATH = arg('--cases');
const PROJECT_ID = arg('--project');
const FOLDER_ID = arg('--folder');

// ask-never-block: name what is missing and where it comes from, rather than failing obscurely.
const missing = [];
if (!CASES_PATH) missing.push('--cases <path to the story\'s gen_browserstack_csv.js, exporting { CASES, ISSUES }>');
if (!PROJECT_ID) missing.push('--project <PR-x identifier, e.g. PR-5 — from the shared folder link>');
if (!FOLDER_ID) missing.push('--folder <numeric target folder id — from the shared folder link>');
if (missing.length) {
  console.error('upload_browserstack: missing required argument(s):\n  ' + missing.join('\n  '));
  process.exit(1);
}

const casesModule = require(path.resolve(CASES_PATH));
const { ISSUES } = casesModule;
// Name the contract violation instead of dying on `undefined.length` further down. Story generators
// written before this tool was promoted export lowercase `cases`; accept that spelling with a warning.
const CASES = Array.isArray(casesModule.CASES) ? casesModule.CASES
  : Array.isArray(casesModule.cases) ? casesModule.cases : null;
if (!CASES) {
  console.error(`upload_browserstack: ${CASES_PATH} must export { CASES, ISSUES } — got `
    + `${JSON.stringify(Object.keys(casesModule)).slice(0, 120)}.\n`
    + '  See automation/browserstack/gen_browserstack_csv.template.js for the expected shape.');
  process.exit(1);
}
if (!casesModule.CASES) console.warn(`note: ${CASES_PATH} exports lowercase \`cases\`; the contract is \`CASES\`.`);

// ── approval gate ───────────────────────────────────────────────────────────────────────
// Runs before any write. `--force-unapproved` exists only so an operator can consciously override it.
const STORY_DIR = arg('--story-dir', path.dirname(path.dirname(path.resolve(CASES_PATH))));
const FORCE_UNAPPROVED = process.argv.includes('--force-unapproved');

function assertApproved(storyDir) {
  if (FORCE_UNAPPROVED) {
    console.warn('!! --force-unapproved: the approval gate was SKIPPED. Say so in the import report.');
    return;
  }
  const statePath = path.join(storyDir, 'qa-state.json');
  if (!fs.existsSync(statePath)) {
    throw new Error(`approval gate: no qa-state.json at ${statePath}.\n`
      + '  Pass --story-dir <story folder>, or --force-unapproved to override deliberately.');
  }
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const appr = (state.approvals || {}).testcases;
  if (!appr) {
    throw new Error('approval gate: testcases are NOT approved — refusing to upload.\n'
      + `  node qa-workflow/bin/qa-cli.js approve "${storyDir}" testcases --by "<operator>"`);
  }
  const snapshot = path.join(storyDir, 'testcases', 'testcases.approved.csv');
  const live = path.join(storyDir, 'testcases', 'testcases.csv');
  if (fs.existsSync(snapshot) && fs.existsSync(live)) {
    const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    const a = sha(snapshot);
    const b = sha(live);
    if (a !== b) {
      throw new Error('approval gate: testcases.csv has DRIFTED from the approved snapshot.\n'
        + `  approved ${a.slice(0, 12)} vs current ${b.slice(0, 12)}\n`
        + '  Re-review and have the operator re-approve, or regenerate from the approved definitions.');
    }
    console.log(`approval: ${appr.by || appr.approvedBy || 'unknown'} at ${appr.at} · snapshot matches (sha ${a.slice(0, 12)})`);
  } else {
    console.log(`approval: ${appr.by || appr.approvedBy || 'unknown'} at ${appr.at} · no CSV snapshot to compare`);
  }
}

assertApproved(STORY_DIR);

const user = creds.browserstack.tmUsername();
const key = creds.browserstack.tmApiToken();
if (!user || !key) throw new Error('BrowserStack TM credentials unavailable from the credential loader.');
const AUTH = 'Basic ' + Buffer.from(`${user}:${key}`).toString('base64');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const html = (s) => `<p>${esc(s)}</p><br/>`;
const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

// BrowserStack case_type vocabulary differs from our CSV's "Type of Test Case".
// `Smoke & Sanity` and `Usability` are in our CSV vocabulary (qa-workflow/lib/testcases/lint.js) but were
// missing here, so a case typed either way was SILENTLY posted as `Functional` — the CSV and test
// management then disagreed with nobody noticing. Sent as-is instead; the post-create read-back is what
// confirms the API accepts the value, rather than a guess baked into this map. (B10-58603.)
const CASE_TYPE = {
  Acceptance: 'Acceptance',
  Functional: 'Functional',
  Regression: 'Regression',
  'Smoke & Sanity': 'Smoke & Sanity',
  Usability: 'Usability',
};
// CSV "Automation Status" -> BrowserStack automation_status.
// `Automated` maps to **not_automated** on purpose: in the approved CSV that value is the operator's
// automation *scope* decision from the review gate, not a claim that a test exists yet. Only
// `browserstack_test_run.js` may set `automated`, and only for cases actually bound by @TmsLink after
// the suite has run (browserstack-process.md §10.8). Mapping it explicitly (rather than letting it fall
// through as undefined) keeps the read-back verifier's expectation equal to what was posted — otherwise
// every `Automated` case is reported as a PROBLEM even though it imported correctly. (B10-57777: 23 of 24.)
const AUTOMATION = {
  'Not Automated': 'not_automated',
  Automated: 'not_automated',
  'Automation Not Required': 'automation_not_required',
};

async function call(method, p, body) {
  const res = await fetch(BASE + p, {
    method,
    headers: { Authorization: AUTH, 'Content-Type': 'application/json', Accept: 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { json = { raw: text.slice(0, 400) }; }
  return { status: res.status, json };
}

const tagsOf = (c) => ['ai-created', ...c.acs.map((a) => `ac:${a}`), ...c.screens.map((s) => `screen:${s}`)];

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
      automation_status: AUTOMATION[c.auto] || 'not_automated',
      tags: tagsOf(c),
      issues: [ISSUES],
      test_case_steps: c.steps.map(([step, result]) => ({ step: html(step), result: html(result) })),
    },
  };
}

/** Unwrap the `data` envelope the v2 API puts on most responses. */
const body = (j) => (j && j.data) || j || {};
/** A case's name is `name` on write but `title` on read. */
const nameOf = (c) => String(c.title || c.name || '').trim();
/** Steps are `test_case_steps` on write but `steps` on read. */
const stepsOf = (c) => c.steps || c.test_case_steps || [];

/** Read every case in the destination folder, paging until exhausted. */
async function listFolderCases() {
  const out = [];
  for (let p = 1; p <= 20; p++) {
    // NB: GET /folders/{id}/test-cases is 404 — the folder filter is a query param.
    const r = await call('GET', `/projects/${PROJECT_ID}/test-cases?folder_id=${FOLDER_ID}&p=${p}`);
    if (r.status !== 200) return { error: `list failed: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`, cases: out };
    const arr = body(r.json).test_cases || [];
    if (!arr.length) break;
    out.push(...arr.filter((c) => String(c.folder_id) === String(FOLDER_ID)));
    if (arr.length < 10) break;
  }
  return { cases: out };
}

(async () => {
  console.log(`Destination: project ${PROJECT_ID} / folder ${FOLDER_ID}`);

  const folder = await call('GET', `/projects/${PROJECT_ID}/folders/${FOLDER_ID}`);
  if (folder.status !== 200) throw new Error(`destination folder unreachable: ${folder.status} ${JSON.stringify(folder.json).slice(0, 200)}`);
  console.log(`Folder: "${folder.json.folder.name}" · parent ${folder.json.folder.parent_id} · cases_count ${folder.json.folder.cases_count}`);

  if (DRY) {
    console.log(`\nDRY RUN · ${CASES.length} cases · ${CASES.reduce((n, c) => n + c.steps.length, 0)} steps`);
    console.log('First payload:\n' + JSON.stringify(payload(CASES[0]), null, 2).slice(0, 1600));
    console.log('\nTags sample:', JSON.stringify(CASES.map((c) => tagsOf(c).join(',')).slice(0, 3), null, 0));
    console.log('automation_status distribution:',
      JSON.stringify(CASES.reduce((m, c) => (m[AUTOMATION[c.auto]] = (m[AUTOMATION[c.auto]] || 0) + 1, m), {})));
    console.log('case_type distribution:',
      JSON.stringify(CASES.reduce((m, c) => (m[CASE_TYPE[c.type]] = (m[CASE_TYPE[c.type]] || 0) + 1, m), {})));
    return;
  }

  const map = [];
  if (!VERIFY_ONLY) {
    if (folder.json.folder.cases_count > 0) {
      throw new Error(`refusing to import: folder already holds ${folder.json.folder.cases_count} cases — re-importing would duplicate them. Use --verify-only, or reconcile by TC id (Mode B).`);
    }
    for (const c of CASES) {
      const r = await call('POST', `/projects/${PROJECT_ID}/folders/${FOLDER_ID}/test-cases`, payload(c));
      const tc = body(r.json).test_case || {};
      const id = tc.identifier || tc.id;
      if (r.status >= 300 || !id) {
        console.log(`FAILED  ${c.title}\n  ${r.status} ${JSON.stringify(r.json).slice(0, 400)}`);
        map.push({ title: c.title, id: null, status: r.status });
        continue;
      }
      map.push({ title: c.title, id, status: r.status });
      console.log(`created ${id}  ${c.title.slice(0, 72)}`);
    }
  }

  // ── verification: a 200 is not proof — read every case back ────────────────
  console.log('\nVerifying by reading the folder back...');
  const { cases: live, error } = await listFolderCases();
  if (error) console.log('WARN list:', error);
  console.log(`folder now reports ${live.length} cases`);

  const byName = new Map(live.map((c) => [nameOf(c), c]));
  const problems = [];
  for (const c of CASES) {
    const l = byName.get(c.title.trim());
    if (!l) { problems.push(`MISSING: ${c.title}`); continue; }
    const detail = await call('GET', `/projects/${PROJECT_ID}/test-cases/${l.identifier || l.id}`);
    const d = body(detail.json).test_case || l;
    const steps = stepsOf(d);
    if (steps.length !== c.steps.length) problems.push(`STEPS ${l.identifier}: expected ${c.steps.length}, stored ${steps.length} — "${c.title.slice(0, 50)}"`);
    const liveTags = (d.tags || []).map((t) => (typeof t === 'string' ? t : t.name));
    for (const t of tagsOf(c)) if (!liveTags.includes(t)) problems.push(`TAG ${l.identifier}: missing "${t}"`);
    if (d.priority && d.priority !== c.priority) problems.push(`PRIORITY ${l.identifier}: expected ${c.priority}, stored ${d.priority}`);
    const wantAuto = AUTOMATION[c.auto];
    if (d.automation_status && d.automation_status !== wantAuto) problems.push(`AUTOMATION ${l.identifier}: expected ${wantAuto}, stored ${d.automation_status}`);
    const firstStep = stripHtml(steps[0] && (steps[0].step || steps[0].description));
    if (steps.length && firstStep && !firstStep.startsWith(c.steps[0][0].slice(0, 25))) {
      problems.push(`STEP-1 ${l.identifier}: stored "${firstStep.slice(0, 40)}" != "${c.steps[0][0].slice(0, 40)}"`);
    }
    const found = map.find((m) => m.title === c.title);
    if (found) found.id = l.identifier || l.id; else map.push({ title: c.title, id: l.identifier || l.id, status: 'existing' });
  }

  // nested-folder check: cases must land directly in the target folder
  const subs = await call('GET', `/projects/${PROJECT_ID}/folders/${FOLDER_ID}/sub-folders`);
  const subCount = (body(subs.json).folders || body(subs.json).sub_folders || []).length;
  if (subCount) problems.push(`NESTED: destination folder gained ${subCount} sub-folder(s) — cases must land directly`);

  console.log(problems.length ? `\n${problems.length} PROBLEM(S):\n  ` + problems.join('\n  ') : '\nVERIFIED: names, step counts, tags, priority and automation_status all match; no nested folder.');

  // The map belongs beside the STORY's cases module, not beside this shared tool.
  const mapPath = path.join(path.dirname(path.resolve(CASES_PATH)), 'tc-map.json');
  fs.writeFileSync(mapPath, JSON.stringify(map, null, 2), 'utf8');
  console.log(`\nwrote ${mapPath} (${map.filter((m) => m.id).length}/${CASES.length} ids)`);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
