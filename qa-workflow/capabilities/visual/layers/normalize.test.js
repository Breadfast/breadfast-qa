'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { colorDeltaE, normalizeLength, normalizeFontFamily, parseColor } = require('./normalize');

test('colorDeltaE: identical = 0; black↔white large; named = hex', () => {
  assert.equal(colorDeltaE('#000000', '#000000'), 0);
  assert.ok(colorDeltaE('#000000', '#ffffff') > 50);
  assert.equal(colorDeltaE('red', '#ff0000'), 0); // named resolves to hex
  assert.equal(colorDeltaE('not-a-color', '#000'), null);
});

test('parseColor handles #hex (3/6/8) and rgb/rgba', () => {
  assert.deepEqual(parseColor('#000'), { r: 0, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseColor('rgb(255, 0, 0)'), { r: 255, g: 0, b: 0, a: 1 });
  assert.equal(parseColor('rgba(0,0,0,0.5)').a, 0.5);
});

test('normalizeLength: px/rem/em/pt → px; unparseable → null', () => {
  assert.equal(normalizeLength('16px'), 16);
  assert.equal(normalizeLength('1rem'), 16);
  assert.equal(normalizeLength('2em'), 32);
  assert.equal(normalizeLength('12pt'), 16);
  assert.equal(normalizeLength('auto'), null);
});

test('normalizeFontFamily: first family, unquoted, lowercased', () => {
  assert.equal(normalizeFontFamily('"Helvetica Neue", Arial'), 'helvetica neue');
  assert.equal(normalizeFontFamily("'Inter'"), 'inter');
  assert.equal(normalizeFontFamily(''), '');
});
