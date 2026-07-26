/**
 * Visual Testing Intelligence — deterministic layer tests (Phase 2 M3).
 *   npm run build -w @qa/shared && node --test packages/shared/visual.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VISUAL_CHECKS, VISUAL_CATEGORIES, visualChecksByCategory, computeVisualHealth, explainVisualFinding,
  detectVisualPatterns, UI_COMPONENTS, DESIGN_TOKEN_KINDS } from './dist/index.js';

test('every visual category has at least one check', () => {
  const byCat = visualChecksByCategory();
  for (const cat of VISUAL_CATEGORIES) assert.ok(byCat[cat].length >= 1, `category ${cat} has no checks`);
  assert.ok(VISUAL_CHECKS.length >= 40, 'comprehensive checklist');
});

test('the user-mandated dimensions are all present in the checklist', () => {
  const dims = new Set(VISUAL_CHECKS.map((c) => c.dimension));
  for (const d of ['sentence-case', 'padding', 'margins', 'spacing', 'letter-spacing', 'line-height', 'font-weight',
    'corner-radius', 'item-ordering', 'component-visibility', 'disabled', 'loading-error-success-empty', 'contrast']) {
    assert.ok(dims.has(d), `missing check dimension: ${d}`);
  }
});

const comparison = {
  compared: true, expectedFrames: 3, comparedScreens: 3, passRate: 0, categoriesCovered: [],
  screens: [
    { screen: 'Checkout', combo: 'ios · en-US', expectedFrame: 'checkout.png', actualScreenshot: 'shot1.png', verdict: 'major',
      categoriesChecked: ['typography', 'content', 'color'],
      findings: [
        { category: 'typography', dimension: 'sentence-case', severity: 'major', screen: 'Checkout', expected: 'Add to cart', actual: 'Add To Cart', differenceDescription: 'Button label uses title case instead of the sentence case in Figma.', recommendation: 'Use sentence case.', confidence: 'high', sources: [{ kind: 'figma', ref: 'checkout' }] },
        { category: 'color', dimension: 'text-color', severity: 'minor', screen: 'Checkout', expected: '#111', actual: '#333', differenceDescription: 'Text color slightly off.', recommendation: '', confidence: 'medium', sources: [] },
      ] },
    { screen: 'Empty', combo: 'ios · en-US', verdict: 'pass', categoriesChecked: ['layout', 'states'], findings: [] },
    { screen: 'Loading', combo: 'ios · en-US', verdict: 'pass', categoriesChecked: ['states'], findings: [] },
  ],
};

test('computeVisualHealth aggregates deterministically', () => {
  const a = computeVisualHealth(comparison);
  const b = computeVisualHealth(comparison);
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'deterministic');
  assert.equal(a.screensValidated, 3);
  assert.equal(a.screensPassed, 2);
  assert.equal(a.screensFailed, 1);
  assert.equal(a.passRate, 67); // 2/3
  assert.equal(a.findingsBySeverity.major, 1);
  assert.equal(a.findingsBySeverity.minor, 1);
  assert.equal(a.findingsByCategory.typography, 1);
  assert.equal(a.totalFindings, 2);
  // health = 100 - (major 10 + minor 3) = 87
  assert.equal(a.visualHealth, 87);
  assert.equal(a.level, 'high');
  assert.ok(a.categoriesCovered.includes('typography'));
  assert.ok(a.coverage > 0 && a.coverage <= 100);
});

test('empty / no-comparison yields a safe zeroed health', () => {
  const h = computeVisualHealth(undefined);
  assert.equal(h.screensValidated, 0);
  assert.equal(h.passRate, 0);
  assert.equal(h.visualHealth, 100); // no findings ⇒ no penalty
});

test('explainVisualFinding produces a precise, self-explaining reason (M3 → M2)', () => {
  const f = comparison.screens[0].findings[0];
  const e = explainVisualFinding(f, comparison.screens[0], { prompt: '1.0.0' }, { figmaFileKey: 'F1' });
  assert.equal(e.artifactKind, 'visual_finding');
  assert.equal(e.reason, 'Button label uses title case instead of the sentence case in Figma.');
  assert.ok(e.contributed.figmaFrames.length >= 1, 'figma frame attached');
  assert.equal(e.versions.prompt, '1.0.0');
  assert.ok(e.evidence.includes('shot1.png') && e.evidence.includes('checkout.png'));
});

// ── M3.5 — Design-system awareness + pattern detection ──────────────────────
const dsComparison = {
  compared: true, expectedFrames: 3, comparedScreens: 3, passRate: 0, categoriesCovered: [], patterns: [], componentsAffected: [],
  screens: [
    { screen: 'Checkout', combo: 'ios · en-US', expectedFrame: 'checkout.png', actualScreenshot: 's1.png', verdict: 'major',
      categoriesChecked: ['typography'],
      findings: [{ category: 'typography', dimension: 'sentence-case', severity: 'major', screen: 'Checkout', component: 'Primary Button',
        token: { kind: 'typography', name: 'type/button/label', expected: 'sentence', actual: 'Title' },
        expected: 'Add to cart', actual: 'Add To Cart', differenceDescription: 'Title case used.', recommendation: '', confidence: 'high', sources: [] }] },
    { screen: 'Cart', combo: 'ios · en-US', expectedFrame: 'cart.png', actualScreenshot: 's2.png', verdict: 'major',
      categoriesChecked: ['typography'],
      findings: [{ category: 'typography', dimension: 'sentence-case', severity: 'minor', screen: 'Cart', component: 'Primary Button',
        token: { kind: 'typography', name: 'type/button/label', expected: 'sentence', actual: 'Title' },
        expected: 'Check out', actual: 'Check Out', differenceDescription: 'Title case used.', recommendation: '', confidence: 'high', sources: [] }] },
    { screen: 'Profile', combo: 'ios · en-US', expectedFrame: 'profile.png', actualScreenshot: 's3.png', verdict: 'minor',
      categoriesChecked: ['color'],
      findings: [{ category: 'color', dimension: 'text-color', severity: 'minor', screen: 'Profile',
        expected: '#111', actual: '#333', differenceDescription: 'Off by a shade.', recommendation: '', confidence: 'low', sources: [] }] },
  ],
};

test('the component + design-token vocabularies are exported and non-trivial', () => {
  assert.ok(UI_COMPONENTS.includes('Primary Button') && UI_COMPONENTS.includes('Dropdown'));
  assert.ok(UI_COMPONENTS.length >= 20, 'a real component vocabulary');
  for (const k of ['typography', 'color', 'spacing', 'layout', 'radius']) assert.ok(DESIGN_TOKEN_KINDS.includes(k));
});

test('detectVisualPatterns groups a recurring root cause across screens (deterministic)', () => {
  const a = detectVisualPatterns(dsComparison);
  const b = detectVisualPatterns(dsComparison);
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'deterministic');
  // The single one-off color finding is NOT a pattern (occurrences < 2).
  assert.equal(a.length, 1, 'one recurring pattern');
  const p = a[0];
  assert.equal(p.occurrences, 2, 'both button findings grouped');
  assert.deepEqual(p.screens, ['Cart', 'Checkout'], 'affected screens listed, sorted');
  assert.equal(p.severity, 'major', 'highest severity in the group wins');
  assert.equal(p.component, 'Primary Button');
  assert.equal(p.token.kind, 'typography');
  assert.ok(/affecting 2 screens/.test(p.title), 'human title');
  // Root-cause-level recommendation targets the shared component/token, not one screen.
  assert.ok(/token/i.test(p.recommendation) && /Primary Button/.test(p.recommendation), p.recommendation);
});

test('computeVisualHealth surfaces components affected + pattern count', () => {
  const h = computeVisualHealth(dsComparison);
  assert.deepEqual(h.componentsAffected, ['Primary Button']);
  assert.equal(h.patternCount, 1);
});

test('explainVisualFinding leads with the design-system framing when a component/token is present', () => {
  const f = dsComparison.screens[0].findings[0];
  const e = explainVisualFinding(f, dsComparison.screens[0], { prompt: '1.1.0' });
  assert.ok(e.reason.startsWith('Primary Button uses the wrong typography token:'), e.reason);
  assert.ok(e.artifactLabel.includes('Primary Button'), 'component in label');
});

// ── VT1-S2 — coverage-gap as a first-class, non-penalizing result ────────────
test('VT1-S2: coverage-gap screens do not tank Visual Health and are counted separately', () => {
  const vc = {
    compared: true, expectedFrames: 2, comparedScreens: 1, passRate: 100,
    categoriesCovered: ['content'], patterns: [], componentsAffected: [], notes: '',
    screens: [
      { screen: 'Home', combo: 'web · en-US', verdict: 'pass', categoriesChecked: ['content'], findings: [] },
      { screen: 'Unmapped', combo: 'web · en-US', verdict: 'coverage-gap', categoriesChecked: [],
        findings: [{ category: 'content', dimension: 'frame-pairing', severity: 'info', screen: 'Unmapped',
          source: 'deterministic', layer: 'identity', coverageGap: true,
          expected: 'x', actual: 'y', differenceDescription: 'z', recommendation: 'w', confidence: 'high', sources: [] }] },
    ],
  };
  const h = computeVisualHealth(vc);
  assert.equal(h.screensValidated, 1, 'coverage-gap excluded from validated');
  assert.equal(h.screensPassed, 1);
  assert.equal(h.screensCoverageGap, 1, 'coverage gap counted separately');
  assert.equal(h.passRate, 100, 'gap not in pass-rate denominator');
  assert.equal(h.visualHealth, 100, 'coverage gap does not penalize health');
  assert.equal(h.totalFindings, 0, 'coverage-gap notice is not a real finding');
  assert.equal(h.findingsBySeverity.info, 0, 'gap finding excluded from severity tally');
});

test('VT1-S2: detectVisualPatterns ignores coverage-gap findings', () => {
  const vc = { screens: [
    { screen: 'A', verdict: 'coverage-gap', findings: [{ category: 'content', dimension: 'frame-pairing', severity: 'info', screen: 'A', coverageGap: true, sources: [] }] },
    { screen: 'B', verdict: 'coverage-gap', findings: [{ category: 'content', dimension: 'frame-pairing', severity: 'info', screen: 'B', coverageGap: true, sources: [] }] },
  ] };
  assert.deepEqual(detectVisualPatterns(vc), [], 'two gap notices must NOT form a "frame-pairing" pattern');
});
