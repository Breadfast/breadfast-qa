'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePlaywrightA11y, parseAppiumXml, parseRawDump } = require('./parse');
const { dumpActualProvider } = require('./dump');

test('parsePlaywrightA11y: roles, names, refs, text nodes, hierarchy', () => {
  const dump = parsePlaywrightA11y(['- button "Save" [ref=cta]', '  - text: Save', '- heading "Title"'].join('\n'));
  assert.equal(dump.source, 'a11y');
  const btn = dump.elements.find((e) => e.role === 'button');
  assert.equal(btn.name, 'Save');
  assert.equal(btn.id, 'cta'); // [ref=…] becomes the id
  const txt = dump.elements.find((e) => e.role === 'text');
  assert.equal(txt.text, 'Save');
  assert.equal(txt.parentId, 'cta'); // nested under the button by indent
  assert.equal(dump.elements.find((e) => e.role === 'heading').name, 'Title');
});

test('parseAppiumXml: resource-id → testId, class → short role, bounds', () => {
  const xml = [
    '<hierarchy>',
    '  <android.widget.FrameLayout>',
    '    <android.widget.Button resource-id="cta" content-desc="Save" bounds="[0,0][80,40]" />',
    '    <android.widget.TextView text="Hello" bounds="[0,50][100,70]" />',
    '  </android.widget.FrameLayout>',
    '</hierarchy>',
  ].join('\n');
  const dump = parseAppiumXml(xml);
  assert.equal(dump.source, 'page-source');
  const btn = dump.elements.find((e) => e.testId === 'cta');
  assert.equal(btn.role, 'button');
  assert.equal(btn.name, 'Save');
  assert.deepEqual(btn.bounds, { x: 0, y: 0, width: 80, height: 40 });
  assert.equal(dump.elements.find((e) => e.role === 'textview').text, 'Hello');
});

test('parseAppiumXml: iOS XCUIElementType* → short role', () => {
  const dump = parseAppiumXml('<XCUIElementTypeButton name="ok" label="OK" x="1" y="2" width="10" height="4" />');
  assert.equal(dump.elements[0].role, 'button');
  assert.equal(dump.elements[0].testId, 'ok');
  assert.deepEqual(dump.elements[0].bounds, { x: 1, y: 2, width: 10, height: 4 });
});

test('parseRawDump: format detection (JSON passthrough / XML / a11y); empty → null', () => {
  assert.equal(parseRawDump(''), null);
  assert.equal(parseRawDump('{bad json'), null);
  assert.equal(parseRawDump('{"source":"a11y","elements":[{"id":"a"}]}').elements.length, 1); // JSON passthrough
  assert.equal(parseRawDump('<XCUIElementTypeButton name="x" />').source, 'page-source');
  assert.equal(parseRawDump('- button "Go"').source, 'a11y');
});

test('dumpActualProvider.captureRaw: real capture → actual screen with parsed elements', () => {
  const screens = dumpActualProvider.captureRaw([
    { screenId: 'perk', raw: '<android.widget.Button resource-id="title" text="Card perks" bounds="[0,0][100,20]" />' },
  ]);
  assert.equal(screens.length, 1);
  assert.equal(screens[0].screenId, 'perk');
  assert.equal(screens[0].elements[0].testId, 'title');
  assert.deepEqual(screens[0].texts, [{ subject: 'title', text: 'Card perks' }]); // element text projected for L5
});
