'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { comparePixel } = require('./pixel');

test('no precomputed diff ⇒ dormant', () => {
  assert.equal(comparePixel({}, {}).length, 0);
  assert.equal(comparePixel({}, { pixelDiff: {} }).length, 0); // no diffRatio
});

test('diff at/below threshold ⇒ nothing; above ⇒ one INFO advisory', () => {
  assert.equal(comparePixel({}, { pixelDiff: { diffRatio: 0.02 } }).length, 0); // == default threshold
  const f = comparePixel({}, { pixelDiff: { diffRatio: 0.1 } }, { screen: 's' });
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'info'); // advisory only, never a blocker
  assert.equal(f[0].dimension, 'pixel-diff');
  assert.match(f[0].actual, /10% pixels differ/);
});

test('threshold and diff source (ctx.pixelDiff) are honored', () => {
  assert.equal(comparePixel({}, {}, { pixelDiff: { diffRatio: 0.05 }, tolerances: { pixelRatio: 0.1 } }).length, 0); // under custom threshold
  assert.equal(comparePixel({}, {}, { pixelDiff: { diffRatio: 0.2 }, tolerances: { pixelRatio: 0.1 } }).length, 1);
});
