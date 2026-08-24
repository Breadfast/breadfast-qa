'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLI = path.join(__dirname, 'qa-cli.js');
const run = (args, input) => execFileSync(process.execPath, [CLI, ...args], { input, encoding: 'utf8' });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qa-cli-'));

test('init → fingerprint-jira → fingerprint-figma → record → show produces a valid state', () => {
  const dir = tmp();
  run(['init', dir, 'B10-56729']);
  const issue = JSON.stringify({ updated: '2026-07-22T09:00:00Z', summary: 'S', description: 'D', ac: 'A', comments: [{ id: 1, body: 'c' }] });
  const fp = JSON.parse(run(['fingerprint-jira', dir], issue));
  assert.match(fp.hash, /^[a-f0-9]{64}$/);
  run(['fingerprint-figma', dir, '--file', 'KEY', '--nodes', '1:211', '--version', 'v1']);

  fs.mkdirSync(path.join(dir, 'requirements-analysis'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'requirements-analysis/requirements.md'), 'body');
  const rec = JSON.parse(run(['record', dir, 'requirements',
    '--path', 'requirements-analysis/requirements.md', '--generator', 'story-analysis@1.0',
    '--derive-sources', 'jira', '--domains', 'card,payment']));
  assert.equal(rec.key, 'requirements');
  assert.equal(rec.derivedFrom.jira, fp.hash); // provenance pulled from stored source
  assert.deepEqual(rec.domains, ['card', 'payment']);

  const state = JSON.parse(run(['show', dir]));
  const { validateQaState } = require('../lib/schema/validate');
  assert.equal(validateQaState(state).valid, true);
});

test('record derives from an upstream artifact checksum', () => {
  const dir = tmp();
  run(['init', dir, 'B10-1']);
  run(['fingerprint-jira', dir], JSON.stringify({ updated: 't', summary: 's', description: 'd', ac: 'a', comments: [] }));
  run(['fingerprint-figma', dir, '--file', 'K', '--nodes', '1:1', '--version', 'v']);
  for (const [key, rel] of [['requirements', 'r.md'], ['figma-analysis', 'f.md']]) {
    fs.writeFileSync(path.join(dir, rel), key);
    const src = key === 'requirements' ? 'jira' : 'figma';
    run(['record', dir, key, '--path', rel, '--generator', key + '@1.0', '--derive-sources', src]);
  }
  fs.writeFileSync(path.join(dir, 'i.md'), 'impact');
  const rec = JSON.parse(run(['record', dir, 'impact', '--path', 'i.md', '--generator', 'impact-analysis@1.0',
    '--derive-artifacts', 'requirements,figma-analysis']));
  assert.ok(rec.derivedFrom.requirements && rec.derivedFrom['figma-analysis']);
});

