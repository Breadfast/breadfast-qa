'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateQaState } = require('./validate');

const H = 'a'.repeat(64);
function valid() {
  return {
    schemaVersion: 1, ticket: 'B10-56729', updatedAt: '2026-07-22T00:00:00Z', generatedBy: 'qa-shift-left@1.0',
    sources: {
      jira: { updated: '2026-07-22T00:00:00Z', hash: H, fieldsHashed: ['summary', 'ac', 'comments'] },
      figma: { fileKey: 'k', nodeIds: ['1:211'], lastModified: '2026-07-20T00:00:00Z', version: 'v', framesHash: H },
    },
    domains: { card: { version: '1.0', checksum: H } },
    artifacts: {
      requirements: { path: 'requirements-analysis/requirements.md', status: 'complete', generator: 'story-analysis@1.0', derivedFrom: { jira: H }, checksum: H, domains: ['card'] },
    },
  };
}

test('a well-formed state validates', () => {
  const r = validateQaState(valid());
  assert.equal(r.valid, true, JSON.stringify(r.errors));
});

test('modified status is accepted', () => {
  const s = valid(); s.artifacts.requirements.status = 'modified';
  assert.equal(validateQaState(s).valid, true);
});

test('bad ticket rejected', () => {
  const s = valid(); s.ticket = 'not a key';
  const r = validateQaState(s);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.path === 'ticket'));
});

test('bad status rejected', () => {
  const s = valid(); s.artifacts.requirements.status = 'whatever';
  assert.ok(validateQaState(s).errors.some((e) => e.path === 'artifacts.requirements.status'));
});

test('missing artifact path rejected', () => {
  const s = valid(); delete s.artifacts.requirements.path;
  assert.ok(validateQaState(s).errors.some((e) => e.path === 'artifacts.requirements.path'));
});

test('bad generator rejected', () => {
  const s = valid(); s.artifacts.requirements.generator = 'nope';
  assert.ok(validateQaState(s).errors.some((e) => e.path === 'artifacts.requirements.generator'));
});

test('non-sha256 framesHash rejected', () => {
  const s = valid(); s.sources.figma.framesHash = 'short';
  assert.ok(validateQaState(s).errors.some((e) => e.path === 'sources.figma.framesHash'));
});

test('non-sha256 derivedFrom value rejected', () => {
  const s = valid(); s.artifacts.requirements.derivedFrom.jira = 'xyz';
  assert.ok(validateQaState(s).errors.some((e) => e.path === 'artifacts.requirements.derivedFrom.jira'));
});

test('missing sources.jira rejected', () => {
  const s = valid(); delete s.sources.jira;
  assert.ok(validateQaState(s).errors.some((e) => e.path === 'sources.jira'));
});

test('non-object root rejected', () => {
  assert.equal(validateQaState(null).valid, false);
});
