'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { figmaNodesToStructuredDump, structuredDumpToExpectedComponents } = require('./figma-extract');

const FRAME = {
  id: '1:1', name: 'Perk Details', type: 'FRAME',
  absoluteBoundingBox: { x: 100, y: 200, width: 375, height: 800 },
  children: [
    {
      id: '1:2', name: 'Title', type: 'TEXT', characters: 'Card Perks',
      absoluteBoundingBox: { x: 120, y: 220, width: 200, height: 24 },
      style: { fontFamily: 'Inter', fontSize: 20 },
      fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }],
    },
    { id: '1:3', name: 'Icon', type: 'RECTANGLE', absoluteBoundingBox: { x: 120, y: 260, width: 24, height: 24 } },
    { id: '1:4', name: 'Hidden', type: 'TEXT', characters: 'nope', visible: false },
  ],
};

test('figmaNodesToStructuredDump: frame-relative bounds, raw styles, TEXT text; hidden skipped', () => {
  const dump = figmaNodesToStructuredDump(FRAME, { screenId: 'perk-details', platform: 'ios' });
  assert.equal(dump.source, 'figma');
  assert.equal(dump.screenId, 'perk-details');
  const title = dump.elements.find((e) => e.name === 'Title');
  assert.equal(title.role, 'text');
  assert.equal(title.text, 'Card Perks');
  assert.deepEqual(title.bounds, { x: 20, y: 20, width: 200, height: 24 }); // relative to origin (100,200)
  assert.equal(title.styles.color, '#000000');
  assert.equal(title.styles['font-size'], '20px');
  assert.equal(title.styles['font-family'], 'Inter');
  assert.ok(!dump.elements.some((e) => e.name === 'Hidden')); // visible:false dropped
});

test('structuredDumpToExpectedComponents: only text/component nodes, required=false', () => {
  const comps = structuredDumpToExpectedComponents(figmaNodesToStructuredDump(FRAME));
  assert.equal(comps.length, 1); // Title (text); Icon (shape) + root (group) excluded
  assert.equal(comps[0].componentId, '1:2');
  assert.equal(comps[0].accessibleName, 'Card Perks');
  assert.equal(comps[0].required, false); // auto-derived → never triggers L2 "missing"
  assert.equal(comps[0].styles['font-size'], '20px');
});
