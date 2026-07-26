/**
 * Visual Testing Intelligence — deterministic layer (Roadmap Phase 2, M3).
 *
 * The AI vision comparator (prompt `visual_comparison`) DETECTS findings by
 * reasoning over the Figma frame + actual screenshot + Acceptance Criteria like
 * a Senior QA Engineer. THIS module is the deterministic framework around it:
 *   - VISUAL_CHECKS — the fixed, comprehensive checklist of what is validated
 *     (also injected into the prompt), so every dimension is independently and
 *     reproducibly covered.
 *   - computeVisualHealth — pure aggregation: screens validated/passed/failed,
 *     pass rate, findings by severity/category, coverage, overall Visual Health.
 *   - explainVisualFinding — every finding self-explains via the M2 model.
 *
 * Modular by design: findings from FUTURE comparators (pixelmatch, OCR, axe,
 * cross-browser/device, theme) share the VisualFinding shape and flow through
 * this same aggregation — no schema or architecture change required.
 */
import {
  VISUAL_CATEGORIES,
  type VisualCategory,
  type VisualComparison,
  type VisualFinding,
  type VisualPattern,
  type VisualScreenComparison,
  type VisualSeverity,
} from './schemas.js';
import { explainArtifact, type ArtifactExplanation, type ExplainVersions } from './explain.js';
import type { CitationContext } from './citations.js';

// Re-export the design-system vocabulary so consumers (prompt, report, web) have
// one import site for the checklist AND the component/token taxonomy (M3.5).
export { UI_COMPONENTS, DESIGN_TOKEN_KINDS } from './schemas.js';
export type { DesignTokenKind, DesignTokenRef, VisualPattern } from './schemas.js';

export interface VisualCheck {
  id: string;
  category: VisualCategory;
  dimension: string;
  description: string;
}

