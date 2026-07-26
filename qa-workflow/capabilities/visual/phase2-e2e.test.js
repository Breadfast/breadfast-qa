'use strict';
// PHASE 2 — end-to-end validation of the completed deterministic engine (ADR-003).
// Real Screen Registry + raw Appium XML + real PixelComparator adapter + L1–L7,
// asserting the residual worklist contains ONLY genuinely AI-requiring screens.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runScreens } = require('../../lib/conformance');
const visual = require('./capability');
const { loadScreenRegistry } = require('./registry');
const { expectedScreensFromRegistry } = require('./expected/build');
const { dumpActualProvider } = require('./actual/dump');
const { pngPixelComparator, encodePng } = require('./actual/pixel-adapter');

function solid(w, h, [r, g, b, a]) {
  const buf = Buffer.alloc(w * h * 4);
  for (let i = 0; i < buf.length; i += 4) { buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a; }
  return buf;
}

test('mobile flow: real registry + raw Appium XML + real pixel diff → deterministic L2/L3/L5/L7', async () => {
  // Expected: the real curated perk-details screen (iOS) from docs/ai/screens.
  const expected = expectedScreensFromRegistry(loadScreenRegistry(), { platforms: ['ios'] })
    .filter((s) => s.screenId === 'perk-details');
  assert.equal(expected.length, 1);

  // Actual: raw Appium XML — title mis-cased, redeem button invisible (0-width),
  // terms link ABSENT (required), plus a dynamic merchant name (not in the model).
  const xml = [
    '<hierarchy>',
    '  <android.widget.TextView resource-id="perk-title" text="card perks" bounds="[0,0][200,24]"/>',
    '  <android.widget.Button resource-id="perk-redeem-button" content-desc="Redeem" bounds="[0,40][0,80]"/>',
    '  <android.widget.TextView resource-id="merchant-name" text="Starbucks" bounds="[0,100][200,120]"/>',
    '</hierarchy>',
  ].join('\n');
  const actual = dumpActualProvider.captureRaw([{ screenId: 'perk-details', platform: 'ios', raw: xml }]);

  // Real pixel advisory: 10×10, flip 10 of 100 px → 10% diff, via the real adapter.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-'));
  const base = solid(10, 10, [0, 0, 0, 255]);
  const changed = Buffer.from(base);
  for (let p = 0; p < 10; p++) { changed[p * 4] = 255; changed[p * 4 + 1] = 255; changed[p * 4 + 2] = 255; }
  fs.writeFileSync(path.join(dir, 'design.png'), encodePng(10, 10, base));
  fs.writeFileSync(path.join(dir, 'actual.png'), encodePng(10, 10, changed));
  actual[0].pixelDiff = await pngPixelComparator.compare(path.join(dir, 'design.png'), path.join(dir, 'actual.png'));
  assert.equal(actual[0].pixelDiff.diffRatio, 0.1);

  const r = runScreens(visual, { expected, actual });

  assert.equal(r.aiInvoked, false); // fully deterministic
  const byDim = r.findings.map((f) => `${f.layer}/${f.dimension}=${f.severity}`).sort();
  assert.deepEqual(byDim, [
    'component-tree/missing-component=major', // perk-terms-link absent (required)
    'pixel/pixel-diff=info',                  // 10% advisory (real adapter)
    'text/sentence-case=minor',               // "Card Perks" vs "card perks"
    'visibility/component-visibility=major',  // redeem button 0-area
  ]);
  assert.equal(r.screens[0].verdict, 'major');
  assert.equal(r.health.score, 77); // 100 - 10 - 10 - 3 (info = 0)

  // The dynamic "merchant-name" was NOT flagged, and the screen is fully evaluable →
  // it needs NO AI. Residual worklist is empty.
  assert.deepEqual(r.residual, []);
});

test('web flow: structured dump with bounds+styles → deterministic L4 + L6', () => {
  const expected = [{
    screenId: 'card',
    components: [{ componentId: 'cta', required: true, accessibleName: 'Save', bounds: { x: 0, y: 0, width: 80, height: 40 }, styles: { color: '#0000ff', 'font-size': '16px' } }],
    tolerances: { px: 3, colorDeltaE: 2.5, fontPx: 1 },
    enabledLayers: ['component-tree', 'visibility', 'layout', 'text', 'styles'],
  }];
  const actual = [{ screenId: 'card', elements: [{ testId: 'cta', text: 'Save', bounds: { x: 20, y: 0, width: 80, height: 40 }, styles: { color: '#ff0000', 'font-size': '20px' } }] }];
  const r = runScreens(visual, { expected, actual });
  assert.equal(r.aiInvoked, false);
  const layers = r.findings.map((f) => `${f.layer}/${f.dimension}`).sort();
  assert.deepEqual(layers, ['layout/position', 'styles/color', 'styles/font-size']); // L4 offset + L6 color + L6 font-size
  assert.ok(r.findings.every((f) => f.severity === 'major'));
  assert.deepEqual(r.residual, []); // fully evaluable
});

test('residual worklist contains ONLY genuinely AI-requiring screens', () => {
  const r = runScreens(visual, {
    expected: [
      { screenId: 'structured', components: [{ componentId: 'x', required: true, accessibleName: 'Hi' }] },
      { screenId: 'canvas', components: [] }, // no expected model
    ],
    actual: [
      { screenId: 'structured', elements: [{ testId: 'x', text: 'Hi' }] }, // fully evaluable, clean
      { screenId: 'canvas', unstructured: true },
    ],
  });
  assert.equal(r.aiInvoked, false);
  assert.equal(r.findings.filter((f) => !f.coverageGap).length, 0); // structured screen is clean
  assert.equal(r.residual.length, 1);
  assert.equal(r.residual[0].screen, 'canvas'); // ONLY the unstructured/no-model screen needs AI
});
