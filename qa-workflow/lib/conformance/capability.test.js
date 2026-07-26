'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateCapability, defineCapability, deterministicStages, residualStages } = require('./capability');

function baseline() {
  return {
    id: 'sample',
    title: 'Sample capability',
    expected: { provider: 'x', kind: 'k' },
    actual: { capture: 'c', kind: 'k' },
    resolver: 'id',
    stages: [
      { id: 's1', layer: 'identity', title: 'id', deterministic: true },
      { id: 's2', layer: 'ai', title: 'residual', deterministic: false },
    ],
    findingExtension: ['foo'],
    renderer: 'r',
  };
}

test('validateCapability accepts a well-formed descriptor', () => {
  assert.equal(validateCapability(baseline()).valid, true);
});

test('validateCapability rejects bad id / missing pieces / duplicate stage ids', () => {
  const badId = { ...baseline(), id: 'Bad ID' };
  assert.equal(validateCapability(badId).valid, false);

  const noStages = { ...baseline(), stages: [] };
  assert.equal(validateCapability(noStages).valid, false);

  const dup = { ...baseline(), stages: [
    { id: 's1', layer: 'a', title: 'a', deterministic: true },
    { id: 's1', layer: 'b', title: 'b', deterministic: false },
  ] };
  assert.equal(validateCapability(dup).valid, false);
});

test('deterministic-first invariant: at least one deterministic stage required', () => {
  const allAi = { ...baseline(), stages: [{ id: 's1', layer: 'ai', title: 'ai', deterministic: false }] };
  const { valid, errors } = validateCapability(allAi);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => /deterministic-first/.test(e.message)));
});

test('defineCapability throws on an invalid descriptor and freezes a valid one', () => {
  assert.throws(() => defineCapability({ id: 'nope' }), /invalid ConformanceCapability/);
  const c = defineCapability(baseline());
  assert.throws(() => { c.stages.push({}); }, TypeError); // frozen
});

test('stage partitioning is deterministic-first then residual', () => {
  const c = defineCapability(baseline());
  assert.deepEqual(deterministicStages(c).map((s) => s.id), ['s1']);
  assert.deepEqual(residualStages(c).map((s) => s.id), ['s2']);
});

test('visual capability (instance #1) validates against the contract', () => {
  const visual = require('../../capabilities/visual/capability');
  assert.equal(validateCapability(visual).valid, true);
  assert.equal(visual.id, 'visual');
  // L1–L7 deterministic, L8 the sole residual — the generalization holds.
  assert.equal(deterministicStages(visual).length, 7);
  assert.deepEqual(residualStages(visual).map((s) => s.layer), ['ai-residual']);
  assert.deepEqual(visual.findingExtension, ['component', 'token']);
});