/** The comprehensive, deterministic validation checklist (Senior-QA UI review). */
export const VISUAL_CHECKS: VisualCheck[] = [
  // Layout
  { id: 'layout.overall', category: 'layout', dimension: 'overall-layout', description: 'Overall layout matches the Figma frame' },
  { id: 'layout.grid', category: 'layout', dimension: 'grid-consistency', description: 'Grid/columns consistent with the design' },
  { id: 'layout.section-order', category: 'layout', dimension: 'section-ordering', description: 'Sections appear in the designed order' },
  { id: 'layout.hierarchy', category: 'layout', dimension: 'component-hierarchy', description: 'Component/visual hierarchy matches' },
  { id: 'layout.structure', category: 'layout', dimension: 'screen-structure', description: 'Screen structure (header/body/footer) matches' },
  // Positioning
  { id: 'pos.alignment', category: 'positioning', dimension: 'alignment', description: 'Elements aligned as designed' },
  { id: 'pos.position', category: 'positioning', dimension: 'position', description: 'Elements positioned as designed' },
  { id: 'pos.margins', category: 'positioning', dimension: 'margins', description: 'Outer margins match the design' },
  { id: 'pos.padding', category: 'positioning', dimension: 'padding', description: 'Inner padding matches the design' },
  { id: 'pos.spacing', category: 'positioning', dimension: 'spacing', description: 'Spacing/gaps between elements match' },
  { id: 'pos.distribution', category: 'positioning', dimension: 'distribution', description: 'Distribution/justification matches' },
  // Typography
  { id: 'type.family', category: 'typography', dimension: 'font-family', description: 'Font family matches the platform design' },
  { id: 'type.size', category: 'typography', dimension: 'font-size', description: 'Font size matches' },
  { id: 'type.weight', category: 'typography', dimension: 'font-weight', description: 'Font weight matches' },
  { id: 'type.line-height', category: 'typography', dimension: 'line-height', description: 'Line height matches' },
  { id: 'type.letter-spacing', category: 'typography', dimension: 'letter-spacing', description: 'Letter spacing matches' },
  { id: 'type.sentence-case', category: 'typography', dimension: 'sentence-case', description: 'Sentence case / capitalization matches (not Title Case unless designed)' },
  { id: 'type.wrapping', category: 'typography', dimension: 'text-wrapping', description: 'Text wrapping/truncation/overflow behaves as designed' },
  // Content (exact wording)
  { id: 'content.labels', category: 'content', dimension: 'labels', description: 'Labels match Figma wording exactly' },
  { id: 'content.helper', category: 'content', dimension: 'helper-text', description: 'Helper text matches exactly' },
  { id: 'content.placeholder', category: 'content', dimension: 'placeholder', description: 'Placeholder text matches exactly' },
  { id: 'content.button', category: 'content', dimension: 'button-text', description: 'Button text matches exactly (incl. case)' },
  { id: 'content.validation', category: 'content', dimension: 'validation-message', description: 'Validation messages match exactly' },
  { id: 'content.success', category: 'content', dimension: 'success-message', description: 'Success messages match exactly' },
  { id: 'content.error', category: 'content', dimension: 'error-message', description: 'Error messages match exactly' },
  { id: 'content.punctuation', category: 'content', dimension: 'punctuation-whitespace', description: 'Punctuation / whitespace differences' },
  // Color
  { id: 'color.background', category: 'color', dimension: 'background', description: 'Background colors match design tokens' },
  { id: 'color.text', category: 'color', dimension: 'text-color', description: 'Text colors match' },
  { id: 'color.border', category: 'color', dimension: 'borders', description: 'Border colors/width match' },
  { id: 'color.shadow', category: 'color', dimension: 'shadow-elevation', description: 'Shadows/elevation/opacity match' },
  { id: 'color.radius', category: 'color', dimension: 'corner-radius', description: 'Corner radius matches' },
  // Components
  { id: 'comp.presence', category: 'components', dimension: 'component-visibility', description: 'All designed components are present (none missing/extra)' },
  { id: 'comp.render', category: 'components', dimension: 'component-rendering', description: 'Buttons/inputs/cards/lists/tables/chips/icons/images/modals/sheets/tooltips/toasts render as designed' },
  { id: 'comp.icons', category: 'components', dimension: 'icons', description: 'Correct icons used' },
  { id: 'comp.images', category: 'components', dimension: 'images', description: 'Correct images/assets used' },
  // Dropdowns
  { id: 'drop.ordering', category: 'dropdowns', dimension: 'item-ordering', description: 'Dropdown item ordering matches the approved design' },
  { id: 'drop.values', category: 'dropdowns', dimension: 'values', description: 'Labels/default/disabled/hidden/duplicate values correct' },
  { id: 'drop.selection', category: 'dropdowns', dimension: 'selection-behavior', description: 'Selection behavior matches' },
  // States
  { id: 'state.default', category: 'states', dimension: 'default', description: 'Default state matches' },
  { id: 'state.interactive', category: 'states', dimension: 'hover-focus-active-selected', description: 'Hover/focus/active/selected states match (where observable)' },
  { id: 'state.disabled', category: 'states', dimension: 'disabled', description: 'Disabled/enabled states match' },
  { id: 'state.async', category: 'states', dimension: 'loading-error-success-empty', description: 'Loading/error/success/empty states match' },
  // Navigation
  { id: 'nav.transitions', category: 'navigation', dimension: 'transitions', description: 'Screen transitions / back navigation as designed' },
  { id: 'nav.conditional', category: 'navigation', dimension: 'conditional-visibility', description: 'Conditional rendering/visibility correct' },
  // Responsive
  { id: 'resp.sizes', category: 'responsive', dimension: 'screen-sizes', description: 'Adapts across screen sizes/orientation/devices (where applicable)' },
  // Accessibility
  { id: 'a11y.contrast', category: 'accessibility', dimension: 'contrast', description: 'Contrast/readability adequate' },
  { id: 'a11y.focus', category: 'accessibility', dimension: 'focus-visibility', description: 'Focus visibility present (where observable)' },
  { id: 'a11y.labels', category: 'accessibility', dimension: 'a11y-labels', description: 'Accessibility labels present (where available)' },
];

/** Checks grouped by category — handy for the prompt and coverage. */
export function visualChecksByCategory(): Record<VisualCategory, VisualCheck[]> {
  const out = Object.fromEntries(VISUAL_CATEGORIES.map((c) => [c, [] as VisualCheck[]])) as Record<VisualCategory, VisualCheck[]>;
  for (const c of VISUAL_CHECKS) out[c.category].push(c);
  return out;
}

// ── Deterministic aggregation ────────────────────────────────────────────────
const SEVERITY_PENALTY: Record<VisualSeverity, number> = { critical: 25, major: 10, minor: 3, info: 0 };
const SEVERITY_RANK: Record<VisualSeverity, number> = { critical: 3, major: 2, minor: 1, info: 0 };

export interface VisualHealth {
  screensValidated: number;
  screensPassed: number;
  screensFailed: number;
  passRate: number; // % of validated screens with a pass verdict
  screensCoverageGap: number; // VT1-S2 — screens with no resolvable frame (coverage-reducing, not defects)
  findingsBySeverity: Record<VisualSeverity, number>;
  findingsByCategory: Record<string, number>;
  categoriesCovered: VisualCategory[];
  coverage: number; // % of VISUAL_CATEGORIES actually validated
  componentsAffected: string[]; // M3.5 — reusable components with ≥1 finding
  patternCount: number; // M3.5 — recurring root causes detected
  totalFindings: number;
  visualHealth: number; // 0–100
  level: 'high' | 'medium' | 'low';
}

