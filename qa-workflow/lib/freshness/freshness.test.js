'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sha256, normalizeJira, fingerprintJira, fingerprintFigma } = require('./fingerprint');
const { reconcile } = require('./reconcile');
const { topoOrder, dependentsOf } = require('./dag');

// ── fingerprint ──────────────────────────────────────────────────────
test('sha256 is deterministic hex', () => {
  assert.equal(sha256('x'), sha256('x'));
  assert.match(sha256('x'), /^[a-f0-9]{64}$/);
});

test('normalizeJira is comment-order independent and whitespace-insensitive', () => {
  const a = normalizeJira({ summary: 'S', description: 'D', ac: 'A', comments: [{ id: 2, body: 'two' }, { id: 1, body: 'one' }] });
  const b = normalizeJira({ summary: 'S', description: 'D  ', ac: 'A', comments: [{ id: 1, body: 'one' }, { id: 2, body: 'two' }] });
  assert.equal(a, b);
});

test('fingerprintJira changes when a material field changes', () => {
  const base = { updated: 't', summary: 'S', description: 'D', ac: 'A', comments: [] };
  assert.notEqual(fingerprintJira(base).hash, fingerprintJira({ ...base, ac: 'A2' }).hash);
});

test('fingerprintFigma prefers framesHash, else hashes version+nodes', () => {
  assert.equal(fingerprintFigma({ framesHash: 'f'.repeat(64), version: 'v9' }), 'f'.repeat(64));
  const a = fingerprintFigma({ version: 'v1', nodeIds: ['1:1', '1:2'] });
  const b = fingerprintFigma({ version: 'v1', nodeIds: ['1:2', '1:1'] }); // order-independent
  assert.equal(a, b);
  assert.notEqual(a, fingerprintFigma({ version: 'v2', nodeIds: ['1:1', '1:2'] }));
});

// ── dag ──────────────────────────────────────────────────────────────
test('topoOrder puts upstream before dependents', () => {
  const o = topoOrder(['hls', 'impact', 'requirements']);
  assert.ok(o.indexOf('requirements') < o.indexOf('impact'));
  assert.ok(o.indexOf('impact') < o.indexOf('hls'));
});

test('dependentsOf(requirements) includes impact and hls', () => {
  const d = dependentsOf('requirements');
  assert.ok(d.includes('impact') && d.includes('hls'));
});

// ── reconcile fixtures ───────────────────────────────────────────────
function baseState(overrides = {}) {
  const HJ = sha256('jira-v1');
  const figma = { fileKey: 'k', nodeIds: ['1:1'], version: 'v1' };
  const FF = fingerprintFigma(figma);
  const cs = (k) => sha256('content-' + k);
  const rec = (key, derivedFrom, extra = {}) => ({ path: key + '.md', status: 'complete', generator: key + '@1.0', derivedFrom, checksum: cs(key), ...extra });
  const state = {
    schemaVersion: 1, ticket: 'B10-1', sources: { jira: { updated: 't', hash: HJ }, figma },
    domains: {}, artifacts: {
      requirements: rec('requirements', { jira: HJ }, overrides.reqExtra),
      'figma-analysis': rec('figma-analysis', { figma: FF }),
      clarifications: rec('clarifications', { jira: HJ }),
      impact: rec('impact', { requirements: cs('requirements'), 'figma-analysis': cs('figma-analysis') }),
      hls: rec('hls', { requirements: cs('requirements') }),
    },
  };
  return { state, HJ, FF, figma, cs };
}
function ioFor(state, ov = {}) {
  const byPath = (rel) => Object.keys(state.artifacts).find((k) => state.artifacts[k].path === rel);
  return {
    exists: (rel) => !(ov.absent || []).includes(rel),
    checksum: (rel) => { const k = byPath(rel); if (ov.checksum && k in ov.checksum) return ov.checksum[k]; return k ? state.artifacts[k].checksum : null; },
  };
}
const liveFresh = (b) => ({ jira: { hash: b.HJ }, figma: b.figma, domains: {} });

// ── reconcile scenarios ──────────────────────────────────────────────
test('all fresh → reuse all, nothing stale', () => {
  const b = baseState();
  const r = reconcile(b.state, liveFresh(b), ioFor(b.state));
  assert.deepEqual(r.stale, []);
  assert.equal(r.conflicts.length, 0);
  assert.equal(r.reuse.length, 5);
});

