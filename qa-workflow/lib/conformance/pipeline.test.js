'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runPipeline, defaultAiSkip } = require('./pipeline');
const { defineCapability } = require('./capability');

// A synthetic capability whose stage behavior we control per test.
function cap(detRun, aiRun) {
  return defineCapability({
    id: 'synthetic',
    title: 'Synthetic',
    expected: { provider: 'x', kind: 'k' },
    actual: { capture: 'c', kind: 'k' },
    resolver: 'id',
    stages: [
      { id: 'd1', layer: 'structure', title: 'det', deterministic: true, run: detRun },
      { id: 'r1', layer: 'ai-residual', title: 'ai', deterministic: false, run: aiRun },
    ],
    findingExtension: [],
    renderer: 'r',
  });
}

test('clean deterministic pass ⇒ 0 AI (deterministic-first)', () => {
  const r = runPipeline(cap(() => []), { expected: {}, actual: {}, ctx: {} });
  assert.equal(r.skipped, true);
  assert.equal(r.aiInvoked, false);
  assert.equal(r.findings.length, 0);
  assert.equal(r.health.score, 100);
});

test('a needsResidual finding triggers the AI residual on the residual only', () => {
  const det = () => [{ severity: 'minor', subject: 'X', category: 'layout', needsResidual: true }];
  const ai = (_e, _a, ctx) => {
    assert.equal(ctx.residualCandidates.length, 1); // only the flagged one is handed to AI
    return [{ severity: 'major', subject: 'X', category: 'layout', source: 'ai' }];
  };
  const r = runPipeline(cap(det, ai), { expected: {}, actual: {}, ctx: {} });
  assert.equal(r.skipped, false);
  assert.equal(r.aiInvoked, true);
  assert.equal(r.findings.length, 2);
  assert.equal(r.findings[0].source, 'deterministic');
  assert.equal(r.findings[1].source, 'ai');
});

test('unstructured surface forces AI even with no deterministic findings', () => {
  assert.equal(defaultAiSkip([], { unstructured: true }), false);
  const r = runPipeline(cap(() => [], () => [{ severity: 'info', subject: 'canvas', category: 'components' }]),
    { expected: {}, actual: {}, ctx: { unstructured: true } });
  assert.equal(r.aiInvoked, true);
});

test('unwired stages are recorded as pending, never crash', () => {
  const c = defineCapability({
    id: 'unwired', title: 'U', expected: { provider: 'x', kind: 'k' }, actual: { capture: 'c', kind: 'k' },
    resolver: 'id', findingExtension: [], renderer: 'r',
    stages: [
      { id: 'd1', layer: 's', title: 'd', deterministic: true }, // no run
      { id: 'r1', layer: 'ai', title: 'a', deterministic: false }, // no run, no aiRun fallback
    ],
  });
  const r = runPipeline(c, { expected: {}, actual: {}, ctx: { unstructured: true } });
  assert.deepEqual(r.pending.sort(), ['d1', 'r1']);
  assert.equal(r.findings.length, 0);
});

test('visual capability (instance #1) runs through the pipeline; empty input ⇒ 0 findings, 0 AI', () => {
  const visual = require('../../capabilities/visual/capability');
  const r = runPipeline(visual, { expected: {}, actual: {}, ctx: {} });
  assert.equal(r.aiInvoked, false);
  assert.equal(r.skipped, true); // no findings, structured ⇒ deterministic-first, 0 AI
  assert.ok(r.health.score === 100);
});
