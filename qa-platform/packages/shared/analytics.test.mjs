/**
 * QA Analytics tests (Phase 3) — deterministic aggregation, 0 AI.
 *   npm run build -w @qa/shared && node --test packages/shared/analytics.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAnalytics } from './dist/index.js';

const T = (d) => `2026-07-${String(d).padStart(2, '0')}T10:00:00.000Z`;

const records = [
  { runId: 'r1', storyId: 's1', storyKey: 'B10-1', ownerId: 'u1', ownerName: 'Alice', status: 'succeeded', createdAt: T(1),
    costUsd: 0.5, tokens: 1000, parity: { score: 90, certification: 'certified' }, review: { score: 80, level: 'high' },
    health: { score: 88, level: 'high' }, recommendations: [{ category: 'Visual', severity: 'major' }, { category: 'Automation', severity: 'minor' }],
    defects: [{ severity: 'Critical', status: 'open' }, { severity: 'Minor', status: 'closed' }] },
  { runId: 'r2', storyId: 's1', storyKey: 'B10-1', ownerId: 'u1', ownerName: 'Alice', status: 'failed', createdAt: T(2),
    costUsd: 0.2, tokens: 500, parity: { score: 60, certification: 'partial' }, review: { score: 55, level: 'medium' },
    health: { score: 50, level: 'medium' }, recommendations: [{ category: 'Visual', severity: 'critical' }],
    defects: [{ severity: 'Critical', status: 'open' }] /* same story — must NOT double-count */ },
  { runId: 'r3', storyId: 's2', storyKey: 'B10-2', ownerId: 'u2', ownerName: 'Bob', status: 'succeeded', createdAt: T(3),
    costUsd: 1.0, tokens: 2000, parity: { score: 100, certification: 'certified' }, review: { score: 95, level: 'high' },
    health: { score: 92, level: 'high' }, recommendations: [], defects: [] },
];

test('computeAnalytics is deterministic', () => {
  assert.equal(JSON.stringify(computeAnalytics(records)), JSON.stringify(computeAnalytics(records)));
});

test('totals: stories deduped, success rate, cost/tokens summed', () => {
  const a = computeAnalytics(records);
  assert.equal(a.totals.stories, 2, 's1 counted once');
  assert.equal(a.totals.runs, 3);
  assert.equal(a.totals.completedRuns, 2);
  assert.equal(a.totals.successRate, 67); // 2/3
  assert.equal(a.totals.totalCostUsd, 1.7);
  assert.equal(a.totals.totalTokens, 3500);
});

test('defects deduped per story (not per run)', () => {
  const a = computeAnalytics(records);
  // s1 defects counted once (2), s2 none → total 2, open 1 (the Critical open).
  assert.equal(a.totals.totalDefects, 2);
  assert.equal(a.totals.openDefects, 1);
  assert.equal(a.defects.bySeverity.Critical, 1);
});

test('averages over runs that have the metric', () => {
  const a = computeAnalytics(records);
  assert.equal(a.averages.parity, Math.round((90 + 60 + 100) / 3));
  assert.equal(a.averages.storyHealth, Math.round((88 + 50 + 92) / 3));
});

test('distributions + recommendation category counts', () => {
  const a = computeAnalytics(records);
  assert.equal(a.distributions.parityCertification.certified, 2);
  assert.equal(a.distributions.parityCertification.partial, 1);
  assert.equal(a.recommendations.total, 3);
  assert.equal(a.recommendations.byCategory.Visual, 2);
  assert.equal(a.recommendations.byCategory.Automation, 1);
});

test('team insights grouped by owner, sorted by name', () => {
  const a = computeAnalytics(records);
  assert.deepEqual(a.team.map((t) => t.ownerName), ['Alice', 'Bob']);
  const alice = a.team.find((t) => t.ownerName === 'Alice');
  assert.equal(alice.runs, 2);
  assert.equal(alice.completedRuns, 1);
  assert.equal(alice.openDefects, 1); // s1's open Critical, counted once
  assert.equal(alice.avgParity, Math.round((90 + 60) / 2));
});

test('trend is chronological', () => {
  const a = computeAnalytics(records);
  assert.deepEqual(a.trend.map((p) => p.runId), ['r1', 'r2', 'r3']);
});

test('empty input yields safe zeros', () => {
  const a = computeAnalytics([]);
  assert.equal(a.totals.runs, 0);
  assert.equal(a.totals.successRate, 0);
  assert.equal(a.averages.parity, null);
  assert.deepEqual(a.team, []);
});
