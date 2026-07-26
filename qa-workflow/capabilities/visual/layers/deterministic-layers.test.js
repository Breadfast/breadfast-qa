'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { compareVisibility } = require('./visibility');
const { compareLayout } = require('./layout');
const { compareStyles } = require('./styles');
const { runPipeline } = require('../../../lib/conformance');
const visual = require('../capability');

test('L3 visibility: required + zero-area bounds ⇒ MAJOR; visible ⇒ nothing', () => {
  const bad = compareVisibility(
    { components: [{ componentId: 'badge', required: true }] },
    { elements: [{ testId: 'badge', bounds: { x: 0, y: 0, width: 0, height: 10 } }] },
  );
  assert.equal(bad.length, 1);
  assert.equal(bad[0].severity, 'major');
  assert.equal(bad[0].dimension, 'component-visibility');

  const ok = compareVisibility(
    { components: [{ componentId: 'badge', required: true }] },
    { elements: [{ testId: 'badge', bounds: { x: 0, y: 0, width: 10, height: 10 } }] },
  );
  assert.equal(ok.length, 0);
});

test('L4 layout: severity scales with magnitude (ratio ≥3 major, >1 minor)', () => {
  const exp = { components: [{ componentId: 'c', bounds: { x: 0, y: 0, width: 50, height: 50 } }] };
  const major = compareLayout(exp, { elements: [{ testId: 'c', bounds: { x: 20, y: 0, width: 50, height: 50 } }] }); // delta 20, tol 4 → ratio 5
  assert.equal(major[0].severity, 'major');
  const minor = compareLayout(exp, { elements: [{ testId: 'c', bounds: { x: 6, y: 0, width: 50, height: 50 } }] }); // delta 6, tol 4 → ratio 1.5
  assert.equal(minor[0].severity, 'minor');
  const within = compareLayout(exp, { elements: [{ testId: 'c', bounds: { x: 2, y: 0, width: 50, height: 50 } }] }); // within tol
  assert.equal(within.length, 0);
});

test('L6 styles: color ΔE + font-family + length, with the token as root cause', () => {
  const color = compareStyles(
    { components: [{ componentId: 'b', styles: { color: '#000000' } }] },
    { elements: [{ testId: 'b', styles: { color: '#ff0000' } }] },
  );
  assert.equal(color.length, 1);
  assert.equal(color[0].severity, 'major'); // black↔red is a large ΔE
  assert.equal(color[0].extension.token.kind, 'color');

  const font = compareStyles(
    { components: [{ componentId: 'b', styles: { 'font-family': 'Inter' } }] },
    { elements: [{ testId: 'b', styles: { 'font-family': 'Arial' } }] },
  );
  assert.equal(font[0].dimension, 'font-family');
  assert.equal(font[0].severity, 'minor');

  const equalFont = compareStyles(
    { components: [{ componentId: 'b', styles: { 'font-family': '"Inter", sans-serif' } }] },
    { elements: [{ testId: 'b', styles: { 'font-family': 'Inter' } }] },
  );
  assert.equal(equalFont.length, 0); // canonicalized equal
});

test('end-to-end: L2+L3+L4+L5+L6 together through the pipeline, 0 AI', () => {
  const expected = {
    screenId: 's',
    texts: [{ subject: 'title', text: 'Card Perks' }], // L5
    components: [
      { componentId: 'delete', required: true }, // L2 missing (major)
      { componentId: 'title', required: true, bounds: { x: 0, y: 0, width: 100, height: 20 }, styles: { color: '#000000' } }, // L6 color (major)
      { componentId: 'banner', required: true, bounds: { x: 0, y: 0, width: 50, height: 50 } }, // L4 offset (major)
      { componentId: 'badge', required: true }, // L3 invisible (major)
    ],
  };
  const actual = {
    screenId: 's',
    texts: [{ subject: 'title', text: 'Card perks' }], // L5 casing (minor)
    elements: [
      { testId: 'title', bounds: { x: 0, y: 0, width: 100, height: 20 }, styles: { color: '#ff0000' } },
      { testId: 'banner', bounds: { x: 20, y: 20, width: 50, height: 50 } },
      { testId: 'badge', bounds: { x: 5, y: 5, width: 0, height: 10 } },
    ],
  };
  const r = runPipeline(visual, { expected, actual, ctx: { screen: 's' } });

  assert.equal(r.aiInvoked, false);
  assert.deepEqual(r.stagesRun, ['l2', 'l3', 'l4', 'l5', 'l6', 'l7']); // l7 runs but is dormant (no pixel diff)
  assert.deepEqual(r.pending.sort(), ['l1']); // only L1 (identity, done upstream by the resolver) is unwired as a stage
  assert.equal(r.findings.length, 5); // L2 + L3 + L4 + L6 major, L5 minor
  assert.equal(r.health.bySeverity.major, 4);
  assert.equal(r.health.bySeverity.minor, 1);
  assert.equal(r.health.score, 57); // 100 - 4*10 - 3
});
