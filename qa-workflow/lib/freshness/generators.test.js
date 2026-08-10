'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadGenerators, loadDomains, pickDomains, readProduces, readVersion, readName, frontmatter } = require('./generators');
const { reconcile } = require('./reconcile');
const { sha256 } = require('./fingerprint');

const SKILLS = path.join(__dirname, '..', '..', 'skills');
const DOMAINS = path.join(__dirname, '..', '..', 'domains');
const REPO = path.join(__dirname, '..', '..', '..');

const tmpSkill = (body) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-'));
  fs.mkdirSync(path.join(dir, 's'));
  fs.writeFileSync(path.join(dir, 's', 'SKILL.md'), body);
  return dir;
};

// ── frontmatter reading ───────────────────────────────────────────────
test('produces is read from the produces block, never from consumes', () => {
  // The trap: consumes and produces both contain an `artifacts:` key. Matching the first one maps
  // every skill to what it READS, silently pointing rule (d) at the wrong artifacts.
  const dir = tmpSkill(`---
name: test-design
metadata:
  version: 2.0
  consumes:
    artifacts: [requirements, figma-analysis, impact]
  produces:
    artifacts: [hls, testcases]
---
body`);
  assert.deepEqual(loadGenerators(path.join(dir)), { hls: 'test-design@2.0', testcases: 'test-design@2.0' });
});

test('a skill with no version is ignored rather than mapped to a bogus generator', () => {
  const dir = tmpSkill(`---\nname: x\nmetadata:\n  produces:\n    artifacts: [thing]\n---\n`);
  assert.deepEqual(loadGenerators(dir), {});
});

test('frontmatter helpers', () => {
  const fm = frontmatter('---\nname: a-b\nmetadata:\n  version: "1.2"\n---\nbody');
  assert.equal(readName(fm), 'a-b');
  assert.equal(readVersion(fm), '1.2');
  assert.deepEqual(readProduces(fm), []);
  assert.equal(frontmatter('no frontmatter'), '');
});

// ── the real tree ─────────────────────────────────────────────────────
test('the repo skills map every artifact a skill claims to produce', () => {
  const gens = loadGenerators(SKILLS);
  // Coverage definition moved to shift-left: test-design owns hls AND testcases.
  assert.equal(gens.hls, 'test-design@2.0');
  assert.equal(gens.testcases, 'test-design@2.0');
  assert.equal(gens['testcase-review'], 'testcase-review@1.0');
  assert.equal(gens['browserstack-import'], 'browserstack-mgmt@2.0');
  assert.equal(gens.requirements, 'story-analysis@1.0');
  // Artifacts no skill produces stay unmapped, so rule (d) simply does not apply to them.
  assert.equal(gens.execution, undefined);
  assert.equal(gens.clarifications, undefined);   // grill-me lives outside qa-workflow/skills
});

test('domains fingerprint to version + checksum, and carry a sources hash for drift reporting', () => {
  const d = loadDomains(DOMAINS, REPO);
  for (const id of ['card', 'payment', 'marketing']) {
    assert.match(d[id].version, /^[0-9]+\.[0-9]+$/);
    assert.match(d[id].checksum, /^[a-f0-9]{64}$/);
  }
  // pickDomains keeps only what the artifact declared, and drops sourcesHash (not part of the ledger).
  const picked = pickDomains(d, ['card', 'nope']);
  assert.deepEqual(Object.keys(picked), ['card']);
  assert.deepEqual(Object.keys(picked.card).sort(), ['checksum', 'version']);
});

// ── the two rules these loaders exist to switch on ────────────────────
const baseState = (generator, domains) => ({
  schemaVersion: 1, ticket: 'B10-1',
  sources: { jira: { updated: 't', hash: sha256('j') } },
  domains: domains || {},
  artifacts: {
    requirements: {
      path: 'r.md', status: 'complete', generator,
      derivedFrom: { jira: sha256('j') }, checksum: sha256('c'),
      ...(domains ? { domains: Object.keys(domains) } : {}),
    },
  },
});
const io = { exists: () => true, checksum: () => sha256('c') };
const live = { jira: { hash: sha256('j') } };

test('rule (d): a bumped skill version marks the artifact stale — the lock seam, wired', () => {
  const opts = { expected: ['requirements'], generators: { requirements: 'story-analysis@1.1' } };
  const r = reconcile(baseState('story-analysis@1.0'), live, io, opts);
  assert.deepEqual(r.stale, ['requirements']);
  assert.ok(r.reasons.requirements.includes('generator-version'));

  // ...and an equal version reuses (so a normal run is not permanently stale).
  const same = reconcile(baseState('story-analysis@1.1'), live, io, opts);
  assert.deepEqual(same.reuse, ['requirements']);
});

test('rule (e): a bumped domain version marks its consumers stale', () => {
  const stored = { card: { version: '1.0', checksum: sha256('card-v1') } };
  const bumped = { card: { version: '1.1', checksum: sha256('card-v2') } };
  const r = reconcile(baseState('story-analysis@1.0', stored), { ...live, domains: bumped }, io, { expected: ['requirements'] });
  assert.deepEqual(r.stale, ['requirements']);
  assert.ok(r.reasons.requirements.includes('domain-changed'));
});

test('rule (e) is inert without the top-level domains map — the bug that made it dead', () => {
  // An artifact that declares `domains: ['card']` but has no stored fingerprint cannot be compared.
  // Before `record` wrote state.domains, this was EVERY artifact, so a business-rule change never
  // invalidated anything. Documented here so a regression is visible rather than silent.
  const noProvenance = baseState('story-analysis@1.0');
  noProvenance.artifacts.requirements.domains = ['card'];
  const r = reconcile(noProvenance, { ...live, domains: { card: { version: '9.9', checksum: sha256('x') } } }, io, { expected: ['requirements'] });
  assert.deepEqual(r.reuse, ['requirements']);
});
