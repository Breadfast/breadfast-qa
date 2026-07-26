'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeClaudeJudge, renderVisualReview, parseFindings } = require('./claude-judge');
const { evaluateStory } = require('../../lib/conformance');
const visual = require('./capability');

test('renderVisualReview references the artifacts, Read, the reason, and prior findings', () => {
  const req = renderVisualReview({
    screen: 'canvas', reason: 'unstructured-surface',
    expected: { framePath: 'frame.png' }, actual: { screenshotPath: 'shot.png' },
    deterministicFindings: [{ dimension: 'x' }],
  });
  assert.match(req.prompt, /READ this image: frame\.png/);
  assert.match(req.prompt, /READ this image: shot\.png/);
  assert.match(req.prompt, /unstructured-surface/);
  assert.match(req.prompt, /do NOT repeat/);
  assert.deepEqual(req.allowedTools, ['Read']);
});

test('parseFindings extracts a JSON array from noisy CLI output', () => {
  assert.deepEqual(parseFindings('Here:\n```json\n[{"severity":"minor"}]\n```\ndone'), [{ severity: 'minor' }]);
  assert.deepEqual(parseFindings('no json here'), []);
  assert.deepEqual(parseFindings('[]'), []);
});

test('makeClaudeJudge with an injected transport returns parsed findings (no real CLI call)', async () => {
  const judge = makeClaudeJudge({ transport: async () => '[{"severity":"major","category":"layout","subject":"canvas","description":"overlap"}]' });
  const out = await judge({ screen: 'canvas', reason: 'unstructured-surface' });
  assert.equal(out.length, 1);
  assert.equal(out[0].description, 'overlap');
});

test('end-to-end: evaluateStory + ClaudeJudge → AI finding ONLY on the residual screen', async () => {
  let calls = 0;
  const judge = makeClaudeJudge({
    transport: async () => { calls++; return '[{"severity":"major","category":"components","subject":"canvas","description":"AI-only"}]'; },
  });
  const r = await evaluateStory(visual, {
    expected: [
      { screenId: 'ok', components: [{ componentId: 'x', required: true, accessibleName: 'Hi' }] },
      { screenId: 'canvas', components: [] },
    ],
    actual: [
      { screenId: 'ok', elements: [{ testId: 'x', text: 'Hi' }] }, // clean, evaluable
      { screenId: 'canvas', unstructured: true },
    ],
    identityOf: (s) => s.screenId,
  }, { judge });

  assert.equal(calls, 1); // transport invoked once — only for the residual 'canvas'
  const ai = r.findings.filter((f) => f.source === 'ai');
  assert.equal(ai.length, 1);
  assert.equal(ai[0].layer, 'ai-residual');
  assert.equal(ai[0].capability, 'visual');
});
