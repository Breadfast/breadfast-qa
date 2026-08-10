'use strict';

/**
 * B10-56711 — create a BrowserStack Test Management **test run** per platform, holding the story's
 * 23 uploaded test cases.
 *
 * One run PER PLATFORM on purpose. Both platform test classes carry the SAME `@TmsLink` ids (they are
 * mirrors — same test names, same case bindings), so a single shared run would let whichever platform
 * posted second overwrite the first, and each case would end up showing one platform's result while
 * appearing to speak for both.
 *
 * API v2 (docs/ai/browserstack-process.md §10.6 — v1 does not exist and 401s):
 *   POST /api/v2/projects/{PR-x}/test-runs   body: { test_run: { name, test_cases:[TC-…], … } }
 *
 * Usage:
 *   node create_browserstack_run.js --platform ios     --dry
 *   node create_browserstack_run.js --platform android
 */

const creds = require('../../automation/config/credentials.js');

const BASE = 'https://test-management.browserstack.com/api/v2';
const arg = (n, d) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : d; };
const PROJECT = arg('--project', 'PR-5');
const FOLDER = Number(arg('--folder', '53434687'));
const PLATFORM = arg('--platform', 'ios').toLowerCase();
const DRY = process.argv.includes('--dry');

const PLAT = {
  ios: {
    label: 'iOS',
    device: 'iPhone 13 / iOS 18',
    app: 'bs://fde72038… (breadfast.ipa build 1088)',
    when: '2026-08-03',
    build: '1088',
  },
  android: {
    label: 'Android',
    device: 'Samsung Galaxy S22 Ultra / Android 12',
    app: 'bs://e3c039d7… (app-tst-gms-release build 11169)',
    when: '2026-08-02',
    build: '11169',
  },
}[PLATFORM];
if (!PLAT) throw new Error(`unknown --platform ${PLATFORM} (expected ios|android)`);

const user = process.env.BS_TM_USERNAME || creds.browserstack.tmUsername();
const key = process.env.BS_TM_API_TOKEN || creds.browserstack.tmApiToken();
if (!user || !key) throw new Error('BrowserStack credentials unavailable from env or the credential loader.');
const AUTH = 'Basic ' + Buffer.from(`${user}:${key}`).toString('base64');
const H = { Authorization: AUTH, 'Content-Type': 'application/json', Accept: 'application/json' };

const get = async (p) => {
  const r = await fetch(BASE + p, { headers: H });
  return { status: r.status, json: await r.json().catch(() => null) };
};

/** Every test case in FOLDER — the list endpoint is paginated and returns the whole project. */
async function casesInFolder() {
  const out = [];
  for (let p = 1; p <= 20; p += 1) {
    const { json } = await get(`/projects/${PROJECT}/test-cases?p=${p}`);
    const list = (json && json.test_cases) || [];
    if (!list.length) break;
    out.push(...list.filter((t) => t.folder_id === FOLDER));
  }
  return out.sort((a, b) => Number(String(a.identifier).replace(/\D/g, '')) - Number(String(b.identifier).replace(/\D/g, '')));
}

(async () => {
  const cases = await casesInFolder();
  console.log(`project ${PROJECT} · folder ${FOLDER} · found ${cases.length} test cases`);
  if (!cases.length) throw new Error('no test cases in the folder — upload them first (upload_browserstack.js)');

  const ids = cases.map((c) => c.identifier);
  const body = {
    test_run: {
      name: `B10-56711 — Perk Details: Screen Redesign (${PLAT.label})`,
      description:
        `Post-development validation run (Workflow 2) for B10-56711, ${PLAT.label} leg.${String.fromCharCode(10)}`
        + `Device: ${PLAT.device}. App: ${PLAT.app}.${String.fromCharCode(10)}`
        + `Results are back-filled from the suite execution of ${PLAT.when} (App Automate build `
        + `${PLAT.build}) — the suite was NOT re-run to populate this test run. 17 of the 23 cases are `
        + `automated in the Java framework and carry results; the remaining 6 are visual, clipboard or `
        + `Arabic cases with no automated test and are deliberately left untested here.${String.fromCharCode(10)}`
        + `One run per platform because both platform classes share the same @TmsLink ids.`,
      run_state: 'new_run',
      assignee: user.includes('@') ? user : 'qc.fintech@breadfast.com',
      tags: ['ai-created', 'B10-56711', `platform-${PLATFORM}`],
      issues: ['B10-56711'],
      test_cases: ids,
      include_all: false,
    },
  };

  if (DRY) {
    console.log('DRY RUN — payload:');
    console.log(JSON.stringify({ test_run: { ...body.test_run, test_cases: `${ids.length} ids: ${ids.slice(0, 3).join(',')}…${ids[ids.length - 1]}` } }, null, 2));
    return;
  }

  const r = await fetch(`${BASE}/projects/${PROJECT}/test-runs`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 400) }; }
  if (r.status >= 300) { console.log('CREATE FAILED', r.status, JSON.stringify(json).slice(0, 500)); process.exit(1); }

  const run = json.test_run || (json.data && json.data.test_run) || json;
  const id = run.identifier || run.id;
  console.log(`${String.fromCharCode(10)}CREATED test run ${id} — "${run.name || body.test_run.name}"`);
  console.log(`url: https://test-management.browserstack.com/projects/2407303/test-runs/${id}`);

  const chk = await get(`/projects/${PROJECT}/test-runs/${id}/test-cases?p=1`);
  const info = chk.json && chk.json.info;
  console.log(`cases attached: ${info ? info.count : 'unknown'} (expected ${ids.length})`);
  console.log(`${String.fromCharCode(10)}runId=${id}`);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
