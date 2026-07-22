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

test('unknown command exits non-zero', () => {
  assert.throws(() => run(['bogus']));
});
