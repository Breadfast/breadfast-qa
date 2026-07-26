/**
 * Run Lifecycle Management — Verification Harness.
 *
 * Exercises the compiled Milestones A-F against the REAL local SQLite via the
 * REAL RunsService (same pattern as phase1-validate.mjs) — no mocks, no Claude
 * calls (out of scope for headless verification; every deterministic and
 * persistence path is covered). Central claim under test: resuming a run
 * never depends on anything held in a process's memory — only on what's
 * persisted. That's proven directly by calling buildRunContext against a
 * FRESH prisma.run.findUnique() read, not anything carried over in this
 * script's own variables from an earlier step.
 *
 *   npm run build && node --test scripts/verify-run-lifecycle.mjs
 */
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildRunContext, buildActivityTimeline } from '../packages/shared/dist/index.js';
import { prisma } from '../packages/db/dist/index.js';
import { RunsService } from '../apps/api/dist/runs/runs.service.js';
import { EventsBus } from '../apps/api/dist/runs/events.bus.js';

const TAG = 'rlmval';

async function seedStory(svc, suffix) {
  const uid = `${TAG}-u-${process.pid}-${suffix}`;
  const pid = `${TAG}-p-${process.pid}-${suffix}`;
  const jiraKey = `${TAG.toUpperCase()}-${process.pid}-${suffix}`;
  await prisma.user.create({ data: { id: uid, googleSub: uid, email: `${uid}@x.io`, name: 'Val' } });
  await prisma.project.create({ data: { id: pid, jiraKey: `${TAG}${process.pid}${suffix}`, name: 'Val' } });
  const story = await prisma.story.create({
    data: { jiraKey, title: 'Verify story', platform: 'cross-platform', locales: 'en-US,ar-EG', ownerId: uid, projectId: pid },
  });
  const run = await svc.createRun(story.id, uid);
  return { uid, pid, jiraKey, story, run };
}

async function teardown({ uid, pid, jiraKey, run }) {
  await prisma.run.delete({ where: { id: run.id } }).catch(() => {});
  await prisma.story.deleteMany({ where: { jiraKey } }).catch(() => {});
  await prisma.project.deleteMany({ where: { id: pid } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: uid } }).catch(() => {});
}

// ── 1. Context Builder fallback guarantee ───────────────────────────────────
test('1. Context Builder — reconstructs state purely from a FRESH DB read, no in-process memory', async () => {
  const svc = new RunsService(new EventsBus());
  const seed = await seedStory(svc, 'ctx');
  try {
    const { run } = seed;
    const reqStep = run.steps.find((s) => s.name === 'requirements_analysis');
    const figmaStep = run.steps.find((s) => s.name === 'figma_analysis');

    // Simulate two nodes succeeding — exactly what the API persists mid-run.
    await svc.ingest({
      kind: 'step.finished', runId: run.id, stepId: reqStep.id, status: 'succeeded',
      output: { businessObjective: 'Verify resume', workspacePath: 'D:/ws/VERIFY' },
      tokens: 100, costUsd: 0.01, at: new Date().toISOString(),
    });
    await svc.ingest({
      kind: 'step.finished', runId: run.id, stepId: figmaStep.id, status: 'succeeded',
      output: { fileKey: 'abc123', frames: [{ name: 'Home', file: 'figma/home.png' }] },
      tokens: 200, costUsd: 0.02, at: new Date().toISOString(),
    });

    // The critical step: re-fetch from a FRESH query (nothing reused from
    // above) — this is exactly what a brand-new worker process does on claim,
    // whether it's the SAME process resuming or a completely different one.
    const fresh = await prisma.run.findUnique({
      where: { id: run.id },
      include: { steps: { orderBy: { ordinal: 'asc' } }, story: true },
    });
    const state = buildRunContext(fresh);

    assert.equal(state.workspacePath, 'D:/ws/VERIFY', 'workspacePath recovered from persisted output, not memory');
    assert.deepEqual(state.requirements, { businessObjective: 'Verify resume', workspacePath: 'D:/ws/VERIFY' }, 'requirements_analysis output recovered');
    assert.deepEqual(state.figma, { fileKey: 'abc123', frames: [{ name: 'Home', file: 'figma/home.png' }] }, 'figma_analysis output recovered');
    assert.equal(state.story.jiraKey, seed.jiraKey, 'story facts recovered');

    // A step that never succeeded contributes nothing — proving this isn't
    // "replay everything," only what was actually, durably persisted.
    const hlsKeyPresent = 'hls' in state;
    assert.equal(hlsKeyPresent, false, 'un-run steps contribute no state');
  } finally {
    await teardown(seed);
    await prisma.$disconnect();
  }
});

