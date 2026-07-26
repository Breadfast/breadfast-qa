/**
 * Producer #1 — Figma structured extraction (pure transforms).
 *   npm run build -w @qa/shared && node --test packages/shared/figma-extract.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { figmaNodesToStructuredDump, structuredDumpToExpectedComponents, StructuredDump } from './dist/index.js';

const root = {
  id: '1:1', name: 'Checkout', type: 'FRAME', absoluteBoundingBox: { x: 100, y: 200, width: 375, height: 812 },
  children: [
    { id: '1:2', name: 'Title', type: 'TEXT', characters: 'Checkout', absoluteBoundingBox: { x: 116, y: 232, width: 200, height: 30 },
      style: { fontFamily: 'Inter', fontSize: 24, fontWeight: 700, lineHeightPx: 32 }, fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }] },
    { id: '1:3', name: 'Pay Button', type: 'INSTANCE', absoluteBoundingBox: { x: 116, y: 700, width: 343, height: 48 },
      fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }], cornerRadius: 8,
      children: [{ id: '1:4', name: 'Label', type: 'TEXT', characters: 'Pay now', absoluteBoundingBox: { x: 200, y: 712, width: 100, height: 20 }, fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }] }] },
    { id: '1:9', name: 'Hidden', type: 'TEXT', characters: 'nope', visible: false },
  ],
};

test('figmaNodesToStructuredDump: source, frame-relative bounds, styles, hidden excluded', () => {
  const d = figmaNodesToStructuredDump(root, { platform: 'web', screenId: 'checkout' });
  StructuredDump.parse(d); // valid against the contract
  assert.equal(d.source, 'figma');
  assert.equal(d.screenId, 'checkout');
  const byId = Object.fromEntries(d.elements.map((e) => [e.id, e]));
  assert.ok(!byId['1:9'], 'hidden node excluded');
  // Title: bounds relative to root origin (116-100, 232-200)
  assert.deepEqual(byId['1:2'].bounds, { x: 16, y: 32, width: 200, height: 30 });
  assert.equal(byId['1:2'].text, 'Checkout');
  assert.deepEqual(byId['1:2'].styles, { color: '#000000', 'font-family': 'Inter', 'font-size': '24px', 'font-weight': '700', 'line-height': '32px' });
  assert.equal(byId['1:3'].role, 'component');
  assert.equal(byId['1:3'].styles.color, '#ff0000');
  assert.equal(byId['1:3'].styles['corner-radius'], '8px');
  assert.equal(byId['1:4'].parentId, '1:3');           // hierarchy captured
  assert.equal(byId['1:4'].bounds.x, 100);             // 200-100
});

test('structuredDumpToExpectedComponents: only text/components, required=false, carries bounds/styles', () => {
  const comps = structuredDumpToExpectedComponents(figmaNodesToStructuredDump(root));
  const ids = comps.map((c) => c.componentId);
  assert.ok(ids.includes('1:2') && ids.includes('1:3') && ids.includes('1:4'));
  assert.ok(!ids.includes('1:1'), 'root FRAME (group, no text) excluded — no L2 missing-spam');
  assert.ok(comps.every((c) => c.required === false), 'auto-derived ⇒ never required');
  const title = comps.find((c) => c.componentId === '1:2');
  assert.equal(title.accessibleName, 'Checkout');
  assert.equal(title.styles['font-size'], '24px');
  const payBtn = comps.find((c) => c.componentId === '1:3');
  assert.equal(payBtn.bounds.width, 343);
});

test('empty/garbage input is safe', () => {
  assert.deepEqual(figmaNodesToStructuredDump({}).elements.length, 1); // just the (empty) root
  assert.deepEqual(structuredDumpToExpectedComponents({ elements: [] }), []);
});
