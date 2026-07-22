'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const qs = require('./qa-state');
const { sha256 } = require('./freshness/fingerprint');

function tmpStory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qa-state-'));
}

test('newState is schema-valid and loads back after save', () => {
  const dir = tmpStory();
  const s = qs.newState('B10-42');
  s.sources.jira = { updated: 't', hash: 'a'.repeat(64) };
  const file = qs.save(dir, s);
  assert.ok(fs.existsSync(file));
  const loaded = qs.load(dir);
  assert.equal(loaded.ticket, 'B10-42');
  assert.ok(loaded.updatedAt, 'updatedAt stamped on save');
});

test('load returns null when no state file exists', () => {
  assert.equal(qs.load(tmpStory()), null);
});

test('save throws on invalid state', () => {
  const dir = tmpStory();
  const s = qs.newState('bad key');
  assert.throws(() => qs.save(dir, s), /invalid/);
});

test('checksumArtifact matches sha256 of file bytes', () => {
  const dir = tmpStory();
  fs.writeFileSync(path.join(dir, 'a.md'), 'hello');
  assert.equal(qs.checksumArtifact(dir, 'a.md'), sha256('hello'));
  assert.equal(qs.checksumArtifact(dir, 'missing.md'), null);
});

test('makeIo reflects the story folder', () => {
  const dir = tmpStory();
  fs.writeFileSync(path.join(dir, 'x.md'), 'data');
  const io = qs.makeIo(dir);
  assert.equal(io.exists('x.md'), true);
  assert.equal(io.exists('nope.md'), false);
  assert.equal(io.checksum('x.md'), sha256('data'));
});

test('applyModified re-baselines checksum and sets status modified', () => {
  const s = qs.newState('B10-1');
  qs.setArtifact(s, 'requirements', { path: 'r.md', status: 'complete', generator: 'story-analysis@1.0', checksum: 'a'.repeat(64) });
  qs.applyModified(s, [{ key: 'requirements', newChecksum: 'b'.repeat(64) }]);
  assert.equal(s.artifacts.requirements.status, 'modified');
  assert.equal(s.artifacts.requirements.checksum, 'b'.repeat(64));
});
