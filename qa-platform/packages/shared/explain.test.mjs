/**
 * Explainability + Review Confidence tests (Phase 2 M2).
 *   npm run build -w @qa/shared && node --test packages/shared/explain.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainArtifact, computeReviewConfidence } from './dist/index.js';

const ctx = { jiraBaseUrl: 'https://x.atlassian.net', storyKey: 'B10-1', acById: { 'AC-1': 'redeem' }, figmaFileKey: 'F1' };

test('explainArtifact groups contributions and derives a reason', () => {
  const e = explainArtifact({
    artifactKind: 'test_case', artifactLabel: 'Verify redeem', node: 'generate_testcases',
    sources: [{ kind: 'ac', ref: 'AC-1' }, { kind: 'figma', ref: 'Checkout' }, { kind: 'comment', ref: '9' }],
    versions: { prompt: '1.1.0', workflow: '1.0.0' }, citationContext: ctx,
  });
  assert.equal(e.contributed.acceptanceCriteria.length, 1);
  assert.equal(e.contributed.figmaFrames.length, 1);
  assert.equal(e.contributed.storyComments.length, 1);
  assert.equal(e.contributed.acceptanceCriteria[0].title, 'redeem');
  assert.ok(e.reason.includes('STEP 6'));
  assert.equal(e.versions.prompt, '1.1.0');
});

test('explainArtifact accepts an explicit reason (M3 visual-finding shape)', () => {
  const e = explainArtifact({
    artifactKind: 'visual_finding', artifactLabel: 'Checkout button', node: 'execution',
    reason: 'Button label uses sentence case instead of title case',
    sources: [{ kind: 'figma', ref: 'Checkout' }, { kind: 'ac', ref: 'AC-1' }], citationContext: ctx,
  });
  assert.equal(e.reason, 'Button label uses sentence case instead of title case');
  assert.equal(e.contributed.figmaFrames[0].label, 'Figma: Checkout');
});

const fullInput = {
  platform: 'web', locales: ['en-US'], enabledNodes: null,
  completedNodes: ['requirements_analysis', 'acceptance_criteria', 'comments_analysis', 'figma_analysis',
    'generate_testcases', 'gate_upload_browserstack', 'automation_generation', 'execution', 'html_report', 'gate_file_bugs'],
  acceptanceCriteria: { criteria: [{ id: 'AC-1', testable: true }] },
  testCases: { cases: [{ title: 'T1', sources: [{ kind: 'ac', ref: 'AC-1' }] }] },
  execution: { executed: true, summary: { total: 1, passed: 1 }, cases: [{ status: 'pass', combo: 'web · en-US', evidence: ['s.png'] }] },
  figmaFrameCount: 3, visual: { comparedScreens: 3 }, automation: { specsWritten: 2 },
};

test('Review Confidence is high when all evidence is present', () => {
  const r = computeReviewConfidence(fullInput);
  assert.equal(r.level, 'high');
  assert.equal(r.score, 100);
  assert.deepEqual(r.reductions, []);
});

test('Review Confidence is deterministic and reproducible', () => {
  assert.equal(JSON.stringify(computeReviewConfidence(fullInput)), JSON.stringify(computeReviewConfidence(fullInput)));
});

test('Review Confidence drops with clear reductions when evidence is missing', () => {
  const r = computeReviewConfidence({
    ...fullInput,
    completedNodes: ['requirements_analysis'],
    figmaFrameCount: 0, visual: null, automation: { specsWritten: 0 },
    execution: { executed: false },
  });
  assert.ok(r.score < 100);
  assert.ok(r.reductions.includes('Missing Figma analysis (no frames)'));
  assert.ok(r.reductions.includes('Automation not executed'));
});

test('signals not applicable (disabled phases) do not reduce confidence', () => {
  // Only requirements enabled → everything else is inapplicable, so a completed
  // requirements analysis yields full confidence over the applicable set.
  const r = computeReviewConfidence({
    platform: 'web', locales: ['en-US'],
    enabledNodes: ['requirements_analysis'],
    completedNodes: ['requirements_analysis'],
    acceptanceCriteria: null, testCases: null, execution: null,
  });
  assert.equal(r.level, 'high');
  // 'traceability' is always applicable and unmet here → not a perfect 100.
  assert.ok(r.reductions.length <= 1);
});
