'use strict';
/**
 * The coverage-change GATE, end to end. The point of these tests is that the rule cannot be routed
 * around by wording: an unratified coverage reduction must FAIL `approve testcases` and `complete-check`.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CLI = path.join(__dirname, 'qa-cli.js');
const run = (args, input, opts = {}) => execFileSync(process.execPath, [CLI, ...args],
  { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], input: input || '', ...opts });
const runFail = (args) => {
  try { run(args); return { code: 0, out: '', err: '' }; }
  catch (e) { return { code: e.status, out: String(e.stdout || ''), err: String(e.stderr || '') }; }
};

function story() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-gate-'));
  run(['init', dir, 'B10-57764']);
  run(['fingerprint-jira', dir],
    JSON.stringify({ updated: '2026-08-24T00:00:00Z', summary: 's', description: 'd', ac: 'a', comments: [] }));
  fs.mkdirSync(path.join(dir, 'testcases'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'testcases', 'testcases.csv'), 'x\n');
  run(['record', dir, 'testcases', '--path', 'testcases/testcases.csv', '--generator', 'test-design@2.1']);
  return dir;
}
const addCC = (dir, id = 'a-3') => run(['coverage-change', 'add', dir, id,
  '--source', 'clarification', '--source-ref', 'clarification/clarifications.md#A-3',
  '--affects', 'AC-5', '--kind', 'removes-visual-validation,visual-to-behavioural',
  '--reason', 'design states looked identical', '--evidence', 'ImageChops bbox None',
  '--scope-checked', 'unchecked only']);

test('add records it as proposed, with every field kept', () => {
  const dir = story();
  const rec = JSON.parse(addCC(dir));
  assert.strictEqual(rec.status, 'proposed');
  assert.deepStrictEqual(rec.affects, ['AC-5']);
  assert.deepStrictEqual(rec.kind, ['removes-visual-validation', 'visual-to-behavioural']);
  assert.strictEqual(rec.scopeChecked, 'unchecked only');
});

test('GATE: approve testcases FAILS while a coverage change is proposed', () => {
  const dir = story();
  addCC(dir);
  const r = runFail(['approve', dir, 'testcases', '--by', 'Ahmed']);
  assert.notStrictEqual(r.code, 0, 'approval must not succeed');
  assert.match(r.err, /coverage-changing decision\(s\) still proposed/);
  assert.match(r.err, /a-3/);
});

test('GATE: ratifying it unblocks approval', () => {
  const dir = story();
  addCC(dir);
  const ok = JSON.parse(run(['coverage-change', 'approve', dir, 'a-3', '--by', 'Ahmed']));
  assert.strictEqual(ok.status, 'approved');
  assert.strictEqual(ok.approvedBy, 'Ahmed');
  const out = JSON.parse(run(['approve', dir, 'testcases', '--by', 'Ahmed']));
  assert.strictEqual(out.approved, 'testcases');
});

test('GATE: rejecting it ALSO unblocks approval — but the coverage stays (operator re-opens design)', () => {
  const dir = story();
  addCC(dir);
  const out = run(['coverage-change', 'reject', dir, 'a-3', '--by', 'Ahmed', '--reason', 'checked box differs']);
  assert.match(out, /the coverage STAYS/);
  assert.strictEqual(JSON.parse(out.slice(0, out.indexOf('\n\n') + 1)).status, 'rejected');
});

test('approve/reject cannot be self-granted — --by is required', () => {
  const dir = story();
  addCC(dir);
  assert.notStrictEqual(runFail(['coverage-change', 'approve', dir, 'a-3']).code, 0);
  assert.notStrictEqual(runFail(['coverage-change', 'reject', dir, 'a-3', '--by', 'X']).code, 0, 'reject needs a reason');
});

test('GATE: complete-check fails the run on an unratified coverage change', () => {
  const dir = story();
  addCC(dir);
  const r = runFail(['complete-check', dir, '--expect', 'testcases']);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.out + r.err, /coverage-change:a-3/);
});

test('status reports open coverage changes and names what they block', () => {
  const dir = story();
  addCC(dir);
  const out = run(['status', dir]);
  assert.match(out, /coverage changes: 1 recorded, 1 awaiting review/);
  assert.match(out, /blocks: approve <storyDir> testcases/);
});

test('an unrecorded story is unaffected — the gate is opt-in by emission', () => {
  const dir = story();
  const out = JSON.parse(run(['approve', dir, 'testcases', '--by', 'Ahmed']));
  assert.strictEqual(out.approved, 'testcases');
});
