/**
 * Raw structured-dump parsers (BACKLOG-002 producer #3, ADR-002 Rev.2 §2).
 *
 * Turns the RAW structured evidence captured during execution into the
 * producer-agnostic `StructuredDump` (ACTUAL side) the pyramid consumes:
 *   • Playwright `browser_snapshot` accessibility text (YAML-ish tree)
 *   • Appium `getPageSource()` XML (Android + iOS)
 *   • already-`StructuredDump` JSON (passthrough)
 * Pure, dependency-free, browser-safe, unit-testable. Best-effort: malformed
 * input yields whatever parsed (never throws).
 */
import { StructuredDump } from './structured.js';
import type { StructuredElement } from './structured.js';

/** Drop undefined keys so dumps stay compact + stable. */
function clean(el: StructuredElement): StructuredElement {
  for (const k of Object.keys(el) as (keyof StructuredElement)[]) if (el[k] === undefined) delete el[k];
  return el;
}

/**
 * Parse a Playwright accessibility snapshot (indent = hierarchy; `role "name"
 * [attrs]` per line; `text: content` for text nodes; optional `[ref=…]` ids).
 */
export function parsePlaywrightA11y(text: string): StructuredDump {
  const elements: StructuredElement[] = [];
  const stack: Array<{ indent: number; id: string }> = [];
  let counter = 0;
  for (const raw of (text ?? '').split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const indent = (raw.match(/^\s*/)?.[0] ?? '').length;
    const s = raw.replace(/^\s*-\s*/, '').trim();
    if (!s) continue;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parentId = stack.length ? stack[stack.length - 1].id : undefined;
    const ref = s.match(/\[ref=([^\]]+)\]/);
    const id = ref ? ref[1] : `n${++counter}`;
    let role = 'node';
    let name: string | undefined;
    let textContent: string | undefined;
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

/** Android `[x1,y1][x2,y2]` or iOS x/y/width/height attrs → Rect. */
function parseBounds(attrs: Record<string, string>): StructuredElement['bounds'] {
  const b = attrs.bounds?.match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
  if (b) return { x: +b[1], y: +b[2], width: +b[3] - +b[1], height: +b[4] - +b[2] };
  if (attrs.x != null && attrs.width != null) return { x: +attrs.x, y: +attrs.y, width: +attrs.width, height: +attrs.height };
  return undefined;
}

/** Short role from an Appium class/type (android.widget.Button → button; XCUIElementTypeButton → button). */
function shortRole(tag: string): string {
  return (tag.split('.').pop() ?? tag).replace(/^XCUIElementType/, '').toLowerCase();
}

const CONTAINER_TAGS = new Set(['hierarchy', 'AppiumAUT', '?xml']);

/** Parse an Appium page-source XML tree (dependency-free tag scan + nesting stack). */
export function parseAppiumXml(xml: string): StructuredDump {
  const elements: StructuredElement[] = [];
  const stack: string[] = [];
  let counter = 0;
  const tagRe = /<(\/?)([\w.:?-]+)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(xml))) {
    const closing = m[1] === '/';
    const tag = m[2];
    const selfClose = m[4] === '/';
    if (closing) { stack.pop(); continue; }
    if (CONTAINER_TAGS.has(tag)) { if (!selfClose) stack.push(`__c${++counter}`); continue; }
    const attrs: Record<string, string> = {};
    let a: RegExpExecArray | null;
    const aRe = /([\w:-]+)="([^"]*)"/g;
    while ((a = aRe.exec(m[3]))) attrs[a[1]] = a[2];
    const testId = attrs['resource-id'] || attrs['name'] || undefined;
    const id = testId || `x${++counter}`;
    const parentId = stack.length ? stack[stack.length - 1] : undefined;
    elements.push(clean({
      id, parentId, testId,
      role: shortRole(tag),
      name: attrs['content-desc'] || attrs['label'] || attrs['name'] || undefined,
      text: attrs['text'] || attrs['value'] || undefined,
      bounds: parseBounds(attrs),
    }));
    if (!selfClose) stack.push(id);
  }
  return { source: 'page-source', elements };
}

/** Detect the raw format and parse. JSON `StructuredDump` passes through. Null on empty/invalid JSON. */
export function parseRawDump(content: string): StructuredDump | null {
  const s = (content ?? '').trim();
  if (!s) return null;
  if (s[0] === '{') {
    try { return StructuredDump.parse(JSON.parse(s)); } catch { return null; }
  }
  if (s[0] === '<') return parseAppiumXml(s);
  return parsePlaywrightA11y(s);
}
