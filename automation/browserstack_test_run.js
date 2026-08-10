'use strict';

/**
 * STANDARD STEP — BrowserStack Test Management run, for ANY story.
 *
 * Give it the test-case FOLDER LINK you were shared. It derives everything else, then:
 *   1. resolves the folder link  ->  numeric project id + folder id  ->  project identifier `PR-x`
 *   2. lists the test cases in that folder
 *   3. indexes the story's automated tests by scanning the Java framework for `@TmsLink("TC-…")`
 *   4. flips `automation_status` to **automated** on every case that has an automated test
 *   5. creates one test RUN PER PLATFORM (or reuses the run it already made)
 *   6. fills each run from the recorded App Automate sessions — latest session per test name
 *   7. VERIFIES by reading back: automation_status, attached case count, per-case latest_status
 *
 * Why one run per platform: mirrored platform classes carry the SAME `@TmsLink` ids, so a single
 * shared run lets whichever platform posts second overwrite the first, per case — the run then shows
 * one platform's result while appearing to speak for both.
 *
 * Why results come from App Automate: when a suite runs with `targetProjectId`/`targetRunId` unset,
 * BaseTest posts nothing, and `target/surefire-reports` + `logs/test.log` are OVERWRITTEN by the next
 * run — App Automate is then the only surviving per-test record. Retries are separate sessions, so the
 * status taken is the LATEST session per test-method name, never a tally over the build.
 *
 * Usage:
 *   node automation/browserstack_test_run.js --folder-url "<link>" --story B10-56711 --dry
 *   node automation/browserstack_test_run.js --folder-url "<link>" --story B10-56711
 *   node automation/browserstack_test_run.js --folder-url "<link>" --story B10-56711 \
 *        --platforms ios --build 1088 --no-results
 *
 * Flags:
 *   --folder-url  REQUIRED. The shared test-case folder link.
 *   --story       Jira key. Defaults to the folder name if it contains one.
 *   --platforms   auto (default) | comma list of ios,android,web
 *   --build       App Automate build name or hashed id, if auto-discovery picks wrong
 *   --since       ISO timestamp — ignore sessions older than this (one build can hold several runs)
 *   --no-results  create/reuse the runs and set automation_status, but post no results
 *                 (use when the suite will post live via -Dtarget.browserstack.run.id)
 *   --run-map     ios=TR-6742,android=TR-6743 — post into existing runs instead of matching by name
 *   --new-run     force a new run even if one with the same name exists
 *   --dry         resolve, index and report — change nothing
 *
 * API v2 traps, all verified live 2026-08-03:
 *   - `/api/v2` only. v1 answers 401 + an SSO login_url for valid Basic credentials.
 *   - `GET /projects` does NOT return a numeric id — the numeric id is inside `urls.self`.
 *   - There is NO single-case GET: `GET /projects/{p}/test-cases/{tc}` 404s. Read cases from the
 *     paginated LIST (which does carry `automation_status`).
 *   - `PATCH /projects/{p}/test-cases/{tc}` DOES exist on that same 404-ing path, and is a true
 *     PARTIAL update — verified that issues/tags/steps/priority/preconditions survive untouched.
 *   - A `200` is not proof on this API (a `steps` payload saves 200 and drops every step), so every
 *     write here is read back.
 */

const fs = require('fs');
const path = require('path');
const creds = require(path.join(__dirname, 'config', 'credentials.js'));
const framework = require(path.join(__dirname, 'config', 'framework.js'));

const TM = 'https://test-management.browserstack.com/api/v2';
const AA = 'https://api-cloud.browserstack.com/app-automate';
const NL = String.fromCharCode(10);

const arg = (n, d) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes(n);

const FOLDER_URL = arg('--folder-url', '');
const STORY = arg('--story', '');
const PLATFORMS = arg('--platforms', 'auto');
const BUILD_HINT = arg('--build', '');
const SINCE = arg('--since', '');   // ISO timestamp; scopes out earlier unrelated runs in the same build
const NO_RESULTS = has('--no-results');
// ios=TR-6742,android=TR-6743 — post into runs that already exist under a different name.
const RUN_MAP = new Map(arg('--run-map', '').split(',').filter(Boolean)
  .map((pair) => pair.split('=').map((s) => s.trim())).filter((kv) => kv.length === 2));
