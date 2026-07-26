/**
 * VT3-S3 — deterministic style normalization.
 *   npm run build -w @qa/shared && node --test packages/shared/normalize.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseColor, colorDeltaE, normalizeLength, normalizeFontFamily } from './dist/index.js';

test('parseColor: hex (3/6/8), rgb/rgba, named, invalid', () => {
  assert.deepEqual(parseColor('#fff'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseColor('#000000'), { r: 0, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseColor('#ff000080'), { r: 255, g: 0, b: 0, a: 128 / 255 });
  assert.deepEqual(parseColor('rgb(1,2,3)'), { r: 1, g: 2, b: 3, a: 1 });
  assert.deepEqual(parseColor('rgba(1, 2, 3, 0.5)'), { r: 1, g: 2, b: 3, a: 0.5 });
  assert.deepEqual(parseColor('white'), { r: 255, g: 255, b: 255, a: 1 });
  assert.equal(parseColor('not-a-color'), null);
  assert.equal(parseColor(''), null);
});

test('colorDeltaE: identical = 0; black↔white large; unparseable = null', () => {
  assert.equal(colorDeltaE('#123456', '#123456'), 0);
  assert.ok(colorDeltaE('#000', '#fff') > 95, 'black vs white ~100 ΔE');
  assert.ok(colorDeltaE('#ff0000', '#fe0000') < 2.3, 'near-identical reds are sub-JND');
  assert.equal(colorDeltaE('x', '#000'), null);
});

test('normalizeLength: px/rem/em/pt/unitless → px; invalid → null', () => {
  assert.equal(normalizeLength('16px'), 16);
  assert.equal(normalizeLength('1rem'), 16);
  assert.equal(normalizeLength('2rem', 10), 20);
  assert.equal(normalizeLength('1.5em'), 24);
  assert.equal(normalizeLength('12pt'), 16);
  assert.equal(normalizeLength('8'), 8);
  assert.equal(normalizeLength('auto'), null);
  assert.equal(normalizeLength(null), null);
});

test('normalizeFontFamily: first family, unquoted, lowercased', () => {
  assert.equal(normalizeFontFamily('"Helvetica Neue", Arial, sans-serif'), 'helvetica neue');
  assert.equal(normalizeFontFamily("'Roboto'"), 'roboto');
  assert.equal(normalizeFontFamily(''), '');
});
