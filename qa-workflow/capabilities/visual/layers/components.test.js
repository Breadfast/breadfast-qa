'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { compareComponents } = require('./components');
const { runPipeline } = require('../../../lib/conformance');
const visual = require('../capability');

test('missing REQUIRED component ⇒ MAJOR; missing optional ⇒ nothing', () => {
  const req = compareComponents({ components: [{ componentId: 'delete-btn', required: true }] }, { elements: [{ testId: 'edit-btn' }] });
  assert.equal(req.length, 1);
  assert.equal(req[0].severity, 'major');
  assert.equal(req[0].dimension, 'missing-component');
  assert.equal(req[0].subject, 'delete-btn');

  const opt = compareComponents({ components: [{ componentId: 'x', required: false }] }, { elements: [] });
  assert.equal(opt.length, 0);
});

test('duplicate beyond maxCardinality ⇒ MAJOR', () => {
  const f = compareComponents(
    { components: [{ componentId: 'card', required: true, maxCardinality: 1 }] },
    { elements: [{ testId: 'card' }, { testId: 'card' }] },
  );
  assert.equal(f.length, 1);
  assert.equal(f[0].dimension, 'duplicate-component');
  assert.equal(f[0].severity, 'major');
});

test('wrong ordering ⇒ MINOR', () => {
  const f = compareComponents(
    { components: [{ componentId: 'a', order: 1 }, { componentId: 'b', order: 2 }] },
    { elements: [{ testId: 'b' }, { testId: 'a' }] }, // b before a
  );
  assert.equal(f.length, 1);
  assert.equal(f[0].dimension, 'ordering');
  assert.equal(f[0].severity, 'minor');
});

test('wrong hierarchy (parent mismatch) ⇒ MINOR', () => {
  const f = compareComponents(
    { components: [{ componentId: 'parent' }, { componentId: 'child', parent: 'parent' }] },
    { elements: [{ testId: 'parent', id: 'P' }, { testId: 'child', parentId: 'X' }] },
  );
  assert.equal(f.length, 1);
  assert.equal(f[0].dimension, 'hierarchy');
  assert.equal(f[0].severity, 'minor');
});

test('no expected components ⇒ dormant (no false findings)', () => {
  assert.equal(compareComponents({}, { elements: [{ testId: 'anything' }] }).length, 0);
});

test('end-to-end: L2 + L5 run together through the pipeline, 0 AI', () => {
  const expected = {
    screenId: 's',
    components: [{ componentId: 'delete-btn', required: true }],
    texts: [{ subject: 'title', text: 'Card Perks' }],
  };
  const actual = {
    screenId: 's',
    elements: [{ testId: 'title', text: 'Card perks' }],
    texts: [{ subject: 'title', text: 'Card perks' }],
  };
  const r = runPipeline(visual, { expected, actual, ctx: { screen: 's' } });
  assert.equal(r.aiInvoked, false);
  assert.ok(r.stagesRun.includes('l2') && r.stagesRun.includes('l5'));
  assert.equal(r.findings.length, 2); // L2 missing (major) + L5 casing (minor)
  assert.equal(r.health.score, 87); // 100 - 10 - 3
  const byLayer = r.findings.reduce((acc, f) => ((acc[f.layer] = (acc[f.layer] || 0) + 1), acc), {});
  assert.equal(byLayer['component-tree'], 1);
  assert.equal(byLayer.text, 1);
});
