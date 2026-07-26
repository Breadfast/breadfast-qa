/**
 * Producer #3 — raw a11y / XML → StructuredDump parsers.
 *   npm run build -w @qa/shared && node --test packages/shared/dump-parse.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlaywrightA11y, parseAppiumXml, parseRawDump, StructuredDump } from './dist/index.js';

test('parsePlaywrightA11y: roles, names, text nodes, hierarchy, refs', () => {
  const snap = [
    '- banner [ref=e1]:',
    '  - heading "Checkout" [level=1] [ref=e2]',
    '- main [ref=e3]:',
    '  - button "Pay now" [ref=e4]',
    '  - textbox "Email" [ref=e5]',
    '  - text: Subtotal $10',
  ].join('\n');
  const d = parsePlaywrightA11y(snap);
  StructuredDump.parse(d);
  assert.equal(d.source, 'a11y');
  const byId = Object.fromEntries(d.elements.map((e) => [e.id, e]));
  assert.equal(byId.e2.role, 'heading');
  assert.equal(byId.e2.name, 'Checkout');
  assert.equal(byId.e2.parentId, 'e1');       // hierarchy from indent
  assert.equal(byId.e4.role, 'button');
  assert.equal(byId.e4.name, 'Pay now');
  assert.equal(byId.e4.parentId, 'e3');
  const textNode = d.elements.find((e) => e.role === 'text');
  assert.equal(textNode.text, 'Subtotal $10');
});

test('parseAppiumXml: Android bounds + resource-id + text', () => {
  const xml = `<?xml version="1.0"?><hierarchy>
    <android.widget.FrameLayout bounds="[0,0][1080,2400]">
      <android.widget.Button resource-id="com.app:id/pay" text="Pay now" content-desc="Pay" bounds="[40,2000][1040,2120]"/>
      <android.widget.TextView resource-id="com.app:id/title" text="Checkout" bounds="[40,100][500,160]"/>
    </android.widget.FrameLayout></hierarchy>`;
  const d = parseAppiumXml(xml);
  StructuredDump.parse(d);
  assert.equal(d.source, 'page-source');
  const pay = d.elements.find((e) => e.testId === 'com.app:id/pay');
  assert.equal(pay.role, 'button');
  assert.equal(pay.text, 'Pay now');
  assert.equal(pay.name, 'Pay'); // content-desc
  assert.deepEqual(pay.bounds, { x: 40, y: 2000, width: 1000, height: 120 });
  const title = d.elements.find((e) => e.testId === 'com.app:id/title');
  assert.ok(title.parentId && title.parentId === pay.parentId, 'title + pay both nested under the FrameLayout container');
});

test('parseAppiumXml: iOS x/y/width/height + name/label', () => {
  const xml = `<XCUIElementTypeButton name="pay-btn" label="Pay now" x="40" y="700" width="300" height="48"/>`;
  const d = parseAppiumXml(xml);
  const btn = d.elements[0];
  assert.equal(btn.role, 'button');
  assert.equal(btn.name, 'Pay now'); // label
  assert.equal(btn.testId, 'pay-btn');
  assert.deepEqual(btn.bounds, { x: 40, y: 700, width: 300, height: 48 });
});

test('parseRawDump: format detection (JSON / XML / a11y / empty)', () => {
  assert.equal(parseRawDump('')?.source, undefined); // null on empty
  assert.equal(parseRawDump('   '), null);
  const json = JSON.stringify({ source: 'dom', elements: [{ role: 'button', name: 'X' }] });
  assert.equal(parseRawDump(json).source, 'dom');   // passthrough
  assert.equal(parseRawDump('<hierarchy><node text="a"/></hierarchy>').source, 'page-source');
  assert.equal(parseRawDump('- button "Go"').source, 'a11y');
  assert.equal(parseRawDump('{ bad json'), null);   // invalid JSON → null
});