test('reconcile: fresh reuses all; changed jira cascades', () => {
  const dir = tmp();
  run(['init', dir, 'B10-9']);
  const issue = { updated: 't', summary: 's', description: 'd', ac: 'a', comments: [] };
  run(['fingerprint-jira', dir], JSON.stringify(issue));
  run(['fingerprint-figma', dir, '--file', 'K', '--nodes', '1:1', '--version', 'v']);
  for (const [key, rel, src] of [['requirements', 'r.md', 'jira'], ['figma-analysis', 'f.md', 'figma'], ['clarifications', 'c.md', 'jira']]) {
    fs.writeFileSync(path.join(dir, rel), key);
    run(['record', dir, key, '--path', rel, '--generator', key.replace('-analysis', '') + '@1.0', '--derive-sources', src]);
  }
  fs.writeFileSync(path.join(dir, 'i.md'), 'i'); run(['record', dir, 'impact', '--path', 'i.md', '--generator', 'impact-analysis@1.0', '--derive-artifacts', 'requirements,figma-analysis']);
  // test-design@2.1 = the CURRENT methodology; @1.0 here would (correctly) reconcile as stale by rule (d).
  fs.writeFileSync(path.join(dir, 'h.md'), 'h'); run(['record', dir, 'hls', '--path', 'h.md', '--generator', 'test-design@2.1', '--derive-artifacts', 'requirements,figma-analysis,impact']);

  // No stdin, no figma flags → nothing changed. The 5 recorded keys reuse; the three coverage-
  // definition keys this fixture never produced (testcases/review/import) are legitimately stale.
  const fresh = JSON.parse(run(['reconcile', dir]));
  assert.equal(fresh.reuse.length, 5);
  assert.deepEqual(fresh.stale, ['testcases', 'testcase-review', 'browserstack-import']);

  // Changed jira → requirements + impact + hls stale (+ clarifications, material by default)
  const changed = JSON.parse(run(['reconcile', dir], JSON.stringify({ ...issue, ac: 'a-CHANGED' })));
  assert.ok(changed.stale.includes('requirements') && changed.stale.includes('impact') && changed.stale.includes('hls'));
  assert.ok(changed.reuse.includes('figma-analysis'));

  // Immaterial flag → clarifications carried forward
  const immaterial = JSON.parse(run(['reconcile', dir, '--immaterial'], JSON.stringify({ ...issue, ac: 'a-CHANGED' })));
  assert.ok(immaterial.reuse.includes('clarifications'));
});

test('reconcile --apply-modified re-baselines a hand-edited artifact', () => {
  const dir = tmp();
  run(['init', dir, 'B10-8']);
  run(['fingerprint-jira', dir], JSON.stringify({ updated: 't', summary: 's', description: 'd', ac: 'a', comments: [] }));
  run(['fingerprint-figma', dir, '--file', 'K', '--nodes', '1:1', '--version', 'v']);
  fs.writeFileSync(path.join(dir, 'r.md'), 'orig');
  run(['record', dir, 'requirements', '--path', 'r.md', '--generator', 'story-analysis@1.0', '--derive-sources', 'jira']);
  fs.writeFileSync(path.join(dir, 'r.md'), 'HAND EDITED'); // drift, no source change
  const plan = JSON.parse(run(['reconcile', dir, '--apply-modified', '--expected', 'requirements']));
  assert.equal(plan.modified.length, 1);
  const state = JSON.parse(run(['show', dir]));
  assert.equal(state.artifacts.requirements.status, 'modified');
});

test('unknown command exits non-zero', () => {
  assert.throws(() => run(['bogus']));
});

// --- Run-integrity gates (added 2026-07-29 after the B10-56717 root cause analysis) -------------
// These three gates exist because a full qa-full run reported every quality gate met while no
// automation had been generated into the framework and neither repo was on the story's branch.
// If any of them regresses, that failure becomes silently possible again.

const seed = (dir, ticket) => {
  run(['init', dir, ticket]);
  run(['fingerprint-jira', dir], JSON.stringify({ updated: 't', summary: 's', description: 'd', ac: 'a', comments: [] }));
  run(['fingerprint-figma', dir, '--file', 'K', '--nodes', '1:1']);
  fs.writeFileSync(path.join(dir, 'a.md'), 'body');
};
const rec = (dir, key, extra = []) =>
  run(['record', dir, key, '--path', 'a.md', '--generator', 'g@1.0', ...extra]);
const fails = (args) => {
  try { run(args); return null; } catch (e) { return String(e.stderr || e.message); }
};
const validateState = (dir) =>
  require('../lib/schema/validate').validateQaState(JSON.parse(run(['show', dir]))).valid;

test('recording execution is BLOCKED while automation is missing or partial', () => {
  const dir = tmp();
  seed(dir, 'B10-56717');

  const missing = fails(['record', dir, 'execution', '--path', 'a.md', '--generator', 'execution@1.0']);
  assert.ok(missing, 'execution must not record while automation is absent');
  assert.match(missing, /automation.*has not been recorded/);

  rec(dir, 'automation', ['--status', 'partial']);
  const partial = fails(['record', dir, 'execution', '--path', 'a.md', '--generator', 'execution@1.0']);
  assert.ok(partial, 'execution must not record while automation is partial');
  assert.match(partial, /is "partial", not "complete"/);

  rec(dir, 'automation'); // now complete
  const ok = JSON.parse(rec(dir, 'execution'));
  assert.equal(ok.status, 'complete');
});

