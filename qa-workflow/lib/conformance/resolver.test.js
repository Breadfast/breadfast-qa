'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolvePair, DEFAULT_FLOOR } = require('./resolver');

const byId = (x) => x && x.id;

test('identity match pairs at confidence 1, order-independent, no gaps', () => {
  const { pairs, coverageGaps } = resolvePair(
    [{ id: 'a' }, { id: 'b' }],
    [{ id: 'b' }, { id: 'a' }],
    { identityOf: byId },
  );
  assert.equal(pairs.length, 2);
  assert.equal(coverageGaps.length, 0);
  assert.ok(pairs.every((p) => p.method === 'identity' && p.confidence === 1));
});

test('no identity + heuristic above floor → heuristic pair', () => {
  const { pairs, coverageGaps } = resolvePair(
    [{ name: 'address list' }],
    [{ name: 'address list screen' }],
    { scoreOf: () => 0.8 },
  );
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].method, 'heuristic');
  assert.equal(coverageGaps.length, 0);
});

test('below/at floor → ABSTAIN (coverage gap; never force-pair)', () => {
  const atFloor = resolvePair([{ x: 1 }], [{ y: 1 }], { scoreOf: () => DEFAULT_FLOOR });
  assert.equal(atFloor.pairs.length, 0); // strict '>' floor
  assert.equal(atFloor.coverageGaps.length, 1);

  const below = resolvePair([{ x: 1 }], [{ y: 1 }], { scoreOf: () => 0.1 });
  assert.equal(below.pairs.length, 0);
  assert.equal(below.coverageGaps.length, 1);
});

test('identity beats heuristic; an unmatched identity falls through to abstain', () => {
  const { pairs, coverageGaps } = resolvePair(
    [{ id: 'a' }, { id: 'ghost' }],
    [{ id: 'a' }],
    { identityOf: byId, scoreOf: () => 0.9 },
  );
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].method, 'identity');
  assert.equal(coverageGaps.length, 1); // "ghost" has no actual → gap, not a forced heuristic pair
});
