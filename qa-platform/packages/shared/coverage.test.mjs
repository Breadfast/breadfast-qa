/**
 * Coverage Matrix tests (Phase 4) — deterministic, reuses parity, 0 AI.
 *   npm run build -w @qa/shared && node --test packages/shared/coverage.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCoverageMatrix } from './dist/index.js';

const stories = [
  {
    storyId: 's1', storyKey: 'B10-2', title: 'Second', platform: 'web', testCaseCount: 4,
    parity: {
      certification: 'partial', acCoverageRate: 0.5, comboCoverageRate: 0.5,
      requiredCombos: ['web · en-US', 'web · ar-EG'], executedCombos: ['web · en-US'],
      missingAcCoverage: ['AC-2'], missingAutomationCoverage: ['T1', 'T2'], missingVisualCoverage: ['web · ar-EG'],
    },
  },
  {
    storyId: 's2', storyKey: 'B10-1', title: 'First', platform: 'web', testCaseCount: 2,
    parity: {
      certification: 'certified', acCoverageRate: 1, comboCoverageRate: 1,
      requiredCombos: ['web · en-US'], executedCombos: ['web · en-US'],
      missingAcCoverage: [], missingAutomationCoverage: [], missingVisualCoverage: [],
    },
  },
  { storyId: 's3', storyKey: 'B10-3', title: 'No run', platform: 'web', testCaseCount: 0, parity: null },
];

test('computeCoverageMatrix is deterministic + sorted by story key', () => {
  const a = computeCoverageMatrix(stories);
  const b = computeCoverageMatrix(stories);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.deepEqual(a.rows.map((r) => r.storyKey), ['B10-1', 'B10-2', 'B10-3']);
});

test('per-story coverage derives from parity', () => {
  const m = computeCoverageMatrix(stories);
  const s1 = m.rows.find((r) => r.storyKey === 'B10-2');
  assert.equal(s1.acCoverage, 50);
  assert.equal(s1.comboCoverage, 50); // 1 of 2
  assert.equal(s1.automationCoverage, 50); // (4-2)/4
  assert.equal(s1.visualCoverage, 50); // (2-1)/2
  assert.equal(s1.certified, false);
  assert.ok(s1.gaps.length >= 3);
});

test('certified story shows full coverage', () => {
  const m = computeCoverageMatrix(stories);
  const s2 = m.rows.find((r) => r.storyKey === 'B10-1');
  assert.equal(s2.acCoverage, 100);
  assert.equal(s2.comboCoverage, 100);
  assert.equal(s2.automationCoverage, 100);
  assert.equal(s2.certified, true);
  assert.deepEqual(s2.gaps, []);
});

test('story without a parity-bearing run is safe (nulls, no crash)', () => {
  const m = computeCoverageMatrix(stories);
  const s3 = m.rows.find((r) => r.storyKey === 'B10-3');
  assert.equal(s3.acCoverage, null);
  assert.equal(s3.comboCoverage, 0);
  assert.equal(s3.automationCoverage, null);
});

test('overall roll-up + gap counts', () => {
  const m = computeCoverageMatrix(stories);
  assert.equal(m.overall.stories, 3);
  assert.equal(m.overall.storiesCertified, 1);
  assert.equal(m.gaps.storiesWithMissingAc, 1);
  assert.equal(m.gaps.storiesWithMissingAutomation, 1);
  assert.equal(m.gaps.storiesWithMissingVisual, 1);
});
