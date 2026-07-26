'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScreenRegistry } = require('../registry');
const { expectedScreensFromRegistry } = require('./build');

test('expectedScreensFromRegistry: curated components + profile tolerances/layers per variant', () => {
  const screens = expectedScreensFromRegistry(loadScreenRegistry(), { platforms: ['ios'] });
  const perk = screens.find((s) => s.screenId === 'perk-details' && s.platform === 'ios');
  assert.ok(perk);
  assert.equal(perk.components.length, 4);
  assert.equal(perk.tolerances.px, 3); // from the perks-mobile profile
  assert.ok(perk.enabledLayers.includes('styles'));
  assert.equal(screens.filter((s) => s.screenId === 'perk-details').length, 1); // ios only (platform filter)
});

test('uncurated screen falls back to Figma-extracted components (required:false)', () => {
  const registry = { profiles: [], screens: [{ id: 's', variants: [{ platform: 'web', locale: 'en-US', figmaNodeId: 'N1' }] }] };
  const figmaByNode = {
    N1: {
      id: 'N1', type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
      children: [{ id: 't', name: 'T', type: 'TEXT', characters: 'Hi', absoluteBoundingBox: { x: 0, y: 0, width: 5, height: 5 } }],
    },
  };
  const screens = expectedScreensFromRegistry(registry, { figmaByNode });
  assert.equal(screens[0].components.length, 1);
  assert.equal(screens[0].components[0].required, false);
  assert.equal(screens[0].components[0].accessibleName, 'Hi');
});