/** Pure, deterministic health/coverage/pass-rate from a VisualComparison. */
export function computeVisualHealth(vc?: VisualComparison | null): VisualHealth {
  const screens: VisualScreenComparison[] = vc?.screens ?? [];
  // VT1-S2: coverage-gap screens are NOT validated (no frame was actually
  // compared) — they reduce coverage but never count as pass/fail.
  const validated = screens.filter((s) => s.verdict !== 'no-frame' && s.verdict !== 'coverage-gap');
  const passed = validated.filter((s) => s.verdict === 'pass');
  const failed = validated.filter((s) => s.verdict === 'major');
  const coverageGapScreens = screens.filter((s) => s.verdict === 'coverage-gap');

  const findingsBySeverity: Record<VisualSeverity, number> = { critical: 0, major: 0, minor: 0, info: 0 };
  const findingsByCategory: Record<string, number> = {};
  const covered = new Set<VisualCategory>();
  const components = new Set<string>();
  let penalty = 0;
  let total = 0;

  for (const s of screens) {
    for (const cat of s.categoriesChecked ?? []) covered.add(cat);
    for (const f of s.findings ?? []) {
      if (f.coverageGap) continue; // VT1-S2 — coverage-gap notices are not real findings; never penalize health
      total++;
      findingsBySeverity[f.severity] = (findingsBySeverity[f.severity] ?? 0) + 1;
      findingsByCategory[f.category] = (findingsByCategory[f.category] ?? 0) + 1;
      covered.add(f.category);
      if (f.component) components.add(f.component);
      penalty += SEVERITY_PENALTY[f.severity] ?? 0;
    }
  }

  const passRate = validated.length ? Math.round((passed.length / validated.length) * 100) : 0;
  const categoriesCovered = VISUAL_CATEGORIES.filter((c) => covered.has(c));
  const coverage = Math.round((categoriesCovered.length / VISUAL_CATEGORIES.length) * 100);
  const visualHealth = Math.max(0, Math.min(100, 100 - penalty));
  const level: VisualHealth['level'] = visualHealth >= 80 ? 'high' : visualHealth >= 50 ? 'medium' : 'low';

  return {
    screensValidated: validated.length,
    screensPassed: passed.length,
    screensFailed: failed.length,
    passRate,
    screensCoverageGap: coverageGapScreens.length,
    findingsBySeverity,
    findingsByCategory,
    categoriesCovered,
    coverage,
    componentsAffected: [...components].sort(),
    patternCount: detectVisualPatterns(vc).length,
    totalFindings: total,
    visualHealth,
    level,
  };
}

// ── Pattern detection (M3.5) — deterministic root-cause grouping ─────────────
// When the same issue recurs (same dimension + component/token) across screens,
// group it into ONE pattern so reviewers fix the shared root cause once instead
// of triaging N duplicate findings. Pure: same findings ⇒ same patterns.

const HUMAN_DIMENSION: Record<string, string> = {
  'sentence-case': 'Sentence case',
  'button-text': 'Button label',
  'font-size': 'Font size',
  'font-weight': 'Font weight',
  'letter-spacing': 'Letter spacing',
  'line-height': 'Line height',
  spacing: 'Spacing',
  padding: 'Padding',
  margins: 'Margins',
  'corner-radius': 'Corner radius',
  'item-ordering': 'Item ordering',
};

function titleCasePhrase(dimension: string): string {
  return HUMAN_DIMENSION[dimension] || (dimension ? dimension.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : 'Visual');
}

/** The stable grouping key for a finding: dimension + component + token id/kind. */
function patternKey(f: VisualFinding): string {
  const tokenPart = f.token ? `${f.token.kind}:${f.token.name ?? ''}` : '';
  return [f.category, f.dimension || '', f.component ?? '', tokenPart].join('|');
}

