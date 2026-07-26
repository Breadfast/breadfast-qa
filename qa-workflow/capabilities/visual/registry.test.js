'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadScreenRegistry, profileFor, validateRegistry, DEFAULT_PROFILE } = require('./registry');

test('loadScreenRegistry loads real entries and skips _ files', () => {
  const reg = loadScreenRegistry(); // default dir = docs/ai/screens
  const perk = reg.screens.find((s) => s.id === 'perk-details');
  assert.ok(perk, 'perk-details loaded');
  assert.equal(perk.expectedComponents.length, 4);
  assert.ok(reg.profiles.find((p) => p.id === 'perks-mobile'));
  assert.ok(!reg.screens.find((s) => s.id === 'address-list')); // _example.* is skipped
});

test('profileFor resolves the screen profile, else the built-in default', () => {
  const reg = loadScreenRegistry();
  const perk = reg.screens.find((s) => s.id === 'perk-details');
  assert.equal(profileFor(reg, perk).id, 'perks-mobile');
  assert.equal(profileFor(reg, { id: 'x' }).id, DEFAULT_PROFILE.id);
});

test('normalizeComponents applies required=true default; explicit false preserved', () => {
  const reg = loadScreenRegistry();
  const perk = reg.screens.find((s) => s.id === 'perk-details');
  assert.equal(perk.expectedComponents.find((c) => c.componentId === 'perk-title').required, true);
  assert.equal(perk.expectedComponents.find((c) => c.componentId === 'perk-empty-state').required, false);
});

test('validateRegistry flags duplicate screenId (error)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-'));
  fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify({
    screens: [
      { id: 'x', variants: [{ platform: 'web', locale: 'en-US', figmaNodeId: '1:1' }] },
      { id: 'x', variants: [{ platform: 'web', locale: 'en-US', figmaNodeId: '1:2' }] },
    ],
  }));
  const issues = validateRegistry(loadScreenRegistry(dir));
  assert.ok(issues.some((i) => i.level === 'error' && /Duplicate screenId/.test(i.message)));
});