// ── 2. Manual Pause + generalized Resume ────────────────────────────────────
test('2. Manual Pause — pauses cleanly, generalized Resume requeues without resetting anything', async () => {
  const svc = new RunsService(new EventsBus());
  const seed = await seedStory(svc, 'pause');
  try {
    const { run } = seed;
    await prisma.run.update({ where: { id: run.id }, data: { status: 'running' } });

    const paused = await svc.pauseRun(run.id);
    assert.equal(paused.status, 'pausing', 'running run enters the graceful pausing state, not an immediate stop');

    // Simulate the worker's boundary check finalizing the pause (what
    // runner.ts's isPausing() branch does once the in-flight step finishes).
    await svc.ingest({ kind: 'run.status', runId: run.id, status: 'paused', at: new Date().toISOString() });
    const afterPause = await prisma.run.findUnique({ where: { id: run.id } });
    assert.equal(afterPause.status, 'paused');
    assert.equal(afterPause.pauseReason, 'manual', 'pauseReason set by pauseRun survives the worker\'s finalizing event');

    const resumed = await svc.resumeRun(run.id);
    assert.equal(resumed.resumed, true);
    const afterResume = await prisma.run.findUnique({ where: { id: run.id } });
    assert.equal(afterResume.status, 'queued', 'manual-pause resume is a pure requeue');
    assert.equal(afterResume.pauseReason, null, 'pauseReason cleared on resume');

    const events = await prisma.runStatusEvent.findMany({ where: { runId: run.id }, orderBy: { at: 'asc' } });
    const kinds = events.map((e) => `${e.status}:${e.reason ?? ''}`);
    assert.ok(kinds.includes('pausing:manual'));
    assert.ok(kinds.includes('paused:manual'));
    assert.ok(kinds.includes('queued:resume'));

    const timeline = buildActivityTimeline({
      run: { createdAt: run.createdAt, status: afterResume.status },
      steps: [],
      statusEvents: events.map((e) => ({ status: e.status, reason: e.reason, at: e.at })),
    });
    assert.ok(timeline.events.some((e) => e.kind === 'run_paused'), 'Activity Timeline records the pause');
    assert.ok(timeline.events.some((e) => e.kind === 'run_resumed'), 'Activity Timeline records the resume');
  } finally {
    await teardown(seed);
    await prisma.$disconnect();
  }
});

// ── 3. Failure Recovery + Retry Failed Step (single + bulk) ─────────────────
test('3. Retry Failed Step — resets ONLY the failed step, increments attempt, leaves everything else', async () => {
  const svc = new RunsService(new EventsBus());
  const seed = await seedStory(svc, 'retry');
  try {
    const { run } = seed;
    const reqStep = run.steps.find((s) => s.name === 'requirements_analysis');

    // Session Continuity: a node call persists its session id via ingest().
    await svc.ingest({ kind: 'run.session', runId: run.id, sessionId: 'sess-abc', at: new Date().toISOString() });
    assert.equal((await prisma.run.findUnique({ where: { id: run.id } })).engineSession, 'sess-abc');

    await svc.ingest({
      kind: 'step.finished', runId: run.id, stepId: reqStep.id, status: 'failed',
      error: { message: 'claude run timed out after 600000ms', isTimeout: true, durationMs: 600000 },
      at: new Date().toISOString(),
    });
    await svc.ingest({ kind: 'run.status', runId: run.id, status: 'failed', at: new Date().toISOString() });

    const failedStep = await prisma.runStep.findUnique({ where: { id: reqStep.id } });
    assert.equal(failedStep.status, 'failed');
    assert.deepEqual(failedStep.errorJson, { message: 'claude run timed out after 600000ms', isTimeout: true, durationMs: 600000 });
    assert.equal(failedStep.attempt, 1);

    const result = await svc.retryStep(reqStep.id, seed.uid);
    assert.equal(result.retried, true);
    assert.equal(result.attempt, 2);

    const retried = await prisma.runStep.findUnique({ where: { id: reqStep.id } });
    assert.equal(retried.status, 'pending');
    assert.equal(retried.attempt, 2, 'attempt incremented on Retry (not on a plain Restart)');
    const afterRetry = await prisma.run.findUnique({ where: { id: run.id } });
    assert.equal(afterRetry.status, 'queued');
    assert.equal(afterRetry.engineSession, 'sess-abc', 'Retry Failed Step touches only the one step — nothing downstream ran, so the shared session is left intact');

    // Retrying a step that isn't failed/interrupted is rejected.
    await assert.rejects(() => svc.retryStep(run.steps.find((s) => s.name === 'fetch_jira').id, seed.uid));
  } finally {
    await teardown(seed);
    await prisma.$disconnect();
  }
});

