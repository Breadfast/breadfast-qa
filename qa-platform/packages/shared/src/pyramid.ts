/**
 * Validation Pyramid engine (BACKLOG-002 VT4, ADR-002 Rev.2 §4).
 *
 * Pure, deterministic layer functions + orchestrator. Compares an EXPECTED model
 * (registry `expectedComponents`, optionally Figma-extracted bounds/styles)
 * against an ACTUAL `StructuredDump`, emitting `VisualFinding[]` with `layer` +
 * `source:'deterministic'` into the SAME `VisualScreenComparison` shape the
 * existing aggregation (computeVisualHealth / detectVisualPatterns / report)
 * already consumes — no downstream change.
 *
 * Data-source status (VT4): L2/L3/L5 run on registry + dump now; L4/L6 run when
 * expected bounds/styles are present (Figma extraction = follow-up); L7 pixel is
 * advisory via a pluggable comparator (real pixelmatch = follow-up). Layers with
 * no data simply produce nothing — dormant, never a false pass.
 *
 * Browser-safe (no fs); re-exported through the package index.
 */
import type { VisualFinding, VisualScreenComparison, VisualCategory, VisualLayer, VisualVerdict } from './schemas.js';
import type { ExpectedComponent, ValidationProfile, Rect } from './screen-registry.js';
import type { StructuredDump, StructuredElement } from './structured.js';
import { colorDeltaE, normalizeLength, normalizeFontFamily } from './normalize.js';

// ── Pluggable pixel comparator (L7 advisory; real engine is a follow-up) ─────
export interface PixelDiffResult {
  diffRatio: number; // 0..1 fraction of differing pixels
  regions?: Rect[];
}
export interface PixelComparator {
  compare(expectedImg: string, actualImg: string): Promise<PixelDiffResult | null>;
}
/** No-op comparator: never reports a diff. Safe default until pixelmatch is wired. */
export const nullPixelComparator: PixelComparator = {
  async compare(): Promise<PixelDiffResult | null> { return null; },
};

const LAYER_CATEGORIES: Record<VisualLayer, VisualCategory[]> = {
  identity: [],
  'component-tree': ['components'],
  visibility: ['states'],
  layout: ['layout', 'positioning'],
  text: ['content'],
  styles: ['color', 'typography'],
  pixel: ['layout'],
  ai: [],
};

/**
 * VT5-S2 — deterministic severity from a magnitude ratio (delta ÷ tolerance):
 * ≥3× tolerance ⇒ major, >1× ⇒ minor, else info. Same input ⇒ same severity,
 * never model-graded.
 */
export function severityForRatio(ratio: number): VisualFinding['severity'] {
  if (ratio >= 3) return 'major';
  if (ratio > 1) return 'minor';
  return 'info';
}

/** Build a fully-defaulted deterministic finding. */
function vf(p: Partial<VisualFinding> & { layer: VisualLayer; category: VisualCategory; dimension: string; severity: VisualFinding['severity']; screen: string }): VisualFinding {
  return {
    component: undefined, token: undefined, expected: '', actual: '', differenceDescription: '',
    recommendation: '', confidence: 'high', sources: [], source: 'deterministic', coverageGap: false,
    ...p,
  };
}

// ── Matching: expected component → actual element (identity, not by name) ─────
function elementMatches(exp: ExpectedComponent, el: StructuredElement): boolean {
  if (el.testId && exp.componentId) return el.testId === exp.componentId; // strongest identity
  if (exp.role) return (el.role ?? '') === exp.role; // role identity (name compared separately by L5)
  if (exp.accessibleName) return el.name === exp.accessibleName || el.text === exp.accessibleName;
  return false;
}

interface Match {
  exp: ExpectedComponent;
  actual?: StructuredElement;
  actualIndex?: number;
  matchCount: number; // how many actual elements match this component's identity (for duplicates)
}

function matchAll(expected: ExpectedComponent[], els: StructuredElement[]): Match[] {
  const used = new Set<number>();
  return expected.map((exp) => {
    let idx = -1;
    let count = 0;
    els.forEach((el, i) => {
      if (!elementMatches(exp, el)) return;
      count++;
      if (idx === -1 && !used.has(i)) idx = i;
    });
    if (idx >= 0) used.add(idx);
    return { exp, actual: idx >= 0 ? els[idx] : undefined, actualIndex: idx >= 0 ? idx : undefined, matchCount: count };
  });
}

