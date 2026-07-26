'use strict';

/**
 * Raw structured-dump parsers — relocated faithfully from qa-platform
 * `packages/shared/src/dump-parse.ts` (ADR-002 Rev.2 §2). Turn RAW captured
 * evidence into a StructuredDump `{ source, elements[] }` that L2–L6 consume:
 *   • Playwright `browser_snapshot` accessibility text (indent = hierarchy)
 *   • Appium `getPageSource()` XML (Android + iOS)
 *   • already-StructuredDump JSON (passthrough)
 * Pure, dependency-free; best-effort — malformed input yields whatever parsed
 * (never throws).
 */

function clean(el) {
  for (const k of Object.keys(el)) if (el[k] === undefined) delete el[k];
  return el;
}

/** Playwright a11y snapshot: `role "name" [ref=…]` per line, indent = hierarchy, `text: …` for text nodes. */
function parsePlaywrightA11y(text) {
  const elements = [];
  const stack = [];
  let counter = 0;
  for (const raw of String(text == null ? '' : text).split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const indent = (raw.match(/^\s*/)?.[0] ?? '').length;
    const s = raw.replace(/^\s*-\s*/, '').trim();
    if (!s) continue;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parentId = stack.length ? stack[stack.length - 1].id : undefined;
    const ref = s.match(/\[ref=([^\]]+)\]/);
    const id = ref ? ref[1] : `n${++counter}`;
    let role = 'node';
    let name;
    let textContent;
    const textM = s.match(/^text:\s*(.*)$/);
    if (textM) {
      role = 'text';
      textContent = textM[1].replace(/\[[^\]]*\]/g, '').trim() || undefined;
    } else {
      role = (s.match(/^([a-zA-Z][\w-]*)/)?.[1] ?? 'node').replace(/:$/, '');
      name = s.match(/"([^"]*)"/)?.[1];
    }
    elements.push(clean({ id, parentId, role, name, text: textContent }));
    stack.push({ indent, id });
  }
  return { source: 'a11y', elements };
}

/** Android `[x1,y1][x2,y2]` or iOS x/y/width/height attrs → bounds. */
function parseBounds(attrs) {
  const b = attrs.bounds && attrs.bounds.match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
  if (b) return { x: +b[1], y: +b[2], width: +b[3] - +b[1], height: +b[4] - +b[2] };
  if (attrs.x != null && attrs.width != null) return { x: +attrs.x, y: +attrs.y, width: +attrs.width, height: +attrs.height };
  return undefined;
}

/** android.widget.Button → button; XCUIElementTypeButton → button. */
function shortRole(tag) {
  return (tag.split('.').pop() ?? tag).replace(/^XCUIElementType/, '').toLowerCase();
}

const CONTAINER_TAGS = new Set(['hierarchy', 'AppiumAUT', '?xml']);

/** Appium page-source XML → StructuredDump (dependency-free tag scan + nesting stack). */
function parseAppiumXml(xml) {
  const elements = [];
  const stack = [];
  let counter = 0;
  const tagRe = /<(\/?)([\w.:?-]+)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g;
  let m;
  while ((m = tagRe.exec(xml))) {
    const closing = m[1] === '/';
    const tag = m[2];
    const selfClose = m[4] === '/';
    if (closing) { stack.pop(); continue; }
    if (CONTAINER_TAGS.has(tag)) { if (!selfClose) stack.push(`__c${++counter}`); continue; }
    const attrs = {};
    let a;
    const aRe = /([\w:-]+)="([^"]*)"/g;
    while ((a = aRe.exec(m[3]))) attrs[a[1]] = a[2];
    const testId = attrs['resource-id'] || attrs['name'] || undefined;
    const id = testId || `x${++counter}`;
    const parentId = stack.length ? stack[stack.length - 1] : undefined;
    elements.push(clean({
      id,
      parentId,
      testId,
      role: shortRole(tag),
      name: attrs['content-desc'] || attrs['label'] || attrs['name'] || undefined,
      text: attrs['text'] || attrs['value'] || undefined,
      bounds: parseBounds(attrs),
    }));
    if (!selfClose) stack.push(id);
  }
  return { source: 'page-source', elements };
}

/** Detect the raw format and parse. JSON StructuredDump passes through. Null on empty/invalid JSON. */
function parseRawDump(content) {
  const s = String(content == null ? '' : content).trim();
  if (!s) return null;
  if (s[0] === '{') {
    try { const j = JSON.parse(s); return j && Array.isArray(j.elements) ? j : null; } catch { return null; }
  }
  if (s[0] === '<') return parseAppiumXml(s);
  return parsePlaywrightA11y(s);
}

module.exports = { parsePlaywrightA11y, parseAppiumXml, parseRawDump };
