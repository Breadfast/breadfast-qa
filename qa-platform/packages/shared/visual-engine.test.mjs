/**
 * Visual engine flag resolvers — VT0-S1.
 *   npm run build -w @qa/shared && node --test packages/shared/visual-engine.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveVisualEngine, resolveVisualAbstain } from './dist/index.js';

test('engine: defaults to legacy when nothing is set', () => {
  assert.equal(resolveVisualEngine(), 'legacy');
  assert.equal(resolveVisualEngine(null, null), 'legacy');
  assert.equal(resolveVisualEngine('', '   '), 'legacy');
});

test('engine: accepts shadow/pyramid, case- and space-insensitive', () => {
  assert.equal(resolveVisualEngine('shadow'), 'shadow');
  assert.equal(resolveVisualEngine('PYRAMID'), 'pyramid');
  assert.equal(resolveVisualEngine('  Shadow  '), 'shadow');
});

test('engine: unknown values fall back to legacy (never throws)', () => {
  assert.equal(resolveVisualEngine('nonsense'), 'legacy');
  assert.equal(resolveVisualEngine('legacyish'), 'legacy');
});

test('engine: Settings value wins over env; empty Settings falls through to env', () => {
  assert.equal(resolveVisualEngine('pyramid', 'shadow'), 'pyramid'); // setting wins
  assert.equal(resolveVisualEngine('', 'shadow'), 'shadow');         // empty setting → env
  assert.equal(resolveVisualEngine('   ', 'pyramid'), 'pyramid');    // whitespace → env
});

test('abstain: defaults to false; truthy tokens enable it', () => {
  assert.equal(resolveVisualAbstain(), false);
  assert.equal(resolveVisualAbstain('', ''), false);
  for (const t of ['true', '1', 'on', 'yes', 'TRUE', ' On ']) {
    assert.equal(resolveVisualAbstain(t), true, `token "${t}" should be truthy`);
  }
  for (const f of ['false', '0', 'off', 'no', 'maybe']) {
    assert.equal(resolveVisualAbstain(f), false, `token "${f}" should be falsy`);
  }
});

test('abstain: Settings value wins over env; empty falls through', () => {
  assert.equal(resolveVisualAbstain('false', 'true'), false); // setting wins
  assert.equal(resolveVisualAbstain('', 'true'), true);       // empty setting → env
});