const label = (exp: ExpectedComponent) => exp.componentId || exp.accessibleName || exp.role || 'component';

// ── L2 — Component Tree (missing / duplicate / order / hierarchy) ─────────────
export function layerComponents(matches: Match[], screen: string): VisualFinding[] {
  const out: VisualFinding[] = [];
  for (const m of matches) {
    if (!m.actual && m.exp.required) {
      out.push(vf({ layer: 'component-tree', category: 'components', dimension: 'missing-component', severity: 'major', screen,
        component: label(m.exp), expected: `${label(m.exp)} present`, actual: 'not found',
        differenceDescription: `Required component "${label(m.exp)}" is missing from the screen.`,
        recommendation: `Ensure "${label(m.exp)}" renders on this screen.` }));
    }
    const maxCard = m.exp.maxCardinality ?? 1;
    if (m.matchCount > maxCard) {
      out.push(vf({ layer: 'component-tree', category: 'components', dimension: 'duplicate-component', severity: 'major', screen,
        component: label(m.exp), expected: `at most ${maxCard}`, actual: `${m.matchCount} found`,
        differenceDescription: `Component "${label(m.exp)}" appears ${m.matchCount} times (expected ≤ ${maxCard}).`,
        recommendation: `Remove the duplicate "${label(m.exp)}".` }));
    }
  }
  // Ordering: expected components with an explicit order must appear in that order.
  const ordered = matches.filter((m) => m.exp.order != null && m.actualIndex != null)
    .sort((a, b) => (a.exp.order as number) - (b.exp.order as number));
  for (let i = 1; i < ordered.length; i++) {
    if ((ordered[i].actualIndex as number) < (ordered[i - 1].actualIndex as number)) {
      out.push(vf({ layer: 'component-tree', category: 'components', dimension: 'ordering', severity: 'minor', screen,
        component: label(ordered[i].exp), expected: `after "${label(ordered[i - 1].exp)}"`, actual: 'before it',
        differenceDescription: `"${label(ordered[i].exp)}" appears before "${label(ordered[i - 1].exp)}" but is expected after.`,
        recommendation: `Fix the ordering of "${label(ordered[i].exp)}".` }));
    }
  }
  // Hierarchy: expected parent must be the actual element's parent.
  const byId = new Map(matches.filter((m) => m.actual).map((m) => [m.exp.componentId, m.actual as StructuredElement]));
  for (const m of matches) {
    if (!m.exp.parent || !m.actual) continue;
    const parentEl = byId.get(m.exp.parent);
    if (parentEl && parentEl.id && m.actual.parentId && m.actual.parentId !== parentEl.id) {
      out.push(vf({ layer: 'component-tree', category: 'components', dimension: 'hierarchy', severity: 'minor', screen,
        component: label(m.exp), expected: `child of "${m.exp.parent}"`, actual: `parent "${m.actual.parentId}"`,
        differenceDescription: `"${label(m.exp)}" is not nested under "${m.exp.parent}" as expected.`,
        recommendation: `Nest "${label(m.exp)}" under "${m.exp.parent}".` }));
    }
  }
  return out;
}

// ── L3 — Visibility (matched required component with zero/negative bounds) ─────
export function layerVisibility(matches: Match[], screen: string): VisualFinding[] {
  const out: VisualFinding[] = [];
  for (const m of matches) {
    if (!m.actual || !m.exp.required) continue;
    const b = m.actual.bounds;
    if (b && (b.width <= 0 || b.height <= 0)) {
      out.push(vf({ layer: 'visibility', category: 'states', dimension: 'component-visibility', severity: 'major', screen,
        component: label(m.exp), expected: 'visible (non-zero bounds)', actual: `${b.width}×${b.height}`,
        differenceDescription: `"${label(m.exp)}" is present but not visible (zero-area bounds).`,
        recommendation: `Ensure "${label(m.exp)}" is visible.` }));
    }
  }
  return out;
}