test('an operator-approved deferral is the only way past the phase dependency', () => {
  const dir = tmp();
  seed(dir, 'B10-56717');
  rec(dir, 'automation', ['--status', 'partial']);
  assert.ok(fails(['record', dir, 'execution', '--path', 'a.md', '--generator', 'execution@1.0']));

  const d = JSON.parse(run(['defer', dir, 'automation', '--by', 'Operator', '--reason', 'capacity']));
  assert.equal(d.deferred, 'automation');
  assert.equal(d.approvedBy, 'Operator');           // a deferral always carries a name
  assert.match(d.at, /^\d{4}-/);

  const ok = JSON.parse(rec(dir, 'execution'));
  assert.equal(ok.status, 'complete');

  // ...and `defer` requires both --by and --reason, so it cannot be a silent self-exemption.
  assert.ok(fails(['defer', dir, 'visual-findings', '--by', 'Operator']));
  assert.ok(fails(['defer', dir, 'visual-findings', '--reason', 'x']));
});

/** Record the full shift-left baseline, review gate included, through the approval gate. */
const seedBaseline = (dir) => {
  for (const k of ['requirements', 'figma-analysis', 'clarifications', 'impact', 'hls',
    'testcases', 'testcase-review']) rec(dir, k);
  run(['approve', dir, 'testcases', '--by', 'Operator']);
  rec(dir, 'browserstack-import');
};

test('complete-check exits non-zero on a partial artifact, unlike show', () => {
  const dir = tmp();
  seed(dir, 'B10-56717');
  seedBaseline(dir);
  rec(dir, 'automation', ['--status', 'partial']);

  const failed = fails(['complete-check', dir]);
  assert.ok(failed, 'complete-check must fail while automation is partial');
  assert.match(failed, /automation: partial/);

  // `show` is deliberately NOT a gate — it always succeeds, which is why it could not catch this.
  assert.doesNotThrow(() => run(['show', dir]));

  rec(dir, 'automation');
  for (const k of ['execution', 'visual-findings', 'defects', 'qa-summary']) rec(dir, k);
  const passed = JSON.parse(run(['complete-check', dir]));
  assert.equal(passed.ok, true);
  assert.deepEqual(passed.problems, []);
});

test('complete-check honours a recorded deferral but still reports it', () => {
  const dir = tmp();
  seed(dir, 'B10-56717');
  seedBaseline(dir);
  run(['defer', dir, 'automation', '--by', 'Operator', '--reason', 'scheduled follow-up']);
  for (const k of ['execution', 'visual-findings', 'defects', 'qa-summary']) rec(dir, k);

  const out = JSON.parse(run(['complete-check', dir]));
  assert.equal(out.ok, true);
  assert.equal(out.deferred.length, 1);
  assert.equal(out.deferred[0].key, 'automation');
  assert.equal(out.deferred[0].approvedBy, 'Operator');  // the deferral stays visible in the record
});

// --- Test-case review + approval gate (added 2026-08-09 with the shift-left test-case move) ------
// Test cases are now generated pre-development, and only REVIEWED + OPERATOR-APPROVED cases reach
// BrowserStack. Both halves are mechanical: a review artifact the agent produces, and an approval
// only an operator can record.

test('recording browserstack-import is BLOCKED until the cases are reviewed', () => {
  const dir = tmp();
  seed(dir, 'B10-57771');
  rec(dir, 'testcases');

  const unreviewed = fails(['record', dir, 'browserstack-import', '--path', 'a.md', '--generator', 'bs@1.0']);
  assert.ok(unreviewed, 'un-reviewed cases must not reach the test-management system');
  assert.match(unreviewed, /testcase-review.*has not been recorded/);

  rec(dir, 'testcase-review', ['--status', 'partial']);
  assert.match(fails(['record', dir, 'browserstack-import', '--path', 'a.md', '--generator', 'bs@1.0']),
    /is "partial", not "complete"/);
});