test('jira changed → requirements + cascade stale; figma-analysis reused', () => {
  const b = baseState();
  const live = { jira: { hash: sha256('jira-v2') }, figma: b.figma, domains: {} };
  const r = reconcile(b.state, live, ioFor(b.state));
  assert.ok(r.stale.includes('requirements'));
  assert.ok(r.stale.includes('impact'));
  assert.ok(r.stale.includes('hls'));
  assert.ok(r.reuse.includes('figma-analysis'));
  assert.ok(r.stale.indexOf('requirements') < r.stale.indexOf('impact')); // topo
  assert.equal(r.sourceChanged.jira, true);
});

test('clarifications materiality gate: immaterial jira change is carried forward', () => {
  const b = baseState();
  const live = { jira: { hash: sha256('jira-v2') }, figma: b.figma, domains: {} };
  const r = reconcile(b.state, live, ioFor(b.state), { materiality: () => false });
  assert.ok(r.reuse.includes('clarifications')); // gated → reused
  assert.ok(r.stale.includes('requirements'));   // still stale (no gate)
});

test('figma changed → figma-analysis + cascade stale; requirements reused', () => {
  const b = baseState();
  const live = { jira: { hash: b.HJ }, figma: { ...b.figma, version: 'v2' }, domains: {} };
  const r = reconcile(b.state, live, ioFor(b.state));
  assert.ok(r.stale.includes('figma-analysis'));
  assert.ok(r.stale.includes('impact'));
  assert.ok(r.stale.includes('hls'));
  assert.ok(r.reuse.includes('requirements'));
  assert.ok(r.reuse.includes('clarifications'));
  assert.equal(r.sourceChanged.figma, true);
});

test('missing artifact file → stale + cascade', () => {
  const b = baseState();
  const r = reconcile(b.state, liveFresh(b), ioFor(b.state, { absent: ['impact.md'] }));
  assert.ok(r.stale.includes('impact'));
  assert.ok(r.stale.includes('hls'));
  assert.ok(r.reuse.includes('requirements'));
});

test('human edit without source change → modified & reused; dependents reused', () => {
  const b = baseState();
  const r = reconcile(b.state, liveFresh(b), ioFor(b.state, { checksum: { requirements: sha256('edited') } }));
  assert.ok(r.reuse.includes('requirements'));
  assert.equal(r.modified.length, 1);
  assert.equal(r.modified[0].key, 'requirements');
  assert.ok(r.reuse.includes('impact')); // modified upstream does NOT cascade-stale
  assert.equal(r.conflicts.length, 0);
});

test('human edit + source change → conflict; dependents blocked', () => {
  const b = baseState();
  const live = { jira: { hash: sha256('jira-v2') }, figma: b.figma, domains: {} };
  const r = reconcile(b.state, live, ioFor(b.state, { checksum: { requirements: sha256('edited') } }));
  assert.ok(r.conflicts.some((c) => c.key === 'requirements'));
  assert.ok(r.stale.includes('impact')); // conflict blocks dependents
  assert.ok(!r.reuse.includes('requirements'));
});

test('generator version bump → stale', () => {
  const b = baseState();
  const r = reconcile(b.state, liveFresh(b), ioFor(b.state), { generators: { requirements: 'requirements@1.1' } });
  assert.ok(r.stale.includes('requirements'));
  assert.ok(r.reasons.requirements.includes('generator-version'));
});

test('domain change → consuming artifact stale', () => {
  const b = baseState({ reqExtra: { domains: ['card'] } });
  b.state.domains = { card: { version: '1.0', checksum: sha256('card-v1') } };
  const live = { jira: { hash: b.HJ }, figma: b.figma, domains: { card: { version: '1.1', checksum: sha256('card-v2') } } };
  const r = reconcile(b.state, live, ioFor(b.state), {});
  assert.ok(r.stale.includes('requirements'));
  assert.ok(r.reasons.requirements.includes('domain-changed'));
});

test('empty qa-state → all expected are stale (nothing to reuse)', () => {
  const r = reconcile({}, { jira: { hash: sha256('x') } }, { exists: () => false, checksum: () => null });
  assert.equal(r.reuse.length, 0);
  assert.ok(r.stale.includes('requirements'));
});
