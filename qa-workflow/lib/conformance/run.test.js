'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runScreens, verdictOf } = require('./run');
const visual = require('../../capabilities/visual/capability');

test('verdictOf: major > minor > pass; coverage-gap findings ignored', () => {
  assert.equal(verdictOf([{ severity: 'major' }]), 'major');
  assert.equal(verdictOf([{ severity: 'minor' }, { severity: 'info' }]), 'minor');
  assert.equal(verdictOf([]), 'pass');
  assert.equal(verdictOf([{ severity: 'critical', coverageGap: true }]), 'pass'); // gap doesn't set verdict
});

test('runScreens: identity pairing runs the pipeline; unpaired expected → coverage gap', () => {
  const expected = [
    { screenId: 'perk-details', texts: [{ subject: 'title', text: 'Card Perks' }] },
    { screenId: 'orphan', texts: [{ subject: 'x', text: 'Hello' }] },
  ];
  const actual = [
    { screenId: 'perk-details', texts: [{ subject: 'title', text: 'Card perks' }] }, // casing → minor
  ];
  const r = runScreens(visual, { expected, actual });

  assert.equal(r.aiInvoked, false); // deterministic-first
  assert.equal(r.findings.filter((f) => !f.coverageGap).length, 1); // one real minor
  assert.equal(r.coverageGaps, 1);
  assert.equal(r.health.score, 97); // only the minor(3) penalizes; the gap does not
  assert.equal(r.screens.find((s) => s.screen === 'perk-details').verdict, 'minor');
  const gap = r.screens.find((s) => s.verdict === 'coverage-gap');
  assert.equal(gap.screen, 'orphan');
});

test('runScreens: heuristic pairs when identity is absent but names overlap', () => {
  const expected = [{ name: 'address list', texts: [{ subject: 't', text: 'Addresses' }] }];
  const actual = [{ name: 'address list screen', texts: [{ subject: 't', text: 'Addresses' }] }];
  const r = runScreens(visual, { expected, actual });
  assert.equal(r.coverageGaps, 0);
  assert.equal(r.screens[0].method, 'heuristic');
});

test('runScreens: unrelated screens ABSTAIN rather than force-pair', () => {
  const expected = [{ screenId: 'checkout', texts: [{ subject: 't', text: 'Pay' }] }];
  const actual = [{ screenId: 'profile', texts: [{ subject: 't', text: 'Name' }] }];
  const r = runScreens(visual, { expected, actual });
  assert.equal(r.coverageGaps, 1);
  assert.equal(r.findings.filter((f) => !f.coverageGap).length, 0); // no forced comparison
});

test('runScreens: residual worklist — paired-but-unevaluable screens flagged for the LLM', () => {
  const r = runScreens(visual, {
    expected: [
      { screenId: 'has-model', texts: [{ subject: 't', text: 'Hi' }] }, // fully evaluable → NOT residual
      { screenId: 'empty', components: [], texts: [] },                  // paired, no model → residual
      { screenId: 'canvas', texts: [{ subject: 't', text: 'X' }] },      // marked unstructured → residual
    ],
    actual: [
      { screenId: 'has-model', texts: [{ subject: 't', text: 'Hi' }] },
      { screenId: 'empty' },
      { screenId: 'canvas', unstructured: true, texts: [{ subject: 't', text: 'X' }] },
    ],
  });
  const reasons = Object.fromEntries(r.residual.map((x) => [x.screen, x.reason]));
  assert.equal(r.residual.length, 2);
  assert.equal(reasons.empty, 'no-expected-model');
  assert.equal(reasons.canvas, 'unstructured-surface');
  assert.ok(!('has-model' in reasons)); // fully evaluated → not residual
});