test('4. Bulk Retry Failed Steps — retries across multiple runs, reports per-run outcomes', async () => {
  const svc = new RunsService(new EventsBus());
  const seedA = await seedStory(svc, 'bulkA');
  const seedB = await seedStory(svc, 'bulkB');
  try {
    for (const seed of [seedA, seedB]) {
      const step = seed.run.steps.find((s) => s.name === 'requirements_analysis');
      await svc.ingest({
        kind: 'step.finished', runId: seed.run.id, stepId: step.id, status: 'failed',
        error: { message: 'boom', isTimeout: false, durationMs: 10 }, at: new Date().toISOString(),
      });
      await svc.ingest({ kind: 'run.status', runId: seed.run.id, status: 'failed', at: new Date().toISOString() });
    }
    const { results } = await svc.retryFailedRuns([seedA.run.id, seedB.run.id, 'does-not-exist'], seedA.uid);
    assert.equal(results.filter((r) => r.ok).length, 2, 'both real runs retried');
    assert.equal(results.find((r) => r.runId === 'does-not-exist').ok, false, 'unknown run reported, not thrown/swallowed');
  } finally {
    await teardown(seedA);
    await teardown(seedB);
    await prisma.$disconnect();
  }
});

// ── 5. Restart From Any Step (incl. already-succeeded) + artifact/JSON clearing ─
test('5. Restart From Step — discards downstream output/tokens/parity, keeps upstream intact', async () => {
  const svc = new RunsService(new EventsBus());
  const seed = await seedStory(svc, 'restart');
  try {
    const { run } = seed;
    const fetchStep = run.steps.find((s) => s.name === 'fetch_jira');
    const reqStep = run.steps.find((s) => s.name === 'requirements_analysis');
    const acStep = run.steps.find((s) => s.name === 'acceptance_criteria');

    await svc.ingest({
      kind: 'step.finished', runId: run.id, stepId: fetchStep.id, status: 'succeeded',
      output: { title: 'Story' }, tokens: 10, costUsd: 0.001, at: new Date().toISOString(),
    });
    await svc.ingest({
      kind: 'step.finished', runId: run.id, stepId: reqStep.id, status: 'succeeded',
      output: { businessObjective: 'x' }, tokens: 50, costUsd: 0.01, at: new Date().toISOString(),
    });
    await svc.ingest({
      kind: 'step.finished', runId: run.id, stepId: acStep.id, status: 'succeeded',
      output: { criteria: [{ id: 'AC-1', text: 'y' }] }, tokens: 60, costUsd: 0.02, at: new Date().toISOString(),
    });
    await prisma.run.update({ where: { id: run.id }, data: { parityJson: { score: 90 }, engineSession: 'sess-before-restart' } });

    // Restart from requirements_analysis (ordinal 3): fetch_jira (ordinal 1)
    // must stay untouched; requirements_analysis + acceptance_criteria must
    // be wiped back to pending with their output/tokens/parity cleared.
    const restarted = await svc.restartFromStep(reqStep.id, 'try again with more detail', seed.uid);
    assert.equal(restarted.restarted, true);
    assert.equal(restarted.from, 'requirements_analysis');

    const [fetchAfter, reqAfter, acAfter, runAfter] = await Promise.all([
      prisma.runStep.findUnique({ where: { id: fetchStep.id } }),
      prisma.runStep.findUnique({ where: { id: reqStep.id } }),
      prisma.runStep.findUnique({ where: { id: acStep.id } }),
      prisma.run.findUnique({ where: { id: run.id } }),
    ]);
    assert.equal(fetchAfter.status, 'succeeded', 'upstream step untouched by a downstream restart');
    assert.deepEqual(fetchAfter.outputJson, { title: 'Story' });

    assert.equal(reqAfter.status, 'pending');
    assert.equal(reqAfter.outputJson, null, 'restarted step\'s stale output cleared');
    assert.equal(reqAfter.feedback, 'try again with more detail');
    assert.equal(acAfter.status, 'pending');
    assert.equal(acAfter.outputJson, null, 'downstream step\'s stale output cleared too');

    assert.equal(runAfter.status, 'queued');
    assert.equal(runAfter.totalTokens, 10, 'rollup recomputed from the ONE step that remains (fetch_jira)');
    assert.equal(runAfter.parityJson, null, 'stale pre-restart parity snapshot cleared (range precedes html_report)');
    assert.equal(runAfter.engineSession, null, 'Session Continuity: a restart discards downstream turns the shared session would still remember, so it is cleared too');

    // Restarting while a worker owns the run is refused.
    await prisma.run.update({ where: { id: run.id }, data: { status: 'running' } });
    await assert.rejects(() => svc.restartFromStep(reqStep.id, undefined, seed.uid));
  } finally {
    await teardown(seed);
    await prisma.$disconnect();
  }
});

