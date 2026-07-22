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
  fs.writeFileSync(path.join(dir, 'h.md'), 'h'); run(['record', dir, 'hls', '--path', 'h.md', '--generator', 'test-design@1.0', '--derive-artifacts', 'requirements,figma-analysis,impact']);

  // No stdin, no figma flags → nothing changed → reuse all 5
  const fresh = JSON.parse(run(['reconcile', dir]));
  assert.equal(fresh.reuse.length, 5);
  assert.equal(fresh.stale.length, 0);

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
