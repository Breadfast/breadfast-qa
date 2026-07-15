/**
 * Phase 2 Milestone 2 validation — Explainability + Review Confidence end-to-end
 * through the REAL API service against the local SQLite (no Claude/Jira).
 *   npm run build && node --test scripts/phase2-validate.mjs
 */
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeParityCertification, computeReviewConfidence, computeStoryHealth, computeRecommendations } from '../packages/shared/dist/index.js';
import { prisma } from '../packages/db/dist/index.js';
import { RunsService } from '../apps/api/dist/runs/runs.service.js';
import { EventsBus } from '../apps/api/dist/runs/events.bus.js';

const TAG = 'p2val';

test('M2 — explain() assembles artifacts + versions + citations + review confidence', async () => {
  const svc = new RunsService(new EventsBus());
  const uid = `${TAG}-u-${process.pid}`;
  const pid = `${TAG}-p-${process.pid}`;
  const jiraKey = `${TAG.toUpperCase()}-${process.pid}`;
  let runId;
  try {
    await prisma.user.create({ data: { id: uid, googleSub: uid, email: `${uid}@x.io`, name: 'V' } });
    await prisma.project.create({ data: { id: pid, jiraKey: `${TAG}${process.pid}`, name: 'V' } });
    const story = await prisma.story.create({
      data: { jiraKey, title: 'Explain story', platform: 'web', locales: 'en-US', ownerId: uid, projectId: pid },
    });
    const run = await svc.createRun(story.id, uid);
    runId = run.id;
    const step = (name) => run.steps.find((s) => s.name === name);
    const at = new Date().toISOString();

    // AC step output (so citation context resolves AC text).
    await svc.ingest({
      kind: 'step.finished', runId, stepId: step('acceptance_criteria').id, status: 'succeeded',
      output: { criteria: [{ id: 'AC-1', text: 'User can redeem a perk', testable: true }], gaps: [] }, at,
    });
    // Test cases with AC citations.
    await svc.ingest({
      kind: 'step.finished', runId, stepId: step('generate_testcases').id, status: 'succeeded',
      output: { cases: [{ title: 'Verify redeem', steps: [{ action: 'a', expectedResult: 'e' }], sources: [{ kind: 'ac', ref: 'AC-1' }] }] },
      tokens: 100, costUsd: 0.01, at,
    });
    // LLM Request Log for that node → explain picks up the prompt version that ran.
    await svc.logLlmRequest(runId, { runStepId: step('generate_testcases').id, node: 'generate_testcases', promptVersion: '1.1.0', status: 'ok' });

    // html_report with parity + review snapshots.
    const evalInput = {
      platform: 'web', locales: ['en-US'], completedNodes: ['acceptance_criteria', 'generate_testcases'],
      acceptanceCriteria: { criteria: [{ id: 'AC-1', testable: true }] },
      testCases: { cases: [{ title: 'Verify redeem', sources: [{ kind: 'ac', ref: 'AC-1' }] }] },
    };
    const visual = {
      compared: true, expectedFrames: 1, comparedScreens: 1, passRate: 0, categoriesCovered: ['typography'],
      screens: [{
        screen: 'Checkout', combo: 'web · en-US', expectedFrame: 'checkout.png', actualScreenshot: 'shot.png',
        verdict: 'major', categoriesChecked: ['typography'],
        findings: [{ category: 'typography', dimension: 'sentence-case', severity: 'major', screen: 'Checkout',
          component: 'Primary Button', token: { kind: 'typography', name: 'type/button/label' },
          expected: 'Add to cart', actual: 'Add To Cart', differenceDescription: 'Button label uses title case instead of sentence case.',
          recommendation: 'Update the shared Primary Button typography token.', confidence: 'high', sources: [{ kind: 'figma', ref: 'Checkout' }] }],
      }],
    };
    const parity = computeParityCertification(evalInput);
    const review = computeReviewConfidence(evalInput);
    const health = computeStoryHealth(evalInput, parity, review, { visualHealth: null, defects: [] });
    const recommendations = computeRecommendations({ parity, review, health, visual, visualHealth: null, defects: [], testCases: evalInput.testCases });
    await svc.ingest({
      kind: 'step.finished', runId, stepId: step('html_report').id, status: 'succeeded',
      output: { parity, review, health, recommendations, visual }, at,
    });

    // Persisted review confidence + story health + recommendations.
    const persisted = await prisma.run.findUnique({ where: { id: runId } });
    assert.ok(persisted.reviewJson, 'review confidence persisted to Run.reviewJson');
    assert.ok(persisted.storyHealthJson, 'story health persisted to Run.storyHealthJson (M4)');
    assert.ok(persisted.recommendationsJson, 'recommendations persisted to Run.recommendationsJson (M5)');

    // Explain endpoint output.
    const ex = await svc.explain(runId);
    assert.ok(ex.reviewConfidence, 'explain returns review confidence');
    assert.equal(typeof ex.reviewConfidence.score, 'number');
    assert.ok(ex.storyHealth, 'explain returns story health (M4)');
    assert.equal(ex.storyHealth.dimensions.length, 6, 'six health dimensions');
    assert.ok(Array.isArray(ex.recommendations) && ex.recommendations.length > 0, 'explain returns recommendations (M5)');
    assert.ok(ex.artifacts.some((a) => a.artifactKind === 'recommendation'), 'recommendation artifacts flow through explain()');
    assert.ok(ex.versions.workflow && ex.versions.prompt, 'run-level versions present');

    const tc = ex.artifacts.find((a) => a.artifactKind === 'test_case');
    assert.ok(tc, 'test case artifact explained');
    assert.equal(tc.contributed.acceptanceCriteria.length, 1, 'AC contribution resolved');
    assert.equal(tc.contributed.acceptanceCriteria[0].title, 'User can redeem a perk', 'AC text resolved from context');
    assert.equal(tc.versions.prompt, '1.1.0', 'prompt version from the LLM Request Log (what ran)');
    assert.ok(tc.reason.includes('STEP 6'), 'why-generated reason present');

    // M3: visual findings flow through explain() as self-explaining artifacts.
    const vf = ex.artifacts.find((a) => a.artifactKind === 'visual_finding');
    assert.ok(vf, 'visual finding explained');
    assert.ok(vf.reason.includes('sentence case'), 'precise self-explaining reason');
    assert.ok(vf.contributed.figmaFrames.length >= 1, 'figma frame attached to visual finding');
    // M3.5 — design-system framing flows through explain().
    assert.ok(vf.reason.startsWith('Primary Button uses the wrong typography token:'), 'design-system reason prefix');
    assert.ok(vf.artifactLabel.includes('Primary Button'), 'component named in the artifact label');

    // M6 — Activity Timeline built from persisted steps (deterministic, 0 AI).
    const tl = await svc.timeline(runId);
    assert.ok(Array.isArray(tl.events) && tl.events.length > 0, 'timeline has events');
    assert.ok(tl.events.some((e) => e.kind === 'node_finished'), 'a node_finished event exists');
    assert.equal(typeof tl.nodeCount, 'number', 'summary counts present');
    assert.ok(Array.isArray(tl.milestones), 'milestones present');
  } finally {
    if (runId) await prisma.run.delete({ where: { id: runId } }).catch(() => {});
    await prisma.story.deleteMany({ where: { jiraKey } }).catch(() => {});
    await prisma.project.deleteMany({ where: { id: pid } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: uid } }).catch(() => {});
    await prisma.$disconnect();
  }
});
