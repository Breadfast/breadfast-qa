'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { compareText } = require('./text');
const { runPipeline } = require('../../../lib/conformance');
const visual = require('../capability');

const T = (subject, text) => ({ subject, text });

test('exact match (after NFC + whitespace normalize) ⇒ no finding', () => {
  assert.equal(compareText([T('title', 'Card Perks')], [T('title', 'Card Perks')]).length, 0);
  assert.equal(compareText([T('t', 'Hello  World')], [T('t', 'Hello World')]).length, 0); // whitespace collapse
});

test('pure casing / whitespace / punctuation-spacing ⇒ MINOR (sentence-case)', () => {
  const cases = [
    ['Card Perks', 'Card perks'],
    ['ID*', 'ID *'],
    ['Insert Arabic Text Here', 'Insert Arabic text here'],
  ];
  for (const [exp, act] of cases) {
    const f = compareText([T('x', exp)], [T('x', act)]);
    assert.equal(f.length, 1, `${exp} vs ${act}`);
    assert.equal(f[0].severity, 'minor');
    assert.equal(f[0].dimension, 'sentence-case');
  }
});

test('word / number / localized change ⇒ MAJOR (copy)', () => {
  assert.equal(compareText([T('b', 'Save')], [T('b', 'Submit')])[0].severity, 'major');
  assert.equal(compareText([T('n', 'Total: 5')], [T('n', 'Total: 6')])[0].severity, 'major'); // number change
  assert.equal(compareText([T('ar', 'إنشاء حساب')], [T('ar', 'تسجيل الدخول')])[0].severity, 'major');
});

test('missing / empty required copy ⇒ MAJOR', () => {
  assert.equal(compareText([T('h', 'Helper')], [])[0].severity, 'major'); // subject absent
  assert.equal(compareText([T('h', 'Helper')], [T('h', '')])[0].severity, 'major'); // present but empty
});

test('component model: matched accessibleName vs actual element text/name', () => {
  const expected = { components: [{ componentId: 'title', accessibleName: 'Card Perks' }] };
  const casing = compareText(expected, { elements: [{ testId: 'title', text: 'Card perks' }] });
  assert.equal(casing.length, 1);
  assert.equal(casing[0].severity, 'minor');
  assert.equal(compareText(expected, { elements: [{ testId: 'title', text: 'Card Perks' }] }).length, 0); // exact
  // Unmatched component → L5 skips it (L2 owns "missing"); no double-report.
  const unmatched = compareText(
    { components: [{ componentId: 'title', accessibleName: 'Card Perks', required: true }] },
    { elements: [{ testId: 'other', text: 'x' }] },
  );
  assert.equal(unmatched.length, 0);
});

test('end-to-end: L5 runs through the pipeline deterministic-first (0 AI)', () => {
  const expected = { texts: [T('title', 'Card Perks'), T('cta', 'Save'), T('helper', 'Enter code')] };
  const actual = { texts: [T('title', 'Card perks'), T('cta', 'Submit'), T('helper', 'Enter code')] };
  const r = runPipeline(visual, { expected, actual, ctx: { screen: 'perk-details' } });

  assert.equal(r.aiInvoked, false); // deterministic-first: nothing flagged needsResidual
  assert.ok(r.stagesRun.includes('l5'));
  assert.ok(r.pending.includes('l1')); // other deterministic layers declared but not yet wired
  assert.equal(r.pending.includes('l8'), false); // AI skipped ⇒ residual stage never visited (not "pending")
  // one minor (casing) + one major (Save→Submit); "Enter code" matches → no finding
  assert.equal(r.findings.length, 2);
  assert.equal(r.health.bySeverity.minor, 1);
  assert.equal(r.health.bySeverity.major, 1);
  assert.equal(r.health.score, 100 - 3 - 10); // 87
  assert.ok(r.findings.every((f) => f.capability === 'visual' && f.layer === 'text' && f.source === 'deterministic'));
});
