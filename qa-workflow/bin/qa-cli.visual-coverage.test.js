'use strict';
/**
 * The VISUAL-COVERAGE gate, end to end.
 *
 * These tests exist because of B10-58669: Phase 2 exported twelve primary design frames, Phase 5
 * compared six of them by eye, reported "all match", filed nothing, and every gate stayed green —
 * three real deviations (B10-59822, B10-59823, B10-59826) lived in the frames and states that were
 * never compared. AC coverage could not fail that way, because it is computed and enforced. The
 * point of the gate, and of these tests, is that visual coverage now cannot either: a frame the
 * design owns must be compared (and say how) or excluded (and say why), and a frame claiming to be
 * engine-verified is checked against the engine's own output rather than believed.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CLI = path.join(__dirname, 'qa-cli.js');
const run = (args, input) => execFileSync(process.execPath, [CLI, ...args],
  { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], input: input || '' });
/**
 * Capture stderr on SUCCESS too: the gate passes while still printing `manual-comparison` warnings to
 * stderr, and a helper that only kept stderr on failure could not see them.
 */
const runFail = (args) => {
  const r = { code: 0, out: '', err: '' };
  const cp = require('child_process').spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  r.code = cp.status;
  r.out = String(cp.stdout || '');
  r.err = String(cp.stderr || '');
  return r;
};

/** A story with two exported frames and, optionally, a coverage declaration + an engine result. */
function story({ coverage, result } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-gate-'));
  run(['init', dir, 'B10-58669']);
  // `defer` validates the whole state, which requires sources.jira — so fingerprint before using it
  run(['fingerprint-jira', dir],
    JSON.stringify({ updated: '2026-09-07T00:00:00Z', summary: 's', description: 'd', ac: 'a', comments: [] }));
  fs.mkdirSync(path.join(dir, 'figma-analysis'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'figma-analysis', 'capture-spec.json'), JSON.stringify({
    fileKey: 'k', frames: [{ node: '1:1', name: 'f01_default' }, { node: '1:2', name: 'f02_picker_open' }],
  }));
  if (coverage) {
    fs.writeFileSync(path.join(dir, 'figma-analysis', 'frame-coverage.json'), JSON.stringify(coverage));
  }
  if (result) {
    fs.mkdirSync(path.join(dir, 'visual'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'visual', 'result.json'), JSON.stringify(result));
  }
  return dir;
}

test('a story with no design frames is skipped, not failed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-none-'));
  run(['init', dir, 'B10-1']);
  const r = runFail(['visual-coverage', dir]);
  assert.equal(r.code, 0);
  assert.match(r.out, /skipped/);
});

test('exported frames with NO coverage declaration fail the gate', () => {
  const r = runFail(['visual-coverage', story()]);
  assert.equal(r.code, 1);
  assert.match(r.err, /no-frame-coverage/);
});

test('a frame that is neither compared nor excluded fails as uncovered-frame', () => {
  const dir = story({ coverage: { frames: [{ frame: 'f01_default', compared: true, comparedVia: 'manual:a01' }] } });
  const r = runFail(['visual-coverage', dir]);
  assert.equal(r.code, 1);
  assert.match(r.err, /uncovered-frame/);
  assert.match(r.err, /f02_picker_open/);
});

test('an exclusion with no reason fails — an exclusion is a decision', () => {
  const dir = story({ coverage: { frames: [
    { frame: 'f01_default', compared: true, comparedVia: 'manual:a01' },
    { frame: 'f02_picker_open', compared: false },
  ] } });
  const r = runFail(['visual-coverage', dir]);
  assert.equal(r.code, 1);
  assert.match(r.err, /unjustified-exclusion/);
});

test('an exclusion WITH a reason passes', () => {
  const dir = story({ coverage: { frames: [
    { frame: 'f01_default', compared: true, comparedVia: 'manual:a01' },
    { frame: 'f02_picker_open', compared: false, reason: 'alternate cluster, not adopted by the ACs' },
  ] } });
  const r = runFail(['visual-coverage', dir]);
  assert.equal(r.code, 0);
  assert.match(r.out, /visual-coverage OK/);
});

test('claiming engine verification the engine result does not support FAILS', () => {
  const dir = story({
    coverage: { frames: [
      { frame: 'f01_default', compared: true, comparedVia: 'engine:screen-a' },
      { frame: 'f02_picker_open', compared: true, comparedVia: 'engine:screen-that-never-ran' },
    ] },
    result: { screens: [{ screen: 'screen-a', method: 'identity', verdict: 'pass' }] },
  });
  const r = runFail(['visual-coverage', dir]);
  assert.equal(r.code, 1);
  assert.match(r.err, /engine-screen-not-found/);
  assert.match(r.err, /screen-that-never-ran/);
});

test('engine verification with no engine result at all FAILS', () => {
  const dir = story({ coverage: { frames: [
    { frame: 'f01_default', compared: true, comparedVia: 'engine:screen-a' },
    { frame: 'f02_picker_open', compared: false, reason: 'r' },
  ] } });
  const r = runFail(['visual-coverage', dir]);
  assert.equal(r.code, 1);
  assert.match(r.err, /engine-result-missing/);
});

test('a manual comparison passes but is reported as unverified', () => {
  const dir = story({ coverage: { frames: [
    { frame: 'f01_default', compared: true, comparedVia: 'manual:a01' },
    { frame: 'f02_picker_open', compared: true, comparedVia: 'manual:a02' },
  ] } });
  const r = runFail(['visual-coverage', dir]);
  assert.equal(r.code, 0);
  assert.match(r.err, /manual-comparison/);
  assert.match(r.out, /0 engine-verified/);
});

test('a frame-coverage entry naming a frame that was never exported FAILS', () => {
  const dir = story({ coverage: { frames: [
    { frame: 'f01_default', compared: true, comparedVia: 'manual:a01' },
    { frame: 'f02_picker_open', compared: false, reason: 'r' },
    { frame: 'f99_typo', compared: false, reason: 'r' },
  ] } });
  const r = runFail(['visual-coverage', dir]);
  assert.equal(r.code, 1);
  assert.match(r.err, /unknown-frame/);
});

test('complete-check FAILS on an uncovered frame, so the run cannot be called complete', () => {
  const dir = story({ coverage: { frames: [{ frame: 'f01_default', compared: true, comparedVia: 'manual:a01' }] } });
  const r = runFail(['complete-check', dir, '--expect', 'visual-findings']);
  assert.equal(r.code, 1);
  assert.match(r.err, /visual-coverage/);
});

test('a recorded operator deferral on visual-findings waives the visual-coverage gate', () => {
  const dir = story({ coverage: { frames: [{ frame: 'f01_default', compared: true, comparedVia: 'manual:a01' }] } });
  run(['defer', dir, 'visual-findings', '--by', 'Ahmed Essam', '--reason', 'no design for this story']);
  const r = runFail(['complete-check', dir, '--expect', 'visual-findings']);
  assert.equal(r.code, 0, r.err);
});
