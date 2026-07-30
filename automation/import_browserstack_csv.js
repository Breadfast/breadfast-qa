'use strict';

/**
 * import_browserstack_csv.js — reusable BrowserStack Test Management CSV importer.
 *
 * ⚠️  SUPERSEDED (2026-07-26). This script targets the **v1** API, which does not
 *     exist: `https://test-management.browserstack.com/api/v1/...` answers
 *     `401 Unauthorized` + `{"login_url": ".../auth/start-sso"}` for perfectly
 *     VALID credentials. That 401 is NOT an auth failure and NOT proof that the
 *     org requires SSO — it is a wrong-version endpoint, and it cost a full QA
 *     cycle being reported as "blocked on credentials".
 *
 *     The working API is **v2** (plain HTTP Basic `username:access_key`), and the
 *     reliable path is to create cases individually rather than upload a CSV:
 *         POST /api/v2/projects/{PR-x}/folders/{folder_id}/test-cases
 *     Reference implementation (verified end-to-end, 28 cases + 197 steps):
 *         B10-56750/automation/upload_browserstack.js
 *     Key schema traps documented there: the field is `name` (not `title`),
 *     `issues` is an array of plain strings, and steps MUST go in
 *     `test_case_steps` — a `steps` payload returns 200 and silently saves NONE.
 *
 *     Prefer that uploader. The BASE default below has been moved to v2 so any
 *     remaining GET helpers here at least authenticate.
 *
 * Uploads a generated test-case CSV into BrowserStack Test Management via the public
 * REST API (https://test-management.browserstack.com/api/v1), authenticated with the
 * same userName + accessKey used for App Automate (read from the Java framework's
 * browserStackConfigs.properties, or BROWSERSTACK_USERNAME / BROWSERSTACK_ACCESS_KEY env).
 *
 * Usage:
 *   node import_browserstack_csv.js --list                       # discover project identifiers
 *   node import_browserstack_csv.js --file <csv> --project <PR-xxxx|numeric|name> [--folder <id>]
 *
 * Notes:
 *   • The CSV already carries Folder ID per row, so --folder is optional.
 *   • Requires Node 18+ (global fetch / FormData / Blob).
 */

const fs   = require('fs');
const path = require('path');
const props = require('./helpers/PropertiesReader');

const BASE = process.env.BS_TM_BASE || 'https://test-management.browserstack.com/api/v2';
const BS_PROPS_PATH =
  process.env.BS_PROPERTIES_PATH ||
  'D:\\projects\\resources\\environments\\browserStackConfigs.properties';

/**
 * Auth. The Test Management API does NOT accept the App Automate access key (it 401s
 * and redirects to SSO). It needs a Test Management API token generated under
 * BrowserStack → Profile → "API tokens"/"Test Management". Provide it via env:
 *   BS_TM_USERNAME      (your BrowserStack username / email)
 *   BS_TM_API_TOKEN     (the Test Management API token)
 * Falls back to App Automate userName/accessKey (works only if your org enabled it).
 */
function authHeader() {
  const user = process.env.BS_TM_USERNAME || process.env.BROWSERSTACK_USERNAME;
  const token = process.env.BS_TM_API_TOKEN || process.env.BROWSERSTACK_ACCESS_KEY;
  if (user && token) return 'Basic ' + Buffer.from(`${user}:${token}`).toString('base64');
  const p = props.load(BS_PROPS_PATH);
  if (!p.userName || !p.accessKey) {
    throw new Error('No BrowserStack Test Management creds. Set BS_TM_USERNAME + BS_TM_API_TOKEN (token from Profile → API tokens).');
  }
  return 'Basic ' + Buffer.from(`${p.userName}:${p.accessKey}`).toString('base64');
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function listProjects() {
  const res = await fetch(`${BASE}/projects`, { headers: { Authorization: authHeader(), Accept: 'application/json' } });
  const text = await res.text();
  console.log(`GET /projects → ${res.status}`);
  let data; try { data = JSON.parse(text); } catch { console.log(text.slice(0, 500)); return; }
  const projects = data.projects || data.data || data;
  (Array.isArray(projects) ? projects : []).forEach(p =>
    console.log(`  ${p.identifier || p.id}\t${p.name}`));
  if (!Array.isArray(projects)) console.log(JSON.stringify(data, null, 2).slice(0, 800));
  return projects;
}

async function resolveProjectIdentifier(token) {
  if (/^PR-/i.test(token)) return token;
  const res = await fetch(`${BASE}/projects`, { headers: { Authorization: authHeader(), Accept: 'application/json' } });
  const data = await res.json().catch(() => ({}));
  const projects = data.projects || data.data || [];
  const hit = projects.find(p =>
    String(p.id) === String(token) || (p.name || '').toLowerCase() === String(token).toLowerCase());
  if (!hit) throw new Error(`Could not resolve project "${token}". Run --list to see identifiers.`);
  return hit.identifier;
}

async function importCsv(file, projectToken, folderId) {
  if (!fs.existsSync(file)) throw new Error(`CSV not found: ${file}`);
  const identifier = await resolveProjectIdentifier(projectToken);

  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(file)], { type: 'text/csv' }), path.basename(file));
  form.append('type', 'csv');
  if (folderId) form.append('folder_id', String(folderId));

  const url = `${BASE}/projects/${identifier}/test-cases/import`;
  const res = await fetch(url, { method: 'POST', headers: { Authorization: authHeader() }, body: form });
  const text = await res.text();
  console.log(`POST ${url} → ${res.status}`);
  console.log(text.slice(0, 1500));
  if (!res.ok) process.exitCode = 1;
}

(async () => {
  try {
    if (process.argv.includes('--list')) return void (await listProjects());
    const file = arg('--file');
    const project = arg('--project');
    const folder = arg('--folder');
    if (!file || !project) {
      console.log('Usage: node import_browserstack_csv.js --file <csv> --project <PR-xxxx|numeric|name> [--folder <id>]\n       node import_browserstack_csv.js --list');
      process.exitCode = 2; return;
    }
    await importCsv(file, project, folder);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  }
})();
