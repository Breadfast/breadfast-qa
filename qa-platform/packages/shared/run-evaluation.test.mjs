/**
 * Run Evaluation / Parity Certification tests (Phase 1 #5).
 *   npm run build -w @qa/shared && node --test packages/shared/run-evaluation.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeParityCertification, computeReviewConfidence, computeStoryHealth, requiredCombos, buildWorkflowDefinition, resolveRunVersions } from './dist/index.js';

test('requiredCombos expands cross-platform × locales', () => {
  const c = requiredCombos('cross-platform', ['en-US', 'ar-EG']);
  assert.deepEqual(c.sort(), ['android · ar-EG', 'android · en-US', 'ios · ar-EG', 'ios · en-US'].sort());
});

test('requiredCombos for web × one locale', () => {
  assert.deepEqual(requiredCombos('web', ['en-US']), ['web · en-US']);
});

test('fully-covered run certifies', () => {
  const p = computeParityCertification({
    platform: 'web',
    locales: ['en-US'],
    enabledNodes: null,
    completedNodes: [
      'requirements_analysis', 'acceptance_criteria', 'comments_analysis', 'linked_stories',
      'figma_analysis', 'impact_analysis', 'generate_hls', 'generate_testcases',
      'exploratory_testing', 'automation_generation', 'execution',
    ],
    acceptanceCriteria: { criteria: [{ id: 'AC-1', testable: true }] },
    testCases: { cases: [{ title: 'T1', automationStatus: 'Automated', sources: [{ kind: 'ac', ref: 'AC-1' }] }] },
    execution: { matrix: ['web · en-US'], summary: { total: 1, passed: 1 } },
    figmaFrameCount: 0,
  });
  assert.equal(p.certification, 'certified');
  assert.equal(p.score, 100);
  assert.deepEqual(p.missingAcCoverage, []);
  assert.deepEqual(p.missingWorkflowStages, []);
  assert.deepEqual(p.executedCombos, ['web · en-US']);
});

test('missing combos + uncovered AC drop the score and certification', () => {
  const p = computeParityCertification({
    platform: 'cross-platform',
    locales: ['en-US', 'ar-EG'],
    completedNodes: ['requirements_analysis'],
    acceptanceCriteria: { criteria: [{ id: 'AC-1', testable: true }, { id: 'AC-2', testable: true }] },
    testCases: { cases: [{ title: 'T1', sources: [{ kind: 'ac', ref: 'AC-1' }] }] },
    execution: { matrix: ['android · en-US'], summary: { total: 1, passed: 1 } },
    figmaFrameCount: 4,
  });
  assert.notEqual(p.certification, 'certified');
  assert.ok(p.missingAcCoverage.includes('AC-2'));
  assert.ok(p.executedCombos.length < p.requiredCombos.length);
  // figma frames existed but no visual comparison → all combos missing visual coverage
  assert.equal(p.missingVisualCoverage.length, p.requiredCombos.length);
  assert.ok(p.missingAutomationCoverage.includes('T1'));
});

test('AC coverage unmeasured when there are no citations (not reported as missing)', () => {
  const p = computeParityCertification({
    platform: 'web',
    locales: ['en-US'],
    completedNodes: ['execution'],
    acceptanceCriteria: { criteria: [{ id: 'AC-1', testable: true }] },
    testCases: { cases: [{ title: 'T1' }] }, // no sources
    execution: { matrix: ['web · en-US'], summary: { total: 1, passed: 1 } },
  });
  assert.deepEqual(p.missingAcCoverage, []);
  assert.ok(p.notes.includes('AC↔case citations unavailable'));
});

// ── Story Health (M4) ────────────────────────────────────────────────────────
const HEALTHY_INPUT = {
  platform: 'web', locales: ['en-US'], enabledNodes: null,
  completedNodes: ['requirements_analysis', 'acceptance_criteria', 'generate_testcases', 'execution'],
  acceptanceCriteria: { criteria: [{ id: 'AC-1', testable: true }] },
  testCases: { cases: [{ title: 'T1', automationStatus: 'Automated', sources: [{ kind: 'ac', ref: 'AC-1' }] }] },
  execution: { executed: true, matrix: ['web · en-US'], summary: { total: 4, passed: 4 }, cases: [{ status: 'pass', combo: 'web · en-US', evidence: ['s.png'] }] },
  figmaFrameCount: 0,
};

test('computeStoryHealth rolls up six dimensions and is deterministic', () => {
  const parity = computeParityCertification(HEALTHY_INPUT);
  const review = computeReviewConfidence(HEALTHY_INPUT);
  const a = computeStoryHealth(HEALTHY_INPUT, parity, review, { visualHealth: { visualHealth: 90, screensValidated: 3 }, defects: [] });
  const b = computeStoryHealth(HEALTHY_INPUT, parity, review, { visualHealth: { visualHealth: 90, screensValidated: 3 }, defects: [] });
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'deterministic');
  assert.equal(a.dimensions.length, 6);
  assert.deepEqual(a.dimensions.map((d) => d.key), ['requirements', 'coverage', 'execution', 'visual', 'defects', 'traceability']);
  // All six applicable here → all counted.
  assert.ok(a.dimensions.every((d) => d.applicable), 'all six applicable');
  assert.equal(a.dimensions.find((d) => d.key === 'execution').score, 100, '4/4 passed');
  assert.equal(a.dimensions.find((d) => d.key === 'visual').score, 90);
  assert.equal(a.dimensions.find((d) => d.key === 'traceability').score, 100, 'the one case carries a citation');
  assert.equal(a.level, 'high');
  assert.ok(a.score >= 80);
});

test('non-applicable dimensions are excluded from the score, never zeroed', () => {
  // No execution, no visual → those dimensions are n/a and must NOT drag the mean down.
  const input = {
    platform: 'web', locales: ['en-US'], enabledNodes: ['requirements_analysis', 'acceptance_criteria', 'generate_testcases'],
    completedNodes: ['requirements_analysis', 'acceptance_criteria', 'generate_testcases'],
    acceptanceCriteria: { criteria: [{ id: 'AC-1', testable: true }] },
    testCases: { cases: [{ title: 'T1', sources: [{ kind: 'ac', ref: 'AC-1' }] }] },
    execution: null, figmaFrameCount: 0,
  };
  const parity = computeParityCertification(input);
  const review = computeReviewConfidence(input);
  const h = computeStoryHealth(input, parity, review, {});
  assert.equal(h.dimensions.find((d) => d.key === 'execution').applicable, false);
  assert.equal(h.dimensions.find((d) => d.key === 'visual').applicable, false);
  assert.equal(h.dimensions.find((d) => d.key === 'defects').applicable, false);
  // Score is the mean of applicable dims only (requirements, coverage, traceability).
  const applic = h.dimensions.filter((d) => d.applicable);
  const mean = Math.round(applic.reduce((a, d) => a + d.score, 0) / applic.length);
  assert.equal(h.score, mean);
});

test('defects lower the Defects dimension by severity weight', () => {
  const parity = computeParityCertification(HEALTHY_INPUT);
  const review = computeReviewConfidence(HEALTHY_INPUT);
  const clean = computeStoryHealth(HEALTHY_INPUT, parity, review, { defects: [] });
  const buggy = computeStoryHealth(HEALTHY_INPUT, parity, review, { defects: [{ severity: 'Critical' }, { severity: 'Low' }] });
  assert.equal(clean.dimensions.find((d) => d.key === 'defects').score, 100);
  assert.equal(buggy.dimensions.find((d) => d.key === 'defects').score, 100 - 30 - 2); // Critical 30 + Low 2
  assert.ok(buggy.score < clean.score);
});

test('workflow definition + run versions are consistent', () => {
  const def = buildWorkflowDefinition(null);
  assert.equal(def.nodeCount, 27);
  assert.ok(def.requiredApprovals.includes('gate_push_hls'));
  assert.ok(def.requiredIntegrations.includes('browserstack'));
  const v = resolveRunVersions();
  assert.equal(v.workflowVersion, def.workflowVersion);
  assert.equal(v.promptVersion, def.promptVersion);
  assert.equal(v.knowledgeVersion, null); // placeholder
});

// ── VT1-S2 — a coverage-gap screen must not count as covering its combo ───────
test('VT1-S2: a combo covered only by a coverage-gap screen still counts as missing visual coverage', () => {
  const combos = requiredCombos('web', ['en-US']);
  const p = computeParityCertification({
    platform: 'web',
    locales: ['en-US'],
    completedNodes: ['requirements_analysis'],
    figmaFrameCount: 2,
    visual: { comparedScreens: 0, screens: [{ combo: combos[0], verdict: 'coverage-gap' }] },
  });
  assert.ok(p.missingVisualCoverage.includes(combos[0]), 'coverage-gap does not cover the combo');
});
