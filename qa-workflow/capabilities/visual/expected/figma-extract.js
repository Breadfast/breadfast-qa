'use strict';

/**
 * Figma structured extraction — relocated faithfully from qa-platform
 * `packages/shared/src/figma-extract.ts` (ADR-002 Rev.2 §4). PURE transforms from a
 * Figma REST node tree (`/v1/files/:key/nodes` document) → StructuredDump (EXPECTED
 * design side), and dump → conservative `ExpectedComponent[]`. Bounds are
 * frame-relative (node box minus the root origin); styles are raw (color → hex,
 * font-size → px …) — comparison-time normalization is `../layers/normalize`.
 * Zero-dependency, browser-safe. Live fetch stays in automation/** (FigmaExporter).
 */

const ROLE_BY_TYPE = {
  TEXT: 'text', FRAME: 'group', GROUP: 'group', SECTION: 'group',
  COMPONENT: 'component', COMPONENT_SET: 'component', INSTANCE: 'component',
  RECTANGLE: 'shape', VECTOR: 'shape', ELLIPSE: 'shape', LINE: 'shape', IMAGE: 'image',
};
const roleOf = (type) => ROLE_BY_TYPE[type || ''] || (type ? String(type).toLowerCase() : 'node');
const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n * 255))).toString(16).padStart(2, '0');

/** First visible SOLID fill → #rrggbb, else undefined. */
function fillColorHex(fills) {
  const f = (fills || []).find((x) => (x.type || 'SOLID') === 'SOLID' && x.visible !== false && x.color);
  if (!f || !f.color) return undefined;
  return `#${hex2(f.color.r)}${hex2(f.color.g)}${hex2(f.color.b)}`;
}

function stylesOf(node) {
  const s = {};
  const color = fillColorHex(node.fills);
  if (color) s.color = color;
  const st = node.style || {};
  if (st.fontFamily) s['font-family'] = st.fontFamily;
  if (st.fontSize != null) s['font-size'] = `${st.fontSize}px`;
  if (st.fontWeight != null) s['font-weight'] = String(st.fontWeight);
  if (st.lineHeightPx != null) s['line-height'] = `${Math.round(st.lineHeightPx)}px`;
  if (node.cornerRadius != null) s['corner-radius'] = `${node.cornerRadius}px`;
  return Object.keys(s).length ? s : undefined;
}

/** Convert a Figma node document (the root frame) → StructuredDump. */
function figmaNodesToStructuredDump(root, opts = {}) {
  const origin = root.absoluteBoundingBox || { x: 0, y: 0, width: 0, height: 0 };
  const elements = [];
  const walk = (node, parentId) => {
    if (node.visible === false) return;
    const b = node.absoluteBoundingBox;
    const el = {
      id: node.id,
      parentId,
      role: roleOf(node.type),
      name: node.name,
      text: node.type === 'TEXT' ? node.characters : undefined,
      bounds: b ? { x: Math.round(b.x - origin.x), y: Math.round(b.y - origin.y), width: Math.round(b.width), height: Math.round(b.height) } : undefined,
      styles: stylesOf(node),
    };
    for (const k of Object.keys(el)) if (el[k] === undefined) delete el[k];
    elements.push(el);
    for (const c of node.children || []) walk(c, node.id);
  };
  walk(root, undefined);
  const dump = { source: 'figma', elements };
  if (opts.platform) dump.platform = opts.platform;
  if (opts.screenId) dump.screenId = opts.screenId;
  return dump;
}

/**
 * Derive conservative expected components from a Figma dump. Only TEXT / component
 * elements are emitted, `required` FALSE — auto-derived design layers must NOT
 * trigger L2 "missing" spam; they feed L4/L5/L6 on MATCHED components only. Curated
 * registry components override this with real identities + `required:true`.
 */
function structuredDumpToExpectedComponents(dump) {
  const out = [];
  let i = 0;
  for (const el of dump.elements || []) {
    const keep = el.role === 'text' || el.role === 'component' || (el.text != null && el.text !== '');
    if (!keep) continue;
    const c = {
      componentId: el.id || el.name || `figma-${i}`,
      role: el.role || '',
      accessibleName: el.text != null ? el.text : el.name,
      required: false,
      order: i,
    };
    if (el.parentId) c.parent = el.parentId;
    if (el.bounds) c.bounds = el.bounds;
    if (el.styles) c.styles = el.styles;
    out.push(c);
    i++;
  }
  return out;
}

module.exports = { figmaNodesToStructuredDump, structuredDumpToExpectedComponents };