test('review alone is not enough — the operator must approve before import', () => {
  const dir = tmp();
  seed(dir, 'B10-57771');
  rec(dir, 'testcases');
  rec(dir, 'testcase-review');   // the agent reviewed them...

  const unapproved = fails(['record', dir, 'browserstack-import', '--path', 'a.md', '--generator', 'bs@1.0']);
  assert.ok(unapproved, 'reviewing must not double as approving');
  assert.match(unapproved, /have not been approved by an operator/);

  const ap = JSON.parse(run(['approve', dir, 'testcases', '--by', 'Ahmed Essam', '--note', 'AC coverage verified']));
  assert.equal(ap.approvedBy, 'Ahmed Essam');
  assert.match(ap.checksum, /^[a-f0-9]{64}$/);
  assert.ok(fs.existsSync(path.join(dir, ap.snapshot)), 'approval must snapshot the approved content');

  assert.equal(JSON.parse(rec(dir, 'browserstack-import')).status, 'complete');
  assert.equal(JSON.parse(run(['show', dir])).approvals.testcases.approvedBy, 'Ahmed Essam');
});

test('approve requires --by, and a deferral of the gate is the only other way past it', () => {
  const dir = tmp();
  seed(dir, 'B10-57771');
  rec(dir, 'testcases');
  assert.ok(fails(['approve', dir, 'testcases']));                      // no --by → no anonymous approval
  assert.ok(fails(['approve', dir, 'nothing-here', '--by', 'Operator'])); // cannot approve an unrecorded artifact

  run(['defer', dir, 'testcase-review', '--by', 'Operator', '--reason', 'cases pre-approved in grooming']);
  assert.equal(JSON.parse(rec(dir, 'browserstack-import')).status, 'complete');
});

test('changing approved test cases without a reconciliation log fails complete-check', () => {
  // Workflow 2 may add/update/remove cases — but never silently over the approved baseline.
  const dir = tmp();
  seed(dir, 'B10-57771');
  seedBaseline(dir);
  for (const k of ['automation', 'execution', 'visual-findings', 'defects', 'qa-summary']) rec(dir, k);
  assert.equal(JSON.parse(run(['complete-check', dir])).ok, true);

  fs.writeFileSync(path.join(dir, 'a.md'), 'body + 3 cases added during validation');
  for (const k of ['requirements', 'figma-analysis', 'clarifications', 'impact', 'hls', 'testcases',
    'testcase-review', 'browserstack-import', 'automation', 'execution', 'visual-findings',
    'defects', 'qa-summary']) rec(dir, k);   // re-record against the edited file

  const drifted = fails(['complete-check', dir]);
  assert.ok(drifted, 'an approved suite that changed with no recorded reconciliation must fail');
  assert.match(drifted, /changed after approval/);

  rec(dir, 'testcase-reconciliation');
  assert.equal(JSON.parse(run(['complete-check', dir])).ok, true);
});

test('complete-check --profile shift-left gates the pre-development run on its own artifact set', () => {
  const dir = tmp();
  seed(dir, 'B10-57771');
  for (const k of ['requirements', 'figma-analysis', 'clarifications', 'impact', 'hls']) rec(dir, k);

  // The old 5-key baseline is no longer a complete shift-left run: coverage is not defined yet.
  const partial = fails(['complete-check', dir, '--profile', 'shift-left']);
  assert.ok(partial);
  assert.match(partial, /testcases: missing/);

  rec(dir, 'testcases'); rec(dir, 'testcase-review');
  run(['approve', dir, 'testcases', '--by', 'Operator']);
  rec(dir, 'browserstack-import');

  const out = JSON.parse(run(['complete-check', dir, '--profile', 'shift-left']));
  assert.equal(out.ok, true);
  assert.equal(out.required, 8);
  assert.equal(out.approved[0].key, 'testcases');

  // ...and the same state is NOT a complete validation run.
  assert.ok(fails(['complete-check', dir, '--profile', 'validate']));
  assert.ok(fails(['complete-check', dir, '--profile', 'bogus']));
});

