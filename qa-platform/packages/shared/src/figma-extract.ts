/**
 * Figma structured extraction (BACKLOG-002 producer #1, ADR-002 Rev.2 §4 L4/L5/L6).
 *
 * Pure transforms from a Figma REST node tree (`/v1/files/:key/nodes` document)
 * to the producer-agnostic `StructuredDump` (EXPECTED design side), and from a
 * dump to conservative `ExpectedComponent[]` the pyramid can compare against the
 * ACTUAL dump. The network fetch lives in the worker (`figma.ts`); this module is
 * pure + browser-safe + unit-testable with mock Figma JSON.
 *
 * Bounds are frame-relative (each node's absoluteBoundingBox minus the root
 * origin). Styles are raw (color → hex, font-size → px, …); comparison-time
 * normalization is `normalize.ts`.
 */
import type { StructuredDump, StructuredElement } from './structured.js';
import type { ExpectedComponent } from './screen-registry.js';

export interface FigmaNode {
  id?: string;
  name?: string;
  type?: string;
  visible?: boolean;
  characters?: string;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number } | null;
  style?: { fontFamily?: string; fontSize?: number; fontWeight?: number; lineHeightPx?: number; letterSpacing?: number };
  fills?: Array<{ type?: string; visible?: boolean; opacity?: number; color?: { r: number; g: number; b: number; a?: number } }>;
  cornerRadius?: number;
  children?: FigmaNode[];
}

const ROLE_BY_TYPE: Record<string, string> = {
  TEXT: 'text', FRAME: 'group', GROUP: 'group', SECTION: 'group',
  COMPONENT: 'component', COMPONENT_SET: 'component', INSTANCE: 'component',
  RECTANGLE: 'shape', VECTOR: 'shape', ELLIPSE: 'shape', LINE: 'shape', IMAGE: 'image',
};
const roleOf = (type?: string) => ROLE_BY_TYPE[type ?? ''] ?? (type ? type.toLowerCase() : 'node');

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n * 255))).toString(16).padStart(2, '0');

/** First visible SOLID fill → #rrggbb, else undefined. */
function fillColorHex(fills?: FigmaNode['fills']): string | undefined {
  const f = (fills ?? []).find((x) => (x.type ?? 'SOLID') === 'SOLID' && x.visible !== false && x.color);
  if (!f?.color) return undefined;
  return `#${hex2(f.color.r)}${hex2(f.color.g)}${hex2(f.color.b)}`;
}

function stylesOf(node: FigmaNode): Record<string, string> | undefined {
  const s: Record<string, string> = {};
  const color = fillColorHex(node.fills);
  if (color) s.color = color;
  if (node.style?.fontFamily) s['font-family'] = node.style.fontFamily;
  if (node.style?.fontSize != null) s['font-size'] = `${node.style.fontSize}px`;
  if (node.style?.fontWeight != null) s['font-weight'] = String(node.style.fontWeight);
  if (node.style?.lineHeightPx != null) s['line-height'] = `${Math.round(node.style.lineHeightPx)}px`;
  if (node.cornerRadius != null) s['corner-radius'] = `${node.cornerRadius}px`;
  return Object.keys(s).length ? s : undefined;
}

/** Convert a Figma node document (the root frame) to a StructuredDump. */
export function figmaNodesToStructuredDump(
  root: FigmaNode,
  opts: { platform?: StructuredDump['platform']; screenId?: string } = {},
): StructuredDump {
  const origin = root.absoluteBoundingBox ?? { x: 0, y: 0, width: 0, height: 0 };
  const elements: StructuredElement[] = [];
  const walk = (node: FigmaNode, parentId?: string) => {
    if (node.visible === false) return;
    const b = node.absoluteBoundingBox;
    const el: StructuredElement = {
      id: node.id,
      parentId,
      role: roleOf(node.type),
      name: node.name,
      text: node.type === 'TEXT' ? node.characters : undefined,
      bounds: b ? { x: Math.round(b.x - origin.x), y: Math.round(b.y - origin.y), width: Math.round(b.width), height: Math.round(b.height) } : undefined,
      styles: stylesOf(node),
    };
    // Drop undefined keys so dumps are compact + stable.
    for (const k of Object.keys(el) as (keyof StructuredElement)[]) if (el[k] === undefined) delete el[k];
    elements.push(el);
    for (const c of node.children ?? []) walk(c, node.id);
  };
  walk(root, undefined);
  return { source: 'figma', ...(opts.platform ? { platform: opts.platform } : {}), ...(opts.screenId ? { screenId: opts.screenId } : {}), elements };
}

/**
 * Derive conservative expected components from a Figma dump for the pyramid.
 * Only TEXT + component-type elements (which correspond to app-visible
 * components) are emitted, and `required` is FALSE — auto-derived design layers
 * must NOT trigger L2 "missing" spam. They feed L4/L5/L6 on MATCHED components
 * only. Curated registry components (DEC-3) override this with real identities.
 */
export function structuredDumpToExpectedComponents(dump: StructuredDump): ExpectedComponent[] {
  const out: ExpectedComponent[] = [];
  let i = 0;
  for (const el of dump.elements ?? []) {
    const keep = el.role === 'text' || el.role === 'component' || (el.text != null && el.text !== '');
    if (!keep) continue;
    out.push({
      componentId: el.id ?? el.name ?? `figma-${i}`,
      role: el.role ?? '',
      accessibleName: el.text ?? el.name,
      required: false,
      order: i,
      ...(el.parentId ? { parent: el.parentId } : {}),
      ...(el.bounds ? { bounds: el.bounds } : {}),
      ...(el.styles ? { styles: el.styles } : {}),
    });
    i++;
  }
  return out;
}
