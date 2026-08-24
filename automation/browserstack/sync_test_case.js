#!/usr/bin/env node
/**
 * Sync ONE already-imported BrowserStack test case in place, by its TC id.
 *
 * Workflow 2 phase 4 needs this: after validation reconciles the approved suite, the deltas must be
 * applied to the EXISTING folder — create / update / archive by `TC-xxxx`. Re-running
 * `upload_browserstack.js` would post the whole CSV again, duplicating the folder and orphaning every
 * `@TmsLink` (browserstack-process.md §10.5). There was no update tool; this is it.
 *
 * Usage:
 *   node automation/browserstack/sync_test_case.js --story-dir B10-57776 --project PR-5 \
 *        --tc TC-55007 [--dry]
 *
 * The case body is rebuilt from the story's own `testcases/testcases.csv`, matched to the TC id via
 * `browserstack/tc-map.json`, so the sync always pushes exactly what the approved CSV says.
 *
 * Two v2 traps this handles (browserstack-process.md §10.6 · [[browserstack-tm-field-asymmetry]]):
 *   - the payload must be wrapped in a `test_case` envelope, and steps go in `test_case_steps`
 *     (a bare `steps` array returns 200 and saves nothing);
 *   - POST takes `name`/`test_case_steps` but GET returns `title`/`steps`, so the read-back verifier
 *     must compare against the READ-side keys or it falsely reports the write as missing.
 * Every write is verified by reading the case back — a 200 from this API is not proof.
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
const PROJECT = flag('project', 'PR-5');
const TC = flag('tc');
const DRY = has('dry');
if (!STORY || !TC) {
  console.error('usage: --story-dir <dir> --tc TC-xxxxx [--project PR-5] [--dry]');
  process.exit(2);
}

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

const html = (s) => String(s == null ? '' : s);

/** Rebuild the case identified by `tc` from the story's approved CSV. */
function caseFromCsv(storyDir, tcId) {
  const map = JSON.parse(fs.readFileSync(path.join(storyDir, 'browserstack/tc-map.json'), 'utf8'));
  const entry = Object.values(map.map).find((m) => m.tc === tcId);
  if (!entry) throw new Error(`${tcId} is not in tc-map.json`);

  const rows = P.parseCsv(fs.readFileSync(path.join(storyDir, 'testcases/testcases.csv'), 'utf8'));
  const H = rows[0]; const ix = (n) => H.indexOf(n);
  let collecting = false; const out = { title: entry.title, steps: [] };
  for (const r of rows.slice(1)) {
    const title = r[ix('Title')];
    if (title) {
      if (collecting) break;                     // next case begins → done
      if (title.trim() !== entry.title.trim()) continue;
      collecting = true;
      out.description = r[ix('Description')];
      out.pre = r[ix('Preconditions')];
      out.priority = r[ix('Priority')];
      out.type = r[ix('Type of Test Case')];
      out.auto = r[ix('Automation Status')];
      out.tags = String(r[ix('Tags')] || '').split(/[,\s]+/).filter(Boolean);
    }
    if (!collecting) continue;
    const step = r[ix('Steps')]; const res = r[ix('Expected Result')];
    if (step || res) out.steps.push([step, res]);
  }
  if (!collecting) throw new Error(`no rows in testcases.csv titled "${entry.title}"`);
  return out;
}

const CASE_TYPE = { Functional: 'Functional', Regression: 'Regression', Acceptance: 'Acceptance', Smoke: 'Smoke' };
const AUTOMATION = { 'Not Automated': 'not_automated', Automated: 'automated', 'Automation Not Required': 'automation_not_required' };

(async () => {
  const c = caseFromCsv(STORY, TC);
  console.log(`Case ${TC}: "${c.title}"  ·  ${c.steps.length} step(s)`);

  // Locate the case by its identifier so we update, never create.
  const found = await call('GET', `/projects/${PROJECT}/test-cases/${TC}`);
  if (found.status !== 200) {
    console.error(`cannot read ${TC}: HTTP ${found.status} ${JSON.stringify(found.json).slice(0, 300)}`);
    process.exit(1);
  }
  const before = (found.json.data || found.json).test_case || found.json.test_case || found.json;
  console.log(`  found in folder ${before.folder_id} · current steps: ${(before.steps || before.test_case_steps || []).length}`);

  const payload = {
    test_case: {
      name: c.title,
      description: html(c.description),
      preconditions: html(c.pre),
      case_type: CASE_TYPE[c.type] || 'Functional',
      priority: c.priority,
      status: 'Active',
      template: 'test_case_steps',
      automation_status: AUTOMATION[c.auto] || 'not_automated',
      tags: c.tags,
      test_case_steps: c.steps.map(([s, r]) => ({ step: html(s), result: html(r) })),
    },
  };

  if (DRY) {
    console.log('\nDRY RUN — payload that would be PATCHed:\n' + JSON.stringify(payload, null, 2).slice(0, 2000));
    return;
  }

  const upd = await call('PATCH', `/projects/${PROJECT}/test-cases/${TC}`, payload);
  console.log(`  PATCH -> HTTP ${upd.status}`);
  if (upd.status >= 400) {
    console.error('  body:', JSON.stringify(upd.json).slice(0, 400));
    process.exit(1);
  }

  // Verify by reading it back. A 200 is not proof the fields landed.
  const after = await call('GET', `/projects/${PROJECT}/test-cases/${TC}`);
  const a = (after.json.data || after.json).test_case || after.json.test_case || after.json;
  const readSteps = a.steps || a.test_case_steps || [];      // READ-side keys, not write-side
  const wantResults = c.steps.map(([, r]) => String(r || '').trim());
  const gotResults = readSteps.map((s) => String(s.result || '').replace(/<[^>]*>/g, '').trim());
  const ok = wantResults.length === gotResults.length && wantResults.every((w, i) => gotResults[i] === w);
  console.log(`  read-back: title="${a.title || a.name}" · steps ${readSteps.length} · results match: ${ok}`);
  if (!ok) {
    wantResults.forEach((w, i) => { if (gotResults[i] !== w) console.log(`    step ${i + 1} DIFF\n      want: ${w.slice(0, 160)}\n      got : ${String(gotResults[i]).slice(0, 160)}`); });
    process.exit(1);
  }
  console.log(`\n${TC} synced and verified.`);
})().catch((e) => { console.error('SYNC FAILED:', e.message); process.exit(1); });
