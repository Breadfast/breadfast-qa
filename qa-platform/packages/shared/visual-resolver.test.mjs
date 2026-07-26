/**
 * VT1-S1 — unified frame↔screenshot resolver.
 *   npm run build -w @qa/shared && node --test packages/shared/visual-resolver.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePair, pairConfidence, DEFAULT_MATCH_FLOOR } from './dist/index.js';

test('registry-first: deterministic screenId match wins (confidence 1)', () => {
  const frame = { name: 'unrelated name', screenId: 'checkout' };
  const shots = [{ path: '/s/1_home.png' }, { path: '/s/2_x.png', screenId: 'checkout' }];
  const r = resolvePair(frame, shots);
  assert.equal(r.method, 'registry');
  assert.equal(r.confidence, 1);
  assert.equal(r.shot.path, '/s/2_x.png');
  assert.equal(r.coverageGap, false);
});

test('heuristic: best token overlap above the floor is chosen', () => {
  const frame = { name: 'Address list', file: '/f/address-list.png' };
  const shots = [{ path: '/s/1_home.png' }, { path: '/s/2_address_list.png' }, { path: '/s/3_cart.png' }];
  const r = resolvePair(frame, shots);
  assert.equal(r.method, 'heuristic');
  assert.equal(r.shot.path, '/s/2_address_list.png');
  assert.ok(r.confidence >= DEFAULT_MATCH_FLOOR);
});

test('abstain: below the floor → coverage gap, no forced pair', () => {
  const frame = { name: 'Address list confirmation modal' };
  const shots = [{ path: '/s/1_home.png' }, { path: '/s/2_cart.png' }];
  const r = resolvePair(frame, shots);
  assert.equal(r.shot, null);
  assert.equal(r.coverageGap, true);
  assert.equal(r.method, 'none');
});

test('abstain: empty shots → coverage gap', () => {
  const r = resolvePair({ name: 'anything' }, []);
  assert.equal(r.shot, null);
  assert.equal(r.coverageGap, true);
});

test('floor is configurable — a low floor accepts a weak match', () => {
  const frame = { name: 'Address list confirmation modal' };
  const shots = [{ path: '/s/2_address.png' }]; // shares only "address"
  assert.equal(resolvePair(frame, shots).coverageGap, true);            // default floor abstains
  const r = resolvePair(frame, shots, { floor: 0.1 });
  assert.equal(r.coverageGap, false);                                   // low floor accepts
  assert.equal(r.method, 'heuristic');
});

test('deterministic: same inputs → same output; ties resolve to the first shot', () => {
  const frame = { name: 'Cart page', file: '/f/cart.png' };
  const shots = [{ path: '/s/cart_a.png' }, { path: '/s/cart_b.png' }]; // both share "cart"
  const a = resolvePair(frame, shots);
  const b = resolvePair(frame, shots);
  assert.deepEqual(a, b);
  assert.equal(a.shot.path, '/s/cart_a.png'); // first wins on tie
});

test('pairConfidence: fraction of frame tokens found in the shot basename', () => {
  assert.equal(pairConfidence('Address list', '/x/address_list.png'), 1);
  assert.equal(pairConfidence('Address list', '/x/address.png'), 0.5);
  assert.equal(pairConfidence('Address list', '/x/home.png'), 0);
  assert.equal(pairConfidence('', '/x/home.png'), 0); // empty frame name → 0, never NaN
});