// ── L5 — Text / Copy (expected accessibleName vs actual text) ─────────────────
const normText = (s?: string) => (s ?? '').trim().replace(/\s+/g, ' ');
export function layerText(matches: Match[], screen: string): VisualFinding[] {
  const out: VisualFinding[] = [];
  for (const m of matches) {
    if (!m.actual || !m.exp.accessibleName) continue;
    const actualText = m.actual.name ?? m.actual.text ?? '';
    if (normText(actualText) !== normText(m.exp.accessibleName)) {
      out.push(vf({ layer: 'text', category: 'content', dimension: 'exact-text', severity: 'major', screen,
        component: label(m.exp), expected: m.exp.accessibleName, actual: actualText,
        differenceDescription: `"${label(m.exp)}" text is "${actualText}" but expected "${m.exp.accessibleName}".`,
        recommendation: `Update the copy to "${m.exp.accessibleName}".` }));
    }
  }
  return out;
}

// ── L4 — Layout (expected bounds vs actual bounds within tolerance) ───────────
function maxBoundsDelta(a: Rect, b: Rect): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.width - b.width), Math.abs(a.height - b.height));
}
export function layerLayout(matches: Match[], screen: string, tolerancePx: number): VisualFinding[] {
  const out: VisualFinding[] = [];
  for (const m of matches) {
    if (!m.actual?.bounds || !m.exp.bounds) continue;
    const delta = maxBoundsDelta(m.exp.bounds, m.actual.bounds);
    if (delta > tolerancePx) {
      const fmt = (r: Rect) => `${r.x},${r.y} ${r.width}×${r.height}`;
      out.push(vf({ layer: 'layout', category: 'layout', dimension: 'position', severity: severityForRatio(delta / Math.max(1, tolerancePx)), screen,
        component: label(m.exp), expected: fmt(m.exp.bounds), actual: fmt(m.actual.bounds),
        differenceDescription: `"${label(m.exp)}" is ${Math.round(delta)}px off its expected box (tolerance ${tolerancePx}px).`,
        recommendation: `Align "${label(m.exp)}" to the design bounds.` }));
    }
  }
  return out;
}

// ── L6 — Styles / Tokens (expected styles vs actual, normalized + tolerant) ───
const COLOR_KEYS = /color|background|border-color|fill|stroke/i;
const LENGTH_KEYS = /size|width|height|padding|margin|radius|spacing|gap|line-height|letter-spacing/i;
export function layerStyles(matches: Match[], screen: string, opts: { colorDeltaE: number; px: number; fontPx: number }): VisualFinding[] {
  const out: VisualFinding[] = [];
  for (const m of matches) {
    if (!m.actual?.styles || !m.exp.styles) continue;
    for (const [key, ev] of Object.entries(m.exp.styles)) {
      const av = m.actual.styles[key];
      if (av == null) continue; // can't compare — skip (dormant, not a false finding)
      let mismatch = false;
      let dim = 'style';
      let cat: VisualCategory = 'color';
      let sev: VisualFinding['severity'] = 'minor'; // VT5-S2 — magnitude-based where a ratio exists
      if (COLOR_KEYS.test(key)) {
        const d = colorDeltaE(ev, av);
        if (d != null && d > opts.colorDeltaE) { mismatch = true; sev = severityForRatio(d / Math.max(1, opts.colorDeltaE)); }
        dim = 'color'; cat = 'color';
      } else if (/font-family/i.test(key)) {
        mismatch = normalizeFontFamily(ev) !== normalizeFontFamily(av); dim = 'font-family'; cat = 'typography';
      } else if (LENGTH_KEYS.test(key)) {
        const a = normalizeLength(ev); const b = normalizeLength(av);
        const tol = /font-size|line-height|letter-spacing/i.test(key) ? opts.fontPx : opts.px;
        if (a != null && b != null && Math.abs(a - b) > tol) { mismatch = true; sev = severityForRatio(Math.abs(a - b) / Math.max(1, tol)); }
        dim = key; cat = /font/i.test(key) ? 'typography' : 'color';
      } else {
        mismatch = String(ev).trim() !== String(av).trim(); dim = key;
      }
      if (mismatch) {
        out.push(vf({ layer: 'styles', category: cat, dimension: dim, severity: sev, screen,
          component: label(m.exp), token: { kind: cat === 'typography' ? 'typography' : cat === 'color' ? 'color' : 'spacing', name: key, expected: ev, actual: av },
          expected: ev, actual: av,
          differenceDescription: `"${label(m.exp)}" ${key} is "${av}" but expected "${ev}".`,
          recommendation: `Update the ${key} token on "${label(m.exp)}".` }));
      }
    }
  }
  return out;
}

