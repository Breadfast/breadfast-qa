/**
 * VT3 — StructuredDump contract + OCR adapter.
 *   npm run build -w @qa/shared && node --test packages/shared/structured.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StructuredDump, STRUCTURED_SOURCES, nullOcrAdapter } from './dist/index.js';

test('STRUCTURED_SOURCES exported with expected members', () => {
  for (const s of ['dom', 'a11y', 'page-source', 'ocr', 'mixed']) assert.ok(STRUCTURED_SOURCES.includes(s));
});

test('StructuredDump: minimal parse applies defaults', () => {
  const d = StructuredDump.parse({});
  assert.equal(d.source, 'mixed');
  assert.deepEqual(d.elements, []);
});

test('StructuredDump: elements with bounds/styles/hierarchy validate', () => {
  const d = StructuredDump.parse({
    source: 'a11y', platform: 'web', screenId: 'home',
    elements: [
      { id: 'root', role: 'main' },
      { id: 'btn', parentId: 'root', role: 'button', name: 'Save', testId: 'save-btn',
        bounds: { x: 10, y: 20, width: 100, height: 40 }, styles: { color: '#fff', 'font-size': '16px' } },
    ],
  });
  assert.equal(d.elements.length, 2);
  assert.equal(d.elements[1].testId, 'save-btn');
  assert.equal(d.elements[1].bounds.width, 100);
  assert.throws(() => StructuredDump.parse({ platform: 'desktop' }), 'invalid platform rejected');
});

test('StructuredDump: round-trips', () => {
  const d = StructuredDump.parse({ source: 'dom', elements: [{ role: 'heading', text: 'Hi' }] });
  assert.deepEqual(StructuredDump.parse(JSON.parse(JSON.stringify(d))), d);
});

test('nullOcrAdapter recognizes nothing (safe default)', async () => {
  assert.deepEqual(await nullOcrAdapter.recognize('/x/a.png'), { text: '', confidence: 0 });
});
