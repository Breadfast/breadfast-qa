/**
 * Activity Timeline tests (Phase 2 M6) — deterministic, 0 AI.
 *   npm run build -w @qa/shared && node --test packages/shared/activity.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildActivityTimeline } from './dist/index.js';

const T = (s) => `2026-07-15T10:${String(s).padStart(2, '0')}:00.000Z`;

const input = {
  run: { createdAt: T(0), startedAt: T(1), finishedAt: T(30), status: 'succeeded' },
  steps: [
    { name: 'requirements_analysis', type: 'ai', status: 'succeeded', ordinal: 1, startedAt: T(1), finishedAt: T(3) },
    { name: 'generate_hls', type: 'ai', status: 'succeeded', ordinal: 2, startedAt: T(3), finishedAt: T(5) },
    { name: 'gate_push_hls', type: 'gate', status: 'succeeded', ordinal: 3, startedAt: T(5), finishedAt: T(9),
      approval: { action: 'jira.push_hls', decision: 'approved', createdAt: T(6), decidedAt: T(8) } },
    { name: 'generate_testcases', type: 'ai', status: 'succeeded', ordinal: 4, startedAt: T(9), finishedAt: T(12),
      clarification: { createdAt: T(10), answeredAt: T(11) } },
    { name: 'execution', type: 'code', status: 'succeeded', ordinal: 5, startedAt: T(12), finishedAt: T(25) },
    { name: 'html_report', type: 'code', status: 'succeeded', ordinal: 6, startedAt: T(25), finishedAt: T(29) },
  ],
};

test('timeline is deterministic and chronologically ordered', () => {
  const a = buildActivityTimeline(input);
  const b = buildActivityTimeline(input);
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'deterministic');
  const ts = a.events.map((e) => e.ts).filter(Boolean);
  const sorted = [...ts].sort();
  assert.deepEqual(ts, sorted, 'events are in chronological order');
  assert.equal(a.events[0].kind, 'run_created');
  assert.equal(a.events[a.events.length - 1].kind, 'run_finished');
});

test('node durations + summary counts are computed', () => {
  const t = buildActivityTimeline(input);
  assert.equal(t.nodeCount, 6);
  assert.equal(t.completedCount, 6);
  assert.equal(t.failedCount, 0);
  assert.equal(t.gateCount, 1);
  const reqDone = t.events.find((e) => e.kind === 'node_finished' && e.node === 'requirements_analysis');
  assert.equal(reqDone.durationMs, 2 * 60 * 1000, 'requirements took 2 minutes');
  assert.equal(t.totalDurationMs, 29 * 60 * 1000, 'run start→finish = 29 minutes');
});

test('gate approvals and clarifications appear as events', () => {
  const t = buildActivityTimeline(input);
  assert.ok(t.events.some((e) => e.kind === 'gate_awaiting' && e.node === 'gate_push_hls'));
  assert.ok(t.events.some((e) => e.kind === 'gate_approved' && e.node === 'gate_push_hls'));
  assert.ok(t.events.some((e) => e.kind === 'clarification_asked' && e.node === 'generate_testcases'));
  assert.ok(t.events.some((e) => e.kind === 'clarification_answered' && e.node === 'generate_testcases'));
});

test('curated milestones summarize the run', () => {
  const t = buildActivityTimeline(input);
  const keys = t.milestones.map((m) => m.key);
  for (const k of ['created', 'requirements', 'testcases', 'execution', 'report', 'finished']) {
    assert.ok(keys.includes(k), `milestone ${k} present`);
  }
});

test('a failed step is surfaced and does not count as completed', () => {
  const t = buildActivityTimeline({
    run: { createdAt: T(0), startedAt: T(1), status: 'failed' },
    steps: [{ name: 'execution', type: 'code', status: 'failed', ordinal: 1, startedAt: T(1), finishedAt: T(4) }],
  });
  assert.equal(t.failedCount, 1);
  assert.equal(t.completedCount, 0);
  assert.ok(t.events.some((e) => e.kind === 'node_failed' && e.node === 'execution'));
});

test('in-progress run (no finishedAt) still builds; unresolved events sort last', () => {
  const t = buildActivityTimeline({
    run: { createdAt: T(0), startedAt: T(1), status: 'running' },
    steps: [
      { name: 'requirements_analysis', type: 'ai', status: 'succeeded', ordinal: 1, startedAt: T(1), finishedAt: T(3) },
      { name: 'generate_hls', type: 'ai', status: 'running', ordinal: 2, startedAt: T(3) },
    ],
  });
  assert.equal(t.totalDurationMs, null, 'no total duration until finished');
  assert.ok(t.events.some((e) => e.kind === 'node_started' && e.node === 'generate_hls'));
  assert.ok(!t.events.some((e) => e.kind === 'run_finished'));
});