const NEW_RUN = has('--new-run');
const DRY = has('--dry');

const user = process.env.BS_TM_USERNAME || creds.browserstack.tmUsername();
const key = process.env.BS_TM_API_TOKEN || creds.browserstack.tmApiToken();
if (!user || !key) throw new Error('BrowserStack credentials unavailable from env or automation/config/credentials.js');
const H = {
  Authorization: 'Basic ' + Buffer.from(`${user}:${key}`).toString('base64'),
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

const api = async (method, url, body) => {
  const r = await fetch(url, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { json = null; }
  return { ok: r.ok, status: r.status, json, text };
};

/** `…/projects/<numeric>/folder(s)/<id>/test-cases` in any of the shapes the UI hands out. */
function parseFolderUrl(url) {
  if (!url) throw new Error('--folder-url is required (the shared test-case folder link)');
  const project = (url.match(/\/projects\/(\d+)/) || [])[1];
  const folder = (url.match(/\/folders?\/(\d+)/) || [])[1];
  if (!project || !folder) {
    throw new Error(`could not read a project and folder id out of "${url}" — expected `
      + '…/projects/<numeric>/folder/<id>/test-cases');
  }
  return { numericProject: project, folderId: Number(folder) };
}

/** numeric project id -> `PR-x`. The list is paginated and the numeric id only appears in urls.self. */
async function resolveProject(numericProject) {
  for (let p = 1; p <= 20; p += 1) {
    const { json } = await api('GET', `${TM}/projects?p=${p}`);
    const list = (json && (json.projects || json.data)) || [];
    if (!list.length) break;
    const hit = list.find((x) => String((x.urls && x.urls.self) || '').replace(/\/+$/, '').endsWith(`/${numericProject}`));
    if (hit) return hit;
  }
  throw new Error(`no project whose urls.self ends with /${numericProject} — is the link from another account?`);
}

/** Folder metadata — its name seeds the canonical run name, so re-runs REUSE instead of duplicating. */
async function folderMeta(pr, folderId) {
  const { json } = await api('GET', `${TM}/projects/${pr}/folders/${folderId}`);
  return (json && (json.folder || json)) || {};
}

/** Every case in the folder. The list endpoint returns the WHOLE project, so filter by folder_id. */
async function casesInFolder(pr, folderId) {
  const out = [];
  for (let p = 1; p <= 40; p += 1) {
    const { json } = await api('GET', `${TM}/projects/${pr}/test-cases?p=${p}`);
    const list = (json && json.test_cases) || [];
    if (!list.length) break;
    out.push(...list.filter((t) => t.folder_id === folderId));
  }
  return out.sort((a, b) => Number(String(a.identifier).replace(/\D/g, '')) - Number(String(b.identifier).replace(/\D/g, '')));
}

const PLATFORM_OF = (file) => (/[\\/]iosNative[\\/]/.test(file) ? 'ios'
  : /[\\/]androidNative[\\/]/.test(file) ? 'android' : 'web');

/** TC id -> { method, platform, file }[] , read from @TmsLink annotations in the framework's tests. */
function tmsIndex(storyKey) {
  const root = framework.resolve();
  if (!root) throw new Error('the Java framework path did not resolve — set QA_FRAMEWORK_PATH');
  const testRoot = path.join(root, 'src', 'test', 'java');
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.java')) files.push(full);
    }
  };
  walk(testRoot);

  const wanted = storyKey ? files.filter((f) => path.basename(f).includes(storyKey.replace(/-/g, '_'))) : files;
  const scan = wanted.length ? wanted : files;
  const index = new Map();
  const re = /@TmsLink\("([A-Z]{2,6}-\d+)"\)[\s\S]{0,400}?public\s+void\s+(\w+)\s*\(/g;
  for (const file of scan) {
    const src = fs.readFileSync(file, 'utf8');
    let m;
    while ((m = re.exec(src)) !== null) {
      const [, tcId, method] = m;
      if (!index.has(tcId)) index.set(tcId, []);
      index.get(tcId).push({ method, platform: PLATFORM_OF(file), file: path.relative(root, file) });
    }
  }
  return index;
}

async function setAutomationStatus(pr, cases, index) {
  const targets = cases.filter((c) => index.has(c.identifier) && c.automation_status !== 'automated');
  const already = cases.filter((c) => index.has(c.identifier) && c.automation_status === 'automated').length;
  console.log(`${NL}automation_status: ${targets.length} case(s) to flip to "automated"`
    + ` · ${already} already automated · ${cases.length - index_size(cases, index)} have no automated test (left as-is)`);
  if (!targets.length || DRY) { if (DRY && targets.length) targets.forEach((c) => console.log(`   would set ${c.identifier} -> automated`)); return; }
  for (const c of targets) {
    const r = await api('PATCH', `${TM}/projects/${pr}/test-cases/${c.identifier}`, { test_case: { automation_status: 'automated' } });
    console.log(`   ${r.ok ? '+' : '!'} ${c.identifier} -> automated${r.ok ? '' : ` (${r.status} ${r.text.slice(0, 120)})`}`);
  }
}
const index_size = (cases, index) => cases.filter((c) => index.has(c.identifier)).length;

async function findRun(pr, name) {
  for (let p = 1; p <= 10; p += 1) {
    const { json } = await api('GET', `${TM}/projects/${pr}/test-runs?p=${p}`);
    const list = (json && json.test_runs) || [];
    if (!list.length) break;
    const hit = list.find((r) => String(r.name).trim() === name.trim());
    if (hit) return hit;
  }
  return null;
}

async function createRun(pr, name, caseIds, storyKey, platform, note) {
  const body = {
    test_run: {
      name,
      description: `Automated validation run for ${storyKey || 'this story'}, ${platform} leg.${NL}${note}${NL}`
        + 'One run per platform: mirrored platform classes share the same @TmsLink ids, so a shared run '
        + 'would let the second platform overwrite the first, per case.',
      run_state: 'new_run',
      assignee: user.includes('@') ? user : 'qc.fintech@breadfast.com',
      tags: ['ai-created', ...(storyKey ? [storyKey] : []), `platform-${platform}`],
      issues: storyKey ? [storyKey] : [],
      test_cases: caseIds,
      include_all: false,
    },
  };
  const r = await api('POST', `${TM}/projects/${pr}/test-runs`, body);
  if (!r.ok) throw new Error(`run creation failed: ${r.status} ${r.text.slice(0, 300)}`);
  const run = (r.json && (r.json.test_run || (r.json.data && r.json.data.test_run))) || r.json;
  return run.identifier || run.id;
}

/** Sessions of one App Automate build (paginated in blocks of 100). */
async function buildSessions(hashedId) {
  const out = [];
  for (let i = 0; i < 10; i += 1) {
    const r = await fetch(`${AA}/builds/${hashedId}/sessions.json?limit=100&offset=${i * 100}`, { headers: H });
    if (!r.ok) break;
    const list = await r.json().catch(() => []);
    if (!Array.isArray(list) || !list.length) break;
    out.push(...list.map((s) => s.automation_session || s));
    if (list.length < 100) break;
  }
  return out;
}

/**
 * The build holding this platform's sessions. Picked by MATCH COUNT against the platform's own test
 * method names rather than by name or recency, because the framework names builds after the app build
 * number — several stories' sessions can share one build, and one story can span several builds.
 */
async function discoverBuild(methods, platform, hint) {
  const r = await fetch(`${AA}/builds.json?limit=30`, { headers: H });
  const builds = (await r.json().catch(() => [])).map((b) => b.automation_build || b);
  const ordered = hint
    ? builds.filter((b) => String(b.name) === hint || String(b.hashed_id) === hint).concat(builds)
    : builds;
  let best = null;
  for (const b of ordered) {
    const sessions = await buildSessions(b.hashed_id);
    // MUST filter by session `os`. Mirrored platform classes use IDENTICAL test-method names, so
    // matching on name alone happily hands the Android leg an iOS build (observed 2026-08-03: the
    // Android run was about to be filled from iOS build 1088).
    const matched = sessions.filter((s) => methods.has(String(s.name))
      && String(s.os || '').toLowerCase() === platform
      && String(s.created_at || '') >= SINCE);
    if (!matched.length) continue;
    const covered = new Set(matched.map((s) => String(s.name))).size;
    if (!best || covered > best.covered) best = { build: b, sessions: matched, covered };
    if (best.covered === methods.size) break;
  }
  return best;
}

function rowsFromSessions(best, methodToCase, storyKey) {
  const ordered = [...best.sessions].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const latest = new Map();
  const attempts = new Map();
  for (const s of ordered) {
    latest.set(String(s.name), s);
    attempts.set(String(s.name), (attempts.get(String(s.name)) || 0) + 1);
  }
  const rows = [];
  for (const [method, tcId] of methodToCase) {
    const s = latest.get(method);
    if (!s) continue;
    const status = s.status === 'passed' ? 'passed' : s.status === 'failed' ? 'failed' : 'skipped';
    // Sessions for this test name in this build — NOT "attempts of one run". A build can hold several
    // separate executions, so this is reported as a session count and the winning session is named.
    const seen = attempts.get(method);
    const app = s.app_details || {};
    rows.push({
      tcId,
      method,
      status,
      seen,
      description: [
        'Automated (Java + Appium/Selenium). Recorded outcome — this report did NOT re-run the test.',
        `Test: ${method}`,
        `Device: ${[s.device, s.os, s.os_version].filter(Boolean).join(' / ')}`,
        `App: ${app.app_url || '?'}${app.app_version ? ` (${app.app_filename || 'app'} ${app.app_version})` : ''}`,
        `App Automate build ${best.build.name} · session ${s.hashed_id}`,
        `Session started: ${s.created_at} UTC`,
        `Result: ${status.toUpperCase()}`,
        ...(seen > 1 ? ['', `This test has ${seen} sessions in build ${best.build.name} (re-runs). The status above`
          + ' is the LATEST session, i.e. the final verdict — not a tally.'] : []),
      ].join(NL),
      issues: storyKey ? [storyKey] : [],
    });
  }
  return rows.sort((a, b) => Number(a.tcId.replace(/\D/g, '')) - Number(b.tcId.replace(/\D/g, '')));
}

async function postResults(pr, runId, rows) {
  let ok = 0;
  for (const r of rows) {
    // The shape helpers.apiClients.BrowserstackApiClient sends, so this path stays the verified one.
    const body = { results: [{ test_result: { status: r.status, description: r.description, issues: r.issues }, test_case_id: r.tcId }] };
    const res = await api('POST', `${TM}/projects/${pr}/test-runs/${runId}/results`, body);
    if (res.ok) { ok += 1; console.log(`   + ${r.tcId} ${r.status}`); }
    else console.log(`   ! ${r.tcId} -> ${res.status} ${res.text.slice(0, 160)}`);
  }
  return ok;
}

/** Read-back verification. A 200 from this API is not proof that anything was stored. */
async function verifyRun(pr, runId) {
  const { json } = await api('GET', `${TM}/projects/${pr}/test-runs/${runId}/test-cases?p=1`);
  const list = (json && json.test_cases) || [];
  const tally = {};
  list.forEach((c) => { const s = c.latest_status || 'untested'; tally[s] = (tally[s] || 0) + 1; });
  return { attached: (json && json.info && json.info.count) || list.length, tally };
}

(async () => {
  const { numericProject, folderId } = parseFolderUrl(FOLDER_URL);
  const project = await resolveProject(numericProject);
  const pr = project.identifier;
  console.log(`folder link -> project ${numericProject} = ${pr} ("${project.name}") · folder ${folderId}`);

  const folder = await folderMeta(pr, folderId);
  const cases = await casesInFolder(pr, folderId);
  if (!cases.length) throw new Error(`no test cases in folder ${folderId} — upload them first`);
  const storyKey = STORY || (String(cases[0].folder_path || '').match(/B10-\d+/) || (cases[0].tags || []).join(' ').match(/B10-\d+/) || [''])[0];
  console.log(`cases in folder "${folder.name}": ${cases.length}${storyKey ? ` · story ${storyKey}` : ''}`);

  const index = tmsIndex(storyKey);
  const bound = cases.filter((c) => index.has(c.identifier));
  console.log(`automated (bound by @TmsLink): ${bound.length} · not automated: ${cases.length - bound.length}`);
  if (!bound.length) throw new Error('no case in this folder is bound to a test by @TmsLink — generate the automation first');

  const platforms = PLATFORMS === 'auto'
    ? [...new Set(bound.flatMap((c) => index.get(c.identifier).map((t) => t.platform)))].sort()
    : PLATFORMS.split(',').map((s) => s.trim()).filter(Boolean);
  console.log(`platforms: ${platforms.join(', ')}`);

  await setAutomationStatus(pr, cases, index);

  const caseIds = cases.map((c) => c.identifier);
  const summary = [];

  for (const platform of platforms) {
    const methodToCase = new Map();
    for (const c of bound) {
      for (const t of index.get(c.identifier)) if (t.platform === platform) methodToCase.set(t.method, c.identifier);
    }
    // Canonical, DERIVED name — the reuse key. Hand-writing run names is what makes a second invocation
    // create duplicates instead of updating the run it made last time.
    const label = platform === 'ios' ? 'iOS' : platform === 'android' ? 'Android' : 'Web';
    const runName = `${[storyKey, folder.name].filter(Boolean).join(' — ')} (${label})`;
    const mapped = RUN_MAP.get(platform);
    console.log(`${NL}=== ${platform} · ${methodToCase.size} automated test(s) · run "${runName}"`);

    let best = null;
    if (!NO_RESULTS) {
      if (platform === 'web') {
        console.log('   web: App Automate holds no sessions for Selenium runs — create the run here and let'
          + ' the suite post live with the -D flags printed below, or pass --no-results');
      } else {
        best = await discoverBuild(new Set(methodToCase.keys()), platform, BUILD_HINT);
      }
      if (!best && platform !== 'web') console.log(`   no App Automate build holds ${platform} sessions for these test names — nothing to back-fill`);
      else if (best) console.log(`   source build ${best.build.name} (${best.build.hashed_id}) covers ${best.covered}/${methodToCase.size} ${platform} test names`);
    }
    const rows = best ? rowsFromSessions(best, methodToCase, storyKey) : [];

    if (DRY) {
      const pre = mapped ? `would post into ${mapped} (--run-map)` : `would ${NEW_RUN ? 'create a new run' : 'reuse-or-create'} "${runName}" with ${caseIds.length} cases`;
      console.log(`   ${pre}`);
      rows.forEach((r) => console.log(`   would post ${r.tcId} ${r.status.toUpperCase()} (sessions=${r.seen}) ${r.method}`));
      const missing = [...methodToCase.keys()].filter((m) => !rows.some((r) => r.method === m));
      if (missing.length) console.log(`   NO session for: ${missing.join(', ')}`);
      summary.push({ platform, run: '(dry)', posted: rows.length });
      continue;
    }

    const existing = mapped ? { identifier: mapped } : (NEW_RUN ? null : await findRun(pr, runName));
    const runId = existing ? (existing.identifier || existing.id)
      : await createRun(pr, runName, caseIds, storyKey, platform,
        best ? `Results back-filled from App Automate build ${best.build.name}.` : 'Results posted live by the suite.');
    console.log(`   run ${runId}${mapped ? ' (targeted via --run-map)' : existing ? ' (reused by name)' : ' (created)'}`);

    const posted = rows.length ? await postResults(pr, runId, rows) : 0;
    const v = await verifyRun(pr, runId);
    console.log(`   verified: ${v.attached} cases attached · ${JSON.stringify(v.tally)}`);
    console.log(`   url: https://test-management.browserstack.com/projects/${numericProject}/test-runs/${runId}`);
    summary.push({ platform, run: runId, posted, verified: v.tally });
  }

  // Read automation_status back — the flip is a write like any other.
  const after = await casesInFolder(pr, folderId);
  const autoCount = after.filter((c) => c.automation_status === 'automated').length;
  console.log(`${NL}automation_status verified: ${autoCount}/${cases.length} cases are "automated" (expected ${bound.length})`);

  console.log(`${NL}For the NEXT execution to post live, run the suite with:`);
  summary.filter((s) => s.run && s.run !== '(dry)').forEach((s) => {
    console.log(`   ${s.platform}: -Dtarget.browserstack.project.id=${pr} -Dtarget.browserstack.run.id=${s.run}`);
  });
  console.log('   (prefer these -D flags over editing browserStackConfigs.properties — that file is a shared global)');
  console.log(`${NL}${JSON.stringify(summary)}`);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
