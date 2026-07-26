/**
 * VT4 — Validation Pyramid engine (layers + orchestrator).
 *   npm run build -w @qa/shared && node --test packages/shared/pyramid.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPyramid, layerPixel, ValidationProfile } from './dist/index.js';

const profile = (enabledLayers) => ValidationProfile.parse(enabledLayers ? { id: 'p', enabledLayers } : { id: 'p' });
const dump = (elements) => ({ source: 'a11y', elements });
const run = (expectedComponents, actual, prof = profile(), extra) =>
  runPyramid({ screen: 'S', combo: 'web · en-US', expectedComponents, actual }, prof, extra);
const dims = (sc) => sc.findings.map((f) => f.dimension);

test('L2: missing required component → major finding, verdict major', () => {
  const sc = run([{ componentId: 'save', role: 'button', required: true }], dump([]));
  assert.ok(dims(sc).includes('missing-component'));
  assert.equal(sc.verdict, 'major');
  assert.equal(sc.findings[0].source, 'deterministic');
  assert.equal(sc.findings[0].layer, 'component-tree');
});

test('L2: duplicate beyond maxCardinality → finding', () => {
  const sc = run([{ componentId: 'chip', role: 'chip', required: true, maxCardinality: 1 }],
    dump([{ role: 'chip' }, { role: 'chip' }]));
  assert.ok(dims(sc).includes('duplicate-component'));
});

test('L2: wrong order → ordering finding', () => {
  const sc = run(
    [{ componentId: 'title', role: 'heading', required: true, order: 0 },
     { componentId: 'save', role: 'button', required: true, order: 1 }],
    dump([{ testId: 'save', role: 'button' }, { testId: 'title', role: 'heading' }]));
  assert.ok(dims(sc).includes('ordering'));
});

test('L3: matched required component with zero bounds → visibility finding (not missing)', () => {
  const sc = run([{ componentId: 'btn', role: 'button', required: true }],
    dump([{ testId: 'btn', role: 'button', bounds: { x: 0, y: 0, width: 0, height: 0 } }]));
  assert.ok(dims(sc).includes('component-visibility'));
  assert.ok(!dims(sc).includes('missing-component'), 'present ⇒ not missing');
});

test('L5: text mismatch (matched by testId) → exact-text finding with expected/actual', () => {
  const sc = run([{ componentId: 'btn', role: 'button', accessibleName: 'Save', required: true }],
    dump([{ testId: 'btn', role: 'button', name: 'Submit' }]));
  const f = sc.findings.find((x) => x.dimension === 'exact-text');
  assert.ok(f);
  assert.equal(f.expected, 'Save');
  assert.equal(f.actual, 'Submit');
});

test('L4: bounds beyond tolerance → layout finding', () => {
  const sc = run([{ componentId: 'btn', required: true, bounds: { x: 0, y: 0, width: 100, height: 40 } }],
    dump([{ testId: 'btn', bounds: { x: 0, y: 0, width: 100, height: 60 } }]));
  assert.ok(dims(sc).includes('position'));
});

test('L6: color/size/font mismatches → style findings with token', () => {
  const sc = run([{ componentId: 'btn', required: true, styles: { color: '#ffffff', 'font-size': '16px', 'font-family': 'Arial' } }],
    dump([{ testId: 'btn', styles: { color: '#000000', 'font-size': '24px', 'font-family': 'Roboto' } }]));
  const d = dims(sc);
  assert.ok(d.includes('color') && d.includes('font-size') && d.includes('font-family'));
  const colorF = sc.findings.find((f) => f.dimension === 'color');
  assert.equal(colorF.token.kind, 'color');
});

test('L6: within tolerance → no finding', () => {
  const sc = run([{ componentId: 'btn', required: true, styles: { color: '#ff0000' } }],
    dump([{ testId: 'btn', styles: { color: '#fe0000' } }])); // sub-JND
  assert.equal(sc.findings.length, 0);
  assert.equal(sc.verdict, 'pass');
});

test('L7: pixel advisory only fires above threshold, severity info', () => {
  assert.equal(layerPixel({ diffRatio: 0.01 }, 'S').length, 0);
  const f = layerPixel({ diffRatio: 0.5 }, 'S')[0];
  assert.equal(f.severity, 'info');
  assert.equal(f.layer, 'pixel');
});

test('orchestrator: enabledLayers gates which layers run', () => {
  const exp = [{ componentId: 'btn', role: 'button', accessibleName: 'Save', required: true }];
  const act = dump([{ testId: 'btn', role: 'button', name: 'Submit' }]);
  assert.ok(dims(run(exp, act, profile(['component-tree']))).length === 0, 'text disabled ⇒ no text finding, component matched');
  assert.ok(dims(run(exp, act, profile(['text']))).includes('exact-text'));
});

test('orchestrator: per-component short-circuit — missing component not re-flagged downstream', () => {
  const sc = run([{ componentId: 'btn', role: 'button', accessibleName: 'Save', required: true, bounds: { x: 0, y: 0, width: 10, height: 10 } }], dump([]));
  assert.deepEqual(dims(sc), ['missing-component'], 'only L2 fires for a missing component');
});

test('orchestrator: clean screen ⇒ pass; no data ⇒ no-frame', () => {
  const clean = run([{ componentId: 'btn', role: 'button', required: true }], dump([{ testId: 'btn', role: 'button', bounds: { x: 0, y: 0, width: 10, height: 10 } }]));
  assert.equal(clean.verdict, 'pass');
  assert.ok(clean.categoriesChecked.includes('components'));
  const empty = run([], null);
  assert.equal(empty.verdict, 'no-frame');
  assert.equal(empty.findings.length, 0);
});

// ── VT5-S2 — deterministic magnitude-based severity ──────────────────────────
import { severityForRatio } from './dist/index.js';
test('severityForRatio: ≥3×→major, >1×→minor, else info', () => {
  assert.equal(severityForRatio(0.5), 'info');
  assert.equal(severityForRatio(1), 'info');
  assert.equal(severityForRatio(1.5), 'minor');
  assert.equal(severityForRatio(3), 'major');
  assert.equal(severityForRatio(50), 'major');
});

test('L6: large color delta → major (magnitude-based severity)', () => {
  const sc = run([{ componentId: 'btn', required: true, styles: { color: '#ffffff' } }],
    dump([{ testId: 'btn', styles: { color: '#000000' } }]));
  const f = sc.findings.find((x) => x.dimension === 'color');
  assert.equal(f.severity, 'major'); // ΔE ~100 ÷ tol 2 ⇒ ratio ≫3
});