test('6. Artifact versioning — a second write for the same logical name gets its own version, first file untouched', async () => {
  const svc = new RunsService(new EventsBus());
  const seed = await seedStory(svc, 'artifact');
  try {
    const { run } = seed;
    const v1 = await svc.nextArtifactVersion(run.id, 'hls/hls.md');
    assert.equal(v1.version, 1, 'first write is version 1');
    await svc.recordArtifact(run.id, { kind: 'evidence', name: 'hls/hls.md', version: 1, localPath: '/ws/hls/hls.md' });

    const v2 = await svc.nextArtifactVersion(run.id, 'hls/hls.md');
    assert.equal(v2.version, 2, 'a Restart-triggered re-write is offered the NEXT version, not asked to overwrite v1');
    await svc.recordArtifact(run.id, { kind: 'evidence', name: 'hls/hls.md', version: 2, localPath: '/ws/hls/hls.v2.md' });

    const rows = await prisma.artifact.findMany({ where: { storyId: seed.story.id, name: 'hls/hls.md' }, orderBy: { version: 'asc' } });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].localPath, '/ws/hls/hls.md', 'version 1\'s file path is never touched by version 2');
    assert.equal(rows[1].localPath, '/ws/hls/hls.v2.md');

    // A DIFFERENT artifact name starts its own version sequence at 1.
    const other = await svc.nextArtifactVersion(run.id, 'testcases/cases.csv');
    assert.equal(other.version, 1);
  } finally {
    await teardown(seed);
    await prisma.$disconnect();
  }
});

// ── 7. Paused-run queue ──────────────────────────────────────────────────────
test('7. Paused-run queue — surfaces interrupted runs across stories with their blocking step', async () => {
  const svc = new RunsService(new EventsBus());
  const seed = await seedStory(svc, 'queue');
  try {
    const { run } = seed;
    const reqStep = run.steps.find((s) => s.name === 'requirements_analysis');
    await svc.ingest({
      kind: 'step.finished', runId: run.id, stepId: reqStep.id, status: 'failed',
      error: { message: 'boom', isTimeout: false, durationMs: 5 }, at: new Date().toISOString(),
    });
    await svc.ingest({ kind: 'run.status', runId: run.id, status: 'failed', at: new Date().toISOString() });

    const queue = await svc.listInterrupted();
    const row = queue.find((r) => r.id === run.id);
    assert.ok(row, 'the failed run appears in the queue');
    assert.equal(row.story.jiraKey, seed.jiraKey);
    assert.equal(row.blockingStep.name, 'requirements_analysis');
    assert.equal(row.blockingStep.status, 'failed');
  } finally {
    await teardown(seed);
    await prisma.$disconnect();
  }
});
