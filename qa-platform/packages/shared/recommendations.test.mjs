/**
 * Recommendation Engine tests (Phase 2 M5) — deterministic + rule-based, 0 AI.
 *   npm run build -w @qa/shared && node --test packages/shared/recommendations.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRecommendations, RECOMMENDATION_CATEGORIES,
  computeParityCertification, computeReviewConfidence, computeStoryHealth,
} from './dist/index.js';

// A run with several concrete gaps to recommend against.
const evalInput = {
  platform: 'web', locales: ['en-US'], enabledNodes: null,
  completedNodes: ['requirements_analysis', 'acceptance_criteria', 'generate_testcases', 'execution'],
  acceptanceCriteria: { criteria: [{ id: 'AC-1', testable: true }, { id: 'AC-2', testable: true }] },
  testCases: { cases: [{ title: 'T1', automationStatus: 'Not Automated', sources: [{ kind: 'ac', ref: 'AC-1' }] }] },
  execution: { executed: true, matrix: ['web · en-US'], summary: { total: 2, passed: 1 }, cases: [{ status: 'pass', combo: 'web · en-US', evidence: ['s.png'] }] },
  figmaFrameCount: 2,
  visual: { comparedScreens: 1, screens: [{ combo: 'web · en-US', verdict: 'major' }] },
};

// Visual comparison with a recurring design-system pattern (M3.5) + one-off finding.
const visual = {
  compared: true, expectedFrames: 2, comparedScreens: 2, passRate: 0, categoriesCovered: ['typography'],
  componentsAffected: ['Primary Button'],
  patterns: [{
    key: 'typography|sentence-case|Primary Button|typography:type/button/label',
    title: 'Primary Button affecting 5 screens', category: 'typography', dimension: 'sentence-case',
    component: 'Primary Button', token: { kind: 'typography', name: 'type/button/label' },
    severity: 'major', occurrences: 5, screens: ['A', 'B', 'C', 'D', 'E'],
    rootCause: 'The Primary Button uses the wrong typography token.',
    recommendation: 'Update the typography token used by the shared Primary Button component.',
  }],
  // 5 sentence-case findings (the pattern) + 1 one-off color finding = 6 total,
  // so one-off = 6 − 5 = 1 (consistent with patterns[0].occurrences = 5).
  screens: [
    { screen: 'A', verdict: 'major', findings: [
      { category: 'typography', dimension: 'sentence-case', severity: 'major' },
      { category: 'typography', dimension: 'sentence-case', severity: 'major' },
      { category: 'typography', dimension: 'sentence-case', severity: 'major' },
      { category: 'typography', dimension: 'sentence-case', severity: 'major' },
      { category: 'typography', dimension: 'sentence-case', severity: 'major' },
    ] },
    { screen: 'B', verdict: 'minor', findings: [{ category: 'color', dimension: 'text-color', severity: 'minor' }] },
  ],
};

function build(extra = {}) {
  const parity = computeParityCertification(evalInput);
  const review = computeReviewConfidence(evalInput);
  const health = computeStoryHealth(evalInput, parity, review, { visualHealth: null, defects: extra.defects ?? [] });
  return computeRecommendations({ parity, review, health, visual, visualHealth: null, testCases: evalInput.testCases, ...extra });
}

test('recommendations are deterministic (same input ⇒ same output + order)', () => {
  const a = build();
  const b = build();
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.ok(a.length >= 3, 'multiple recommendations generated');
});

test('every recommendation carries the required, well-formed fields', () => {
  for (const r of build()) {
    assert.ok(r.id && r.title && r.rootCause, 'id/title/rootCause');
    assert.ok(RECOMMENDATION_CATEGORIES.includes(r.category), `valid category: ${r.category}`);
    assert.ok(['critical', 'major', 'minor', 'info'].includes(r.severity));
    for (const m of [r.impact, r.effort, r.confidence]) assert.ok(['high', 'medium', 'low'].includes(m));
    assert.equal(typeof r.priorityScore, 'number');
    assert.ok(Array.isArray(r.actions) && Array.isArray(r.sources) && Array.isArray(r.derivedFrom));
    assert.ok(['deterministic', 'rule'].includes(r.layer));
  }
});

test('Layer 2: a recurring pattern becomes ONE root-cause Design System rec that clears many', () => {
  const recs = build();
  const ds = recs.find((r) => r.category === 'Design System');
  assert.ok(ds, 'design-system recommendation produced from the pattern');
  assert.equal(ds.eliminatesFindings, 5, 'one fix clears all 5 findings');
  assert.ok(/Primary Button/.test(ds.rootCause));
  assert.equal(ds.layer, 'rule');
  assert.equal(ds.confidence, 'high', 'occurrences ≥ 3 ⇒ high confidence');
});

test('fix-one-clear-many outranks one-off recommendations (deterministic priority)', () => {
  const recs = build();
  const ds = recs.find((r) => r.category === 'Design System');
  const oneOff = recs.find((r) => r.id === 'visual-one-off');
  assert.ok(ds && oneOff);
  assert.ok(ds.priorityScore > oneOff.priorityScore, 'root-cause rec prioritized above one-offs');
  // Sorted descending by priority.
  for (let i = 1; i < recs.length; i++) assert.ok(recs[i - 1].priorityScore >= recs[i].priorityScore, 'sorted by priority');
});

test('Layer 1: parity gaps produce coverage/automation recommendations', () => {
  const recs = build();
  assert.ok(recs.some((r) => r.category === 'Test Coverage' && r.sources.some((s) => s.kind === 'ac')), 'AC coverage rec with AC citations');
  assert.ok(recs.some((r) => r.category === 'Automation'), 'automation rec');
});

test('Layer 2: defects sharing a component collapse into one root-cause rec', () => {
  const recs = build({ defects: [
    { title: 'D1', severity: 'High', component: 'Dropdown' },
    { title: 'D2', severity: 'Medium', component: 'Dropdown' },
  ] });
  const shared = recs.find((r) => r.id.startsWith('defects-component-'));
  assert.ok(shared, 'shared-component defect rec');
  assert.equal(shared.eliminatesFindings, 2);
  assert.equal(shared.category, 'Regression');
});

test('AI Impact: the engine performs no async work (pure, 0 AI) — returns synchronously', () => {
  const out = build();
  assert.ok(Array.isArray(out), 'synchronous array, not a Promise');
});