// --- The lock seam, wired (added 2026-08-09) -----------------------------------------------------
// Rules (d) and (e) of the freshness contract were implemented and tested in reconcile.js but never
// supplied with inputs by this CLI, so a skill `version:` bump and a business-rule change both
// invalidated nothing. These assert the wiring, not the rules.

test('record writes the top-level domains map that rule (e) compares against', () => {
  const dir = tmp();
  seed(dir, 'B10-1');
  rec(dir, 'requirements', ['--domains', 'card,payment']);
  const state = JSON.parse(run(['show', dir]));
  assert.deepEqual(Object.keys(state.domains).sort(), ['card', 'payment']);
  assert.match(state.domains.card.checksum, /^[a-f0-9]{64}$/);
  assert.deepEqual(state.artifacts.requirements.domains, ['card', 'payment']);
  // A typo'd domain is refused rather than recorded as an un-comparable fingerprint.
  assert.match(fails(['record', dir, 'impact', '--path', 'a.md', '--generator', 'g@1.0', '--domains', 'fintech']),
    /unknown domain\(s\): fintech/);
});

test('an artifact generated by a superseded skill version reconciles as stale', () => {
  const dir = tmp();
  seed(dir, 'B10-1');
  rec(dir, 'requirements', ['--derive-sources', 'jira']);
  // hls stamped with the pre-2026-08-09 methodology, when test cases were NOT a shift-left output.
  run(['record', dir, 'hls', '--path', 'a.md', '--generator', 'test-design@1.0', '--derive-artifacts', 'requirements']);

  const plan = JSON.parse(run(['reconcile', dir, '--expected', 'requirements,hls']));
  assert.ok(plan.stale.includes('hls'), 'a 1.0 HLS must not be reused under the 2.0 methodology');
  assert.ok(plan.reasons.hls.includes('generator-version'));
  assert.equal(plan.lock.generators.hls, 'test-design@2.1');

  // --ignore-lock is the deliberate carry-forward, and says so in the plan.
  const ignored = JSON.parse(run(['reconcile', dir, '--ignore-lock', '--expected', 'requirements,hls']));
  assert.ok(ignored.reuse.includes('hls'));
  assert.equal(ignored.lock, 'ignored');
});

// --- status, skip, testcase-lint, approval history -----------------------------------------------

test('status reports where the story is, what is next, and what blocks it', () => {
  const dir = tmp();
  seed(dir, 'B10-57771');
  for (const k of ['requirements', 'figma-analysis', 'clarifications', 'impact', 'hls', 'testcases']) rec(dir, k);
  rec(dir, 'testcase-review');

  const s = JSON.parse(run(['status', dir, '--profile', 'shift-left', '--json']));
  assert.equal(s.next, 'browserstack-import');
  assert.ok(s.blockers.some((b) => /awaiting operator approval/.test(b)));
  assert.equal(s.rows.find((r) => r.key === 'testcases').status, 'complete');

  run(['approve', dir, 'testcases', '--by', 'Operator']);
  rec(dir, 'browserstack-import');
  const done = JSON.parse(run(['status', dir, '--profile', 'shift-left', '--json']));
  assert.equal(done.next, null);
  assert.equal(done.blockers.length, 0);
  assert.equal(done.rows.find((r) => r.key === 'testcases').approvedBy, 'Operator');
  // status reports, it never gates — even mid-run it exits 0, unlike complete-check.
  assert.doesNotThrow(() => run(['status', dir, '--profile', 'validate']));
});