// ── L7 — Pixel (advisory only; from a precomputed diff) ───────────────────────
export function layerPixel(diff: PixelDiffResult, screen: string, threshold = 0.02): VisualFinding[] {
  if (diff.diffRatio <= threshold) return [];
  return [vf({ layer: 'pixel', category: 'layout', dimension: 'pixel-diff', severity: 'info', screen,
    expected: 'design frame', actual: `${Math.round(diff.diffRatio * 100)}% pixels differ`,
    differenceDescription: `Advisory: ${Math.round(diff.diffRatio * 100)}% of pixels differ from the design (structural layers are authoritative).`,
    recommendation: 'Review the highlighted regions.' })];
}

// ── Orchestrator ─────────────────────────────────────────────────────────────
export interface PyramidScreenInput {
  screen: string;
  combo?: string;
  expectedFrame?: string;
  actualScreenshot?: string;
  expectedComponents: ExpectedComponent[];
  actual?: StructuredDump | null;
}

function deriveVerdict(input: PyramidScreenInput, findings: VisualFinding[], elementCount: number): VisualVerdict {
  const hasExpected = (input.expectedComponents?.length ?? 0) > 0 || !!input.expectedFrame;
  if (!hasExpected && elementCount === 0) return 'no-frame';
  const sev = new Set(findings.map((f) => f.severity));
  if (sev.has('critical') || sev.has('major')) return 'major';
  if (sev.has('minor')) return 'minor';
  return 'pass';
}

/**
 * Run the enabled deterministic layers for one screen. Per-component
 * short-circuit is inherent: L3–L6 only consider MATCHED components, so a
 * missing component (flagged by L2) is not re-flagged downstream. Collect-all:
 * every enabled layer contributes; nothing hard-stops.
 */
export function runPyramid(
  input: PyramidScreenInput,
  profile: ValidationProfile,
  extra: { pixelDiff?: PixelDiffResult | null } = {},
): VisualScreenComparison {
  const on = (l: VisualLayer) => profile.enabledLayers.includes(l);
  const els = input.actual?.elements ?? [];
  const matches = matchAll(input.expectedComponents ?? [], els);
  const findings: VisualFinding[] = [];
  const cats = new Set<VisualCategory>();
  const mark = (l: VisualLayer) => LAYER_CATEGORIES[l].forEach((c) => cats.add(c));

  const hasComponents = (input.expectedComponents?.length ?? 0) > 0;
  if (on('component-tree') && hasComponents) { findings.push(...layerComponents(matches, input.screen)); mark('component-tree'); }
  if (on('visibility') && matches.some((m) => m.actual)) { findings.push(...layerVisibility(matches, input.screen)); mark('visibility'); }
  if (on('text') && matches.some((m) => m.actual && m.exp.accessibleName)) { findings.push(...layerText(matches, input.screen)); mark('text'); }
  if (on('layout') && matches.some((m) => m.actual?.bounds && m.exp.bounds)) { findings.push(...layerLayout(matches, input.screen, profile.tolerances.px)); mark('layout'); }
  if (on('styles') && matches.some((m) => m.actual?.styles && m.exp.styles)) {
    findings.push(...layerStyles(matches, input.screen, { colorDeltaE: profile.tolerances.colorDeltaE, px: profile.tolerances.spacingPx, fontPx: profile.tolerances.fontPx }));
    mark('styles');
  }
  if (on('pixel') && extra.pixelDiff) { findings.push(...layerPixel(extra.pixelDiff, input.screen)); mark('pixel'); }

  return {
    screen: input.screen,
    combo: input.combo ?? 'web · en-US',
    expectedFrame: input.expectedFrame,
    actualScreenshot: input.actualScreenshot,
    verdict: deriveVerdict(input, findings, els.length),
    categoriesChecked: [...cats],
    findings,
  };
}
