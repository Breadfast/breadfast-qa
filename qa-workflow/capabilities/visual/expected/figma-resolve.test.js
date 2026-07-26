'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fileKeyFromUrl, enrichRegistryWithFigma } = require('./figma-resolve');
const { loadScreenRegistry } = require('../registry');

test('fileKeyFromUrl parses /design/ and /file/ Figma URLs', () => {
  assert.equal(fileKeyFromUrl('https://www.figma.com/design/ABC123xyz/Perks?node-id=1-100'), 'ABC123xyz');
  assert.equal(fileKeyFromUrl('https://figma.com/file/KEY9/Name'), 'KEY9');
  assert.equal(fileKeyFromUrl(''), null);
});

test('enrichRegistryWithFigma fills placeholders from the story URL + node map (registry stays stable)', () => {
  const reg = loadScreenRegistry();
  const enriched = enrichRegistryWithFigma(reg, {
    figmaUrl: 'https://www.figma.com/design/LIVEKEY/Perks',
    nodeIdByFrameName: { 'Perks / Details / EN': '10:5' },
  });
  const perk = enriched.screens.find((s) => s.id === 'perk-details');
  assert.equal(perk.variants[0].figmaFileKey, 'LIVEKEY'); // placeholder resolved from the URL
  assert.equal(perk.variants[0].figmaNodeId, '10:5'); // resolved by frame name
  // Pure: the loaded registry is unchanged (still placeholders on disk / in memory).
  assert.equal(loadScreenRegistry().screens.find((s) => s.id === 'perk-details').variants[0].figmaFileKey, 'PLACEHOLDER');
});

test('enrichRegistryWithFigma never overwrites a real (non-placeholder) id', () => {
  const reg = { screens: [{ id: 's', variants: [{ platform: 'web', locale: 'en-US', figmaFileKey: 'REAL', figmaNodeId: '9:9', figmaFrameName: 'F' }] }] };
  const out = enrichRegistryWithFigma(reg, { fileKey: 'NEW', nodeIdByFrameName: { F: '1:1' } });
  assert.equal(out.screens[0].variants[0].figmaFileKey, 'REAL');
  assert.equal(out.screens[0].variants[0].figmaNodeId, '9:9');
});