test('status surfaces artifacts whose generator predates the current methodology', () => {
  const dir = tmp();
  seed(dir, 'B10-1');
  run(['record', dir, 'hls', '--path', 'a.md', '--generator', 'test-design@1.0']);
  const s = JSON.parse(run(['status', dir, '--json']));
  assert.equal(s.methodologyOutdated.length, 1);
  assert.match(s.methodologyOutdated[0], /hls: test-design@1\.0 → test-design@2\.1/);
});

test('skip records a conditional phase as a decision; non-conditional phases must be deferred', () => {
  const dir = tmp();
  seed(dir, 'B10-1');
  const out = JSON.parse(run(['skip', dir, 'exploratory-notes', '--by', 'Operator', '--reason', 'isolated change']));
  assert.equal(out.skipped, 'exploratory-notes');
  assert.equal(out.decidedBy, 'Operator');

  assert.ok(fails(['skip', dir, 'exploratory-notes', '--by', 'Operator']));          // reason required
  assert.match(fails(['skip', dir, 'automation', '--by', 'Operator', '--reason', 'x']),
    /not a conditional artifact/);                                                    // no skipping owed work

  assert.equal(JSON.parse(run(['status', dir, '--json'])).conditional
    .find((c) => c.key === 'exploratory-notes').status, 'skipped');
});

test('re-approval keeps the original approver in history', () => {
  const dir = tmp();
  seed(dir, 'B10-1');
  rec(dir, 'testcases');
  run(['approve', dir, 'testcases', '--by', 'First Operator', '--note', 'original suite']);
  fs.writeFileSync(path.join(dir, 'a.md'), 'body + validation deltas');
  rec(dir, 'testcases');
  const second = JSON.parse(run(['approve', dir, 'testcases', '--by', 'Second Operator', '--note', '3 cases added']));
  assert.equal(second.approvedBy, 'Second Operator');
  assert.equal(second.history.length, 1);
  assert.equal(second.history[0].approvedBy, 'First Operator');
  assert.equal(second.history[0].note, 'original suite');
  assert.equal(validateState(dir), true);
});

test('testcase-lint is a gate: it exits 1 on an error and 0 on a clean suite', () => {
  const dir = tmp();
  const HEADER = require('../lib/testcases/parse').COLUMNS.join(',');
  const row = (title, tags, expected) => `,"${title}",48895703,"F>P",Active,Fintech,High,Functional,Not Automated,"D","P",Steps,"Log in","${expected}",B10-1,"${tags}",,,,,,,BCard Squad,`;
  fs.mkdirSync(path.join(dir, 'testcases'), { recursive: true });
  const write = (...rows) => fs.writeFileSync(path.join(dir, 'testcases/testcases.csv'), [HEADER, ...rows].join('\n') + '\n');

  write(row('Verify one', 'ac:AC-1', ''));   // step with no expected result
  const broken = fails(['testcase-lint', dir, '--acs', 'AC-1']);
  assert.ok(broken, 'a suite with errors must fail the command');

  write(row('Verify one', 'ac:AC-1', 'Dashboard is displayed'), row('Verify two', 'ac:AC-2', 'The list is displayed'));
  const ok = JSON.parse(run(['testcase-lint', dir, '--acs', 'AC-1,AC-2', '--json']));
  assert.equal(ok.errors, 0);
  assert.equal(ok.summary.cases, 2);

  // ...and an uncovered AC is an error, so "no missing AC coverage" stops being a self-assessment.
  assert.ok(fails(['testcase-lint', dir, '--acs', 'AC-1,AC-2,AC-3']));
});

test('branch-check fails when a repo is not on the story branch', () => {
  const dir = tmp();
  seed(dir, 'B10-56717');
  // A repo that is not a git repo at all has no branch -> must fail, never pass by default.
  const failed = fails(['branch-check', dir, 'B10-56717', '--repos', dir]);
  assert.ok(failed, 'branch-check must fail when the branch cannot be confirmed');
  assert.match(failed, /branch-check FAILED/);
});
