'use strict';

/**
 * B10-56750 — create a BrowserStack Test Management **test run** containing the
 * story's uploaded test cases.
 *
 * API v2 (see docs/ai/browserstack-process.md §10.6 — v1 does not exist and 401s):
 *   POST /api/v2/projects/{PR-x}/test-runs   body: { test_run: { name, test_cases:[TC-…], … } }
 *
 * Usage:
 *   node create_browserstack_run.js --dry
 *   node create_browserstack_run.js [--project PR-5] [--folder 53074476] [--name "..."]
 */

const creds = require('../../automation/config/credentials.js');

const BASE = 'https://test-management.browserstack.com/api/v2';
const arg = (n, d) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : d; };
const PROJECT = arg('--project', 'PR-5');
const FOLDER = Number(arg('--folder', '53074476'));
const RUN_NAME = arg('--name', 'B10-56750 — Admin Portal: Add Section (Selection) to All Perk Types');
const DRY = process.argv.includes('--dry');

const user = process.env.BS_TM_USERNAME || creds.browserstack.tmUsername();
const key = process.env.BS_TM_API_TOKEN || creds.browserstack.tmApiToken();
const AUTH = 'Basic ' + Buffer.from(`${user}:${key}`).toString('base64');
const H = { Authorization: AUTH, 'Content-Type': 'application/json', Accept: 'application/json' };

async function get(path) {
  const r = await fetch(BASE + path, { headers: H });
  return { status: r.status, json: await r.json().catch(() => null) };
}

/** Collect every test case that lives in FOLDER (the list endpoint is paginated). */
async function casesInFolder() {
  const out = [];
  for (let p = 1; p <= 20; p += 1) {
    const { json } = await get(`/projects/${PROJECT}/test-cases?p=${p}`);
    const list = (json && json.test_cases) || [];
    if (!list.length) break;
    out.push(...list.filter((t) => t.folder_id === FOLDER));
  }
  // Stable order = the order they were created (TC ids ascend).
  return out.sort((a, b) => Number(String(a.identifier).replace(/\D/g, '')) - Number(String(b.identifier).replace(/\D/g, '')));
}

(async () => {
  const cases = await casesInFolder();
  console.log(`project ${PROJECT} · folder ${FOLDER} · found ${cases.length} test cases`);
  if (!cases.length) throw new Error('no test cases in the folder — upload them first (upload_browserstack.js)');

  const ids = cases.map((c) => c.identifier);
  const body = {
    test_run: {
      name: RUN_NAME,
      description:
        'Post-development validation run (Workflow 2) for B10-56750. Executed against '
        + 'card-panel-testing, Breadfast Pay admin panel v2.4.5, web + English. Results are pushed from the '
        + 'Playwright suite in B10-56750/automation/tests.',
      run_state: 'new_run',
      assignee: user.includes('@') ? user : 'qc.fintech@breadfast.com',
      tags: ['ai-created', 'B10-56750'],
      issues: ['B10-56750'],
      test_cases: ids,
      include_all: false,
    },
  };

  if (DRY) {
    console.log('DRY RUN — payload:');
    console.log(JSON.stringify({ ...body, test_run: { ...body.test_run, test_cases: `${ids.length} ids: ${ids.slice(0, 3).join(',')}…` } }, null, 2));
    return;
  }

  const r = await fetch(`${BASE}/projects/${PROJECT}/test-runs`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 400) }; }
  if (r.status >= 300) { console.log('CREATE FAILED', r.status, JSON.stringify(json).slice(0, 500)); process.exit(1); }

  const run = json.test_run || (json.data && json.data.test_run) || json;
  const id = run.identifier || run.id;
  console.log(`\nCREATED test run ${id} — "${run.name || RUN_NAME}"`);
  console.log(`url: https://test-management.browserstack.com/projects/2407303/test-runs/${id}`);

  // Verify the cases actually landed in the run.
  const chk = await get(`/projects/${PROJECT}/test-runs/${id}/test-cases?p=1`);
  const info = chk.json && chk.json.info;
  console.log(`cases attached to the run: ${info ? info.count : 'unknown'} (expected ${ids.length})`);
  console.log('\nrunId=' + id);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
