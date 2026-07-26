'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { composeJudge, noopJudge } = require('./judge');

test('composeJudge requires a transport', () => {
  assert.throws(() => composeJudge({}), /transport/);
});

test('composeJudge threads render → transport → parse (provider-agnostic)', async () => {
  const seen = {};
  const j = composeJudge({
    render: (item) => ({ prompt: `review ${item.screen}` }),
    transport: async (req) => { seen.prompt = req.prompt; return '[{"severity":"major","category":"x","subject":"s"}]'; },
    parse: (raw) => JSON.parse(raw),
  });
  const out = await j({ screen: 'canvas', reason: 'unstructured-surface' });
  assert.equal(seen.prompt, 'review canvas'); // render fed the transport
  assert.equal(out.length, 1);
  assert.equal(out[0].severity, 'major');
});

test('noopJudge contributes nothing', async () => {
  assert.deepEqual(await noopJudge({}), []);
});
