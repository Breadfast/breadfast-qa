'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runResidual, evaluateStory } = require('./residual');
const visual = require('../../capabilities/visual/capability');

test('runResidual without a judge: no AI, nothing processed', async () => {
  const r = await runResidual([{ screen: 'canvas', reason: 'unstructured-surface' }], {});
  assert.equal(r.aiInvoked, false);
  assert.equal(r.findings.length, 0);
  assert.equal(r.processed.length, 0);
});

test('evaluateStory: deterministic-first, AI judge called ONLY on residual items', async () => {
  const seen = [];
  const judge = async ({ screen, reason }) => {
    seen.push(screen);
    return [{ severity: 'major', category: 'components', subject: screen, description: `AI review (${reason})` }];
  };
  const r = await evaluateStory(visual, {
    expected: [
      { screenId: 'ok', components: [{ componentId: 'x', required: true, accessibleName: 'Hi' }] },
      { screenId: 'canvas', components: [] },
    ],
    actual: [
      { screenId: 'ok', elements: [{ testId: 'x', text: 'Hi' }] }, // clean, fully evaluable
      { screenId: 'canvas', unstructured: true },
    ],
    identityOf: (s) => s.screenId,
  }, { judge });

  assert.deepEqual(seen, ['canvas']); // judge invoked ONLY for the residual screen, not 'ok'
  assert.equal(r.aiInvoked, true);
  assert.deepEqual(r.residualProcessed, ['canvas']);
  const ai = r.findings.filter((f) => f.source === 'ai');
  assert.equal(ai.length, 1);
  assert.equal(ai[0].layer, 'ai-residual');
  assert.equal(r.findings.length, 1); // 'ok' was clean deterministically; only the AI finding remains
});

test('deterministic independence: evaluateStory WITHOUT a judge == pure runScreens (0 AI)', async () => {
  const input = {
    expected: [{ screenId: 'ok', components: [{ componentId: 'x', required: true, accessibleName: 'Hi' }] }],
    actual: [{ screenId: 'ok', elements: [{ testId: 'x', text: 'hi' }] }], // casing → minor
  };
  const r = await evaluateStory(visual, input, {}); // no transport
  assert.equal(r.aiInvoked, false);
  assert.equal(r.findings.length, 1); // L5 casing minor
  assert.equal(r.findings[0].source, 'deterministic');
  assert.equal(r.residual.length, 0);
});
