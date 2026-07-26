'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const CLI = path.join(__dirname, 'qa-cli.js');
function run(inputObj) {
  const out = execFileSync(process.execPath, [CLI, 'visual-compare'], { input: JSON.stringify(inputObj), encoding: 'utf8' });
  return JSON.parse(out);
}

test('visual-compare {expected,actual} → deterministic findings + health (0 AI)', () => {
  const r = run({
    expected: [{ screenId: 's', texts: [{ subject: 'title', text: 'Card Perks' }] }],
    actual: [{ screenId: 's', texts: [{ subject: 'title', text: 'Card perks' }] }],
  });
  assert.equal(r.aiInvoked, false);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].severity, 'minor');
  assert.equal(r.health.score, 97);
});

test('visual-compare {figmaFrames,dumps} → providers → L1 pair → L2+L5', () => {
  const r = run({
    figmaFrames: [{ screenId: 's', components: [{ componentId: 'delete', required: true }], textNodes: [{ name: 'cta', characters: 'Save' }] }],
    dumps: [{ screenId: 's', elements: [{ testId: 'cta', text: 'Submit' }] }],
  });
  // L2 missing "delete" (major) + L5 Save→Submit (major)
  assert.equal(r.findings.length, 2);
  assert.equal(r.screens[0].verdict, 'major');
  assert.ok(r.findings.some((f) => f.layer === 'component-tree'));
  assert.ok(r.findings.some((f) => f.layer === 'text'));
});

test('visual-compare reports a coverage gap for an unpaired expected screen', () => {
  const r = run({ expected: [{ screenId: 'orphan', texts: [{ subject: 'x', text: 'Hi' }] }], actual: [] });
  assert.equal(r.coverageGaps, 1);
  assert.equal(r.screens[0].verdict, 'coverage-gap');
});

test('visual-compare {rawDumps} parses live Appium XML → L2/L5 findings', () => {
  const r = run({
    figmaFrames: [{ screenId: 'perk', components: [{ componentId: 'cta', required: true }], textNodes: [{ name: 'title', characters: 'Card Perks' }] }],
    rawDumps: [{ screenId: 'perk', raw: '<android.widget.TextView resource-id="title" text="Card perks" bounds="[0,0][100,20]" />' }],
  });
  // "cta" required but absent from the parsed dump → L2 major; "title" casing → L5 minor
  assert.equal(r.findings.length, 2);
  assert.ok(r.findings.some((f) => f.layer === 'component-tree' && f.severity === 'major'));
  assert.ok(r.findings.some((f) => f.layer === 'text' && f.severity === 'minor'));
});