/** Root-cause sentence + actionable recommendation, preferring the design-system frame. */
function rootCauseFor(f: VisualFinding, count: number): { rootCause: string; recommendation: string } {
  const dim = titleCasePhrase(f.dimension).toLowerCase();
  if (f.component && f.token) {
    return {
      rootCause: `The ${f.component} uses the wrong ${f.token.kind} token${f.token.name ? ` (${f.token.name})` : ''}.`,
      recommendation: `Update the ${f.token.kind} token${f.token.name ? ` (${f.token.name})` : ''} used by the shared ${f.component} component.`,
    };
  }
  if (f.component) {
    return {
      rootCause: `The ${f.component} does not match the approved component specification (${dim}).`,
      recommendation: `Correct the shared ${f.component} component so every instance is consistent.`,
    };
  }
  if (f.token) {
    return {
      rootCause: `Incorrect ${f.token.kind} token${f.token.name ? ` (${f.token.name})` : ''} applied across ${count} screen(s).`,
      recommendation: `Update the ${f.token.kind} design token${f.token.name ? ` (${f.token.name})` : ''} at its source.`,
    };
  }
  return {
    rootCause: `${titleCasePhrase(f.dimension)} inconsistency recurs across ${count} screen(s).`,
    recommendation: f.recommendation || `Resolve the ${dim} inconsistency at its shared source rather than per screen.`,
  };
}

/**
 * Group findings into recurring patterns (occurrences ≥ 2). Findings from any
 * comparator (vision today; pixel/OCR/axe later) that share a key collapse into
 * one root cause. Sorted by severity then occurrences for stable, useful output.
 */
export function detectVisualPatterns(vc?: VisualComparison | null): VisualPattern[] {
  const groups = new Map<string, VisualFinding[]>();
  for (const s of vc?.screens ?? []) {
    for (const f of s.findings ?? []) {
      if (f.coverageGap) continue; // VT1-S2 — coverage-gap notices are not visual patterns
      const k = patternKey(f);
      (groups.get(k) ?? groups.set(k, []).get(k)!).push({ ...f, screen: f.screen || s.screen });
    }
  }
  const patterns: VisualPattern[] = [];
  for (const [key, fs] of groups) {
    if (fs.length < 2) continue; // a pattern is a REPEATED issue
    const screensSet = [...new Set(fs.map((f) => f.screen).filter(Boolean))].sort();
    const severity = fs.map((f) => f.severity).sort((a, b) => SEVERITY_RANK[b] - SEVERITY_RANK[a])[0];
    const rep = fs.find((f) => f.severity === severity) ?? fs[0];
    const scope = screensSet.length || fs.length;
    const { rootCause, recommendation } = rootCauseFor(rep, scope);
    const subject = rep.component || (rep.token ? `${titleCasePhrase(rep.dimension)} (${rep.token.kind} token)` : titleCasePhrase(rep.dimension));
    patterns.push({
      key,
      title: `${subject} affecting ${scope} screen${scope === 1 ? '' : 's'}`,
      category: rep.category,
      dimension: rep.dimension,
      component: rep.component,
      token: rep.token,
      severity,
      occurrences: fs.length,
      screens: screensSet,
      rootCause,
      recommendation,
    });
  }
  return patterns.sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.occurrences - a.occurrences || a.key.localeCompare(b.key),
  );
}

/** Turn a visual finding into a self-explaining ArtifactExplanation (M2 model). */
export function explainVisualFinding(
  finding: VisualFinding,
  screen: Pick<VisualScreenComparison, 'screen' | 'expectedFrame' | 'actualScreenshot'>,
  versions?: ExplainVersions,
  citationContext?: CitationContext,
): ArtifactExplanation {
  // Design-system framing (M3.5): when the finding names a component/token, lead
  // with it so the explanation reads like a Senior QA reviewer ("Primary Button
  // uses the wrong typography token") rather than a raw pixel delta.
  const dsPrefix = finding.component
    ? finding.token
      ? `${finding.component} uses the wrong ${finding.token.kind} token: `
      : `${finding.component}: `
    : finding.token
      ? `Incorrect ${finding.token.kind} token: `
      : '';
  const reason =
    (finding.differenceDescription?.trim() && `${dsPrefix}${finding.differenceDescription.trim()}`) ||
    `${dsPrefix}${finding.category}/${finding.dimension} on "${finding.screen || screen.screen}": expected ${finding.expected || '—'}, actual ${finding.actual || '—'}.`;
  const sources = [...(finding.sources ?? [])];
  if (screen.expectedFrame && !sources.some((s) => s.kind === 'figma')) {
    sources.push({ kind: 'figma', ref: screen.expectedFrame });
  }
  const evidence = [screen.actualScreenshot, screen.expectedFrame].filter(Boolean) as string[];
  const label = finding.component
    ? `${finding.severity.toUpperCase()} · ${finding.component} — ${finding.category}/${finding.dimension}`
    : `${finding.severity.toUpperCase()} · ${finding.category}/${finding.dimension} — ${finding.screen || screen.screen}`;
  return explainArtifact({
    artifactKind: 'visual_finding',
    artifactLabel: label,
    node: 'execution',
    sources,
    versions,
    evidence,
    reason,
    citationContext,
  });
}
