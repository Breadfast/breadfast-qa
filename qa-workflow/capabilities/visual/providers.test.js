'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { figmaExpectedProvider } = require('./expected/figma');
const { dumpActualProvider } = require('./actual/dump');
const { runScreens } = require('../../lib/conformance');
const visual = require('./capability');

test('figmaExpectedProvider shapes exported frames into expected screens', () => {
  const screens = figmaExpectedProvider.load([
    { screenId: 'perk-details', textNodes: [{ name: 'title', characters: 'Card Perks' }, { name: 'cta', characters: 'Save' }] },
  ]);
  assert.equal(screens.length, 1);
  assert.deepEqual(screens[0].texts, [{ subject: 'title', text: 'Card Perks' }, { subject: 'cta', text: 'Save' }]);
});

test('dumpActualProvider projects a structured dump into actual screens (skips empty text)', () => {
  const screens = dumpActualProvider.capture([
    { screenId: 'perk-details', elements: [{ testId: 'title', text: 'Card perks' }, { role: 'button', text: '' }] },
  ]);
  assert.deepEqual(screens[0].texts, [{ subject: 'title', text: 'Card perks' }]); // empty button text skipped
});

test('end-to-end: Figma → dump → L1 pair → L5 compare, deterministic-first (0 AI)', () => {
  const expected = figmaExpectedProvider.load([
    { screenId: 'perk-details', textNodes: [
      { name: 'title', characters: 'Card Perks' }, // vs 'Card perks' → minor (casing)
      { name: 'cta', characters: 'Save' },         // vs 'Submit'     → major
      { name: 'helper', characters: 'Enter code' },// matches         → none
    ] },
  ]);
  const actual = dumpActualProvider.capture([
    { screenId: 'perk-details', elements: [
      { testId: 'title', text: 'Card perks' },
      { testId: 'cta', text: 'Submit' },
      { testId: 'helper', text: 'Enter code' },
    ] },
  ]);

  const r = runScreens(visual, { expected, actual, ctx: { platform: 'ios', locale: 'en-US' } });
  assert.equal(r.aiInvoked, false);
  assert.equal(r.coverageGaps, 0);
  assert.equal(r.findings.length, 2); // minor + major; matched copy yields nothing
  assert.equal(r.health.bySeverity.minor, 1);
  assert.equal(r.health.bySeverity.major, 1);
  assert.equal(r.health.score, 87); // 100 - 3 - 10
  assert.equal(r.screens[0].verdict, 'major');
  assert.ok(r.findings.every((f) => f.capability === 'visual' && f.layer === 'text'));
});
