import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@qa/db';
import {
  GATE_SOURCE,
  LIFECYCLE_GRAPH,
  SETTING_GROUPS,
  buildWorkflowDefinition,
  resolveRunVersions,
  buildActivityTimeline,
  explainArtifact,
  explainVisualFinding,
  getPrompt,
  type ArtifactExplanation,
  type CitationContext,
  type Citation,
  type ExplainVersions,
  type LifecycleNode,
  type RunEvent,
} from '@qa/shared';
import { EventsBus } from './events.bus.js';

@Injectable()
export class RunsService {
  constructor(private readonly bus: EventsBus) {}

  /** Create a queued run with one RunStep per MVP graph node. */
  async createRun(storyId: string, triggeredById: string) {
    const story = await prisma.story.findUnique({ where: { id: storyId } });
    if (!story) throw new NotFoundException(`Story ${storyId} not found`);

    // The tester's phase selection resolves to a node allowlist on the story.
    // Nodes NOT in the list are seeded as 'skipped' (a terminal status the runner
    // steps right over), so the run only executes the chosen phases. null/empty =
    // run everything (backward compatible with stories created before this field).
    const enabled = Array.isArray(story.enabledNodes) ? new Set(story.enabledNodes as string[]) : null;

    // Workflow Registry & Versioning (#3): stamp the run with the workflow +
    // prompt + platform versions and a snapshot of the workflow definition it
    // runs under, for reproducibility. knowledge/framework versions are left null
    // as placeholders (filled by a later increment). All columns are nullable.
    const enabledNodes = Array.isArray(story.enabledNodes) ? (story.enabledNodes as string[]) : null;
    const versions = resolveRunVersions();
    const workflowDef = buildWorkflowDefinition(enabledNodes);

    const run = await prisma.run.create({
      data: {
        storyId,
        triggeredById,
        status: 'queued',
        workflowVersion: versions.workflowVersion,
        promptVersion: versions.promptVersion,
        platformVersion: versions.platformVersion,
        knowledgeVersion: versions.knowledgeVersion,
        frameworkVersion: versions.frameworkVersion,
        workflowDefJson: workflowDef as unknown as object,
        steps: {
          create: LIFECYCLE_GRAPH.map((node, i) => ({
            name: node.name,
            type: node.type,
            ordinal: i,
            status: enabled && !enabled.has(node.name) ? 'skipped' : 'pending',
          })),
        },
      },
      include: { steps: { orderBy: { ordinal: 'asc' } } },
    });
    await prisma.story.update({ where: { id: storyId }, data: { status: 'analyzing' } });
    return run;
  }

  getRun(id: string) {
    return prisma.run.findUnique({
      where: { id },
      include: {
        steps: {
          orderBy: { ordinal: 'asc' },
          include: { approval: true, clarification: true },
        },
        story: true,
      },
    });
  }

  /**
   * Activity Timeline (M6) — deterministic milestone timeline built from the
   * PERSISTED RunStep timing + Approval/Clarification rows. No AI (ADR-001).
   */
  async timeline(id: string) {
    const run = await prisma.run.findUnique({
      where: { id },
      include: { steps: { orderBy: { ordinal: 'asc' }, include: { approval: true, clarification: true } } },
    });
    if (!run) throw new NotFoundException(`run ${id} not found`);
    return buildActivityTimeline({
      run: { createdAt: run.createdAt, startedAt: run.startedAt, finishedAt: run.finishedAt, status: run.status },
      steps: run.steps.map((s) => ({
        name: s.name, type: s.type, status: s.status, ordinal: s.ordinal,
        startedAt: s.startedAt, finishedAt: s.finishedAt, tokens: s.tokens, costUsd: s.costUsd,
        approval: s.approval
          ? { action: s.approval.action, decision: s.approval.decision, createdAt: s.approval.createdAt, decidedAt: s.approval.decidedAt }
          : null,
        clarification: s.clarification
          ? { createdAt: s.clarification.createdAt, answeredAt: s.clarification.answeredAt }
          : null,
      })),
    });
  }

  /**
   * AI Explainability (M2). Assembles a structured explanation for every
   * supported artifact from PERSISTED run data — the reusable seam that also
   * serves Story Replay + QA Analytics (no new AI call). Prompt version per
   * artifact comes from the LLM Request Log (what actually ran); workflow/
   * knowledge/framework/platform from the Run's version stamps.
   */
  async explain(runId: string) {
    const run = await prisma.run.findUnique({ where: { id: runId }, include: { steps: true, story: true } });
    if (!run) throw new NotFoundException(`Run ${runId} not found`);
    const out = (name: string) => run.steps.find((s) => s.name === name)?.outputJson as Record<string, any> | undefined;

    const logs = await prisma.llmRequestLog.findMany({ where: { runId }, orderBy: { createdAt: 'asc' } });
    const promptVerByNode = new Map<string, string | null>();
    for (const l of logs) if (!promptVerByNode.has(l.node)) promptVerByNode.set(l.node, l.promptVersion);

    const jiraBase = await prisma.setting.findUnique({ where: { key: 'jira.baseUrl' } });
    const ac = out('acceptance_criteria');
    const figma = out('figma_analysis');
    const citationContext: CitationContext = {
      jiraBaseUrl: jiraBase?.value,
      storyKey: run.story.jiraKey,
      figmaFileKey: figma?.fileKey,
      acById: Object.fromEntries(((ac?.criteria ?? []) as Array<{ id: string; text: string }>).map((a) => [a.id, a.text])),
    };
    const versionsFor = (node: string): ExplainVersions => ({
      prompt: promptVerByNode.get(node) ?? null,
      workflow: run.workflowVersion,
      knowledge: run.knowledgeVersion,
      framework: run.frameworkVersion,
      platform: run.platformVersion,
    });

    const artifacts: ArtifactExplanation[] = [];
    const push = (
      kind: Parameters<typeof explainArtifact>[0]['artifactKind'],
      label: string,
      node: string,
      sources?: Citation[],
      evidence?: string[],
    ) => artifacts.push(explainArtifact({ artifactKind: kind, artifactLabel: label, node, sources, evidence, versions: versionsFor(node), citationContext }));

    const req = out('requirements_analysis');
    if (req) push('requirements_analysis', 'Requirements Analysis', 'requirements_analysis', req.sources);
    if (out('impact_analysis')) push('impact_analysis', 'Impact Analysis', 'impact_analysis');
    for (const sc of out('generate_hls')?.scenarios ?? []) push('hls_scenario', `HLS ${sc.index}: ${sc.text}`, 'generate_hls', sc.sources);
    for (const c of out('generate_testcases')?.cases ?? []) push('test_case', c.title, 'generate_testcases', c.sources);
    for (const d of out('execution')?.defects ?? []) push('defect', d.title, 'execution', d.sources, d.evidence);

    // Visual findings (M3): each self-explains via the shared visual explainer.
    // The visual comparison ran under the visual_comparison prompt version.
    const visual = out('html_report')?.visual as { screens?: any[] } | undefined;
    if (visual?.screens?.length) {
      const visualVersions: ExplainVersions = {
        prompt: getPrompt('visual_comparison').version,
        workflow: run.workflowVersion,
        knowledge: run.knowledgeVersion,
        framework: run.frameworkVersion,
        platform: run.platformVersion,
      };
      for (const scr of visual.screens) {
        for (const f of scr.findings ?? []) {
          artifacts.push(explainVisualFinding(f, scr, visualVersions, citationContext));
        }
      }
    }

    // Recommendations (M5): deterministic — each is a first-class explainable
    // artifact whose reason is its root cause and whose evidence is the signal(s)
    // it was derived from. Produced by html_report; no prompt version (no AI).
    const recommendations = (run.recommendationsJson ?? null) as
      | Array<{ id: string; title: string; rootCause?: string; sources?: Citation[]; derivedFrom?: string[] }>
      | null;
    for (const r of recommendations ?? []) {
      artifacts.push(
        explainArtifact({
          artifactKind: 'recommendation',
          artifactLabel: r.title,
          node: 'html_report',
          sources: r.sources,
          evidence: r.derivedFrom,
          reason: r.rootCause,
          versions: versionsFor('html_report'),
          citationContext,
        }),
      );
    }

    return {
      runId,
      versions: {
        workflow: run.workflowVersion,
        prompt: run.promptVersion,
        knowledge: run.knowledgeVersion,
        framework: run.frameworkVersion,
        platform: run.platformVersion,
      },
      reviewConfidence: run.reviewJson ?? null,
      parity: run.parityJson ?? null,
      storyHealth: run.storyHealthJson ?? null,
      recommendations,
      artifacts,
    };
  }

  /** Worker claims the oldest queued run (FIFO). */
  async claimNext(workerId: string) {
    const next = await prisma.run.findFirst({
      where: { status: 'queued' },
      orderBy: { createdAt: 'asc' },
    });
    if (!next) return null;
    return prisma.run.update({
      where: { id: next.id },
      data: { status: 'running', workerId, startedAt: new Date() },
      include: { steps: { orderBy: { ordinal: 'asc' } }, story: true },
    });
  }

  /**
   * Ingest a RunEvent from the worker: persist the relevant state, then
   * re-broadcast on the bus so connected SSE clients update live.
   */
  async ingest(event: RunEvent) {
    switch (event.kind) {
      case 'run.status':
        await prisma.run.update({
          where: { id: event.runId },
          data: {
            status: event.status,
            ...(event.status === 'succeeded' || event.status === 'failed'
              ? { finishedAt: new Date() }
              : {}),
          },
        });
        break;
      case 'step.started':
        await prisma.runStep.update({
          where: { id: event.stepId },
          data: { status: 'running', startedAt: new Date() },
        });
        break;
      case 'step.finished':
        await prisma.runStep.update({
          where: { id: event.stepId },
          data: {
            status: event.status,
            outputJson: (event.output as object) ?? undefined,
            tokens: event.tokens ?? 0,
            costUsd: event.costUsd ?? 0,
            finishedAt: new Date(),
          },
        });
        if (event.costUsd || event.tokens) {
          await prisma.run.update({
            where: { id: event.runId },
            data: {
              totalCostUsd: { increment: event.costUsd ?? 0 },
              totalTokens: { increment: event.tokens ?? 0 },
            },
          });
        }
        // Parity Certification (#5) + Review Confidence (M2) + Story Health (M4):
        // the html_report step returns `parity` + `review` + `health` snapshots —
        // persist them for run detail, explain, and analytics.
        {
          const out = event.output as { parity?: unknown; review?: unknown; health?: unknown; recommendations?: unknown } | undefined;
          const data: { parityJson?: object; reviewJson?: object; storyHealthJson?: object; recommendationsJson?: object } = {};
          if (out?.parity) data.parityJson = out.parity as object;
          if (out?.review) data.reviewJson = out.review as object;
          if (out?.health) data.storyHealthJson = out.health as object; // Story Health (M4)
          if (out?.recommendations) data.recommendationsJson = out.recommendations as object; // Recommendations (M5)
          if (Object.keys(data).length) {
            await prisma.run.update({ where: { id: event.runId }, data });
          }
        }
        break;
      case 'gate.awaiting':
        await prisma.runStep.update({
          where: { id: event.stepId },
          data: { status: 'awaiting_approval' },
        });
        await prisma.approval.upsert({
          where: { runStepId: event.stepId },
          update: { action: event.action, payload: event.payloadPreview as object },
          create: { runStepId: event.stepId, action: event.action, payload: event.payloadPreview as object },
        });
        break;
      case 'ask.awaiting':
        await prisma.runStep.update({
          where: { id: event.stepId },
          data: { status: 'awaiting_input' },
        });
        await prisma.clarification.upsert({
          where: { runStepId: event.stepId },
          update: { questionsJson: event.questions },
          create: { runStepId: event.stepId, questionsJson: event.questions },
        });
        break;
      case 'credential.awaiting': {
        // Reuses the clarification carrier (no schema change): a credential
        // request is marked by a `credentialRequest` envelope in questionsJson.
        await prisma.runStep.update({
          where: { id: event.stepId },
          data: { status: 'awaiting_input' },
        });
        const questionsJson = { credentialRequest: { reason: event.reason, credentials: event.credentials } };
        await prisma.clarification.upsert({
          where: { runStepId: event.stepId },
          update: { questionsJson },
          create: { runStepId: event.stepId, questionsJson },
        });
        break;
      }
    }
    this.bus.publish(event);
    return { ok: true };
  }

  /** Tester decision on a gate → re-queue the run so a worker resumes it. */
  async decideGate(stepId: string, decision: 'approved' | 'rejected', feedback: string | undefined, userId: string) {
    const approval = await prisma.approval.update({
      where: { runStepId: stepId },
      data: { decision, feedback, decidedById: userId, decidedAt: new Date() },
      include: { runStep: { select: { runId: true } } },
    });
    await this.requeue(approval.runStep.runId);
    return approval;
  }

  /** Tester answers to a clarification → re-queue the run so a worker resumes it. */
  async answerClarification(stepId: string, answers: unknown, userId: string) {
    const clar = await prisma.clarification.update({
      where: { runStepId: stepId },
      data: { answersJson: answers as object, answeredById: userId, answeredAt: new Date() },
      include: { runStep: { select: { runId: true } } },
    });
    await this.requeue(clar.runStep.runId);
    return clar;
  }

  /**
   * Tester response to a runtime credential prompt (`credential.awaiting`):
   *  - cancel   → stop the run (never requeued);
   *  - save     → persist each value to Settings AND thread it into this run;
   *  - use-once → thread the values into just this run, do not persist.
   * `save`/`use-once` re-queue the run so the worker resumes and proceeds.
   */
  async submitCredential(
    stepId: string,
    decision: 'use-once' | 'save' | 'cancel',
    values: Array<{ key: string; value: string; secret: boolean; group?: string }>,
    userId: string,
  ) {
    const clar = await prisma.clarification.findUnique({
      where: { runStepId: stepId },
      include: { runStep: { select: { runId: true } } },
    });
    if (!clar) throw new NotFoundException(`No credential request found for step ${stepId}`);
    const runId = clar.runStep.runId;

    if (decision === 'cancel') {
      await prisma.clarification.update({
        where: { runStepId: stepId },
        data: { answersJson: { decision: 'cancel' }, answeredById: userId, answeredAt: new Date() },
      });
      await prisma.runStep.update({ where: { id: stepId }, data: { status: 'cancelled', finishedAt: new Date() } });
      await prisma.run.update({ where: { id: runId }, data: { status: 'cancelled', finishedAt: new Date() } });
      this.bus.publish({ kind: 'run.status', runId, status: 'cancelled', at: new Date().toISOString() });
      return { cancelled: true };
    }

    const filled = values.filter((v) => v.value.trim().length > 0);
    if (decision === 'save') {
      for (const v of filled) {
        const prefix = v.key.split('.')[0];
        const group = v.group ?? ((SETTING_GROUPS as readonly string[]).includes(prefix) ? prefix : 'integrations');
        await prisma.setting.upsert({
          where: { key: v.key },
          update: { value: v.value, group, secret: v.secret },
          create: { key: v.key, value: v.value, group, secret: v.secret },
        });
      }
    }
    // Both save + use-once: record the values on the step so the worker sees
    // them the moment it resumes (use-once values live only here, not in Settings).
    await prisma.clarification.update({
      where: { runStepId: stepId },
      data: {
        answersJson: { decision, values: filled.map((v) => ({ key: v.key, value: v.value })) },
        answeredById: userId,
        answeredAt: new Date(),
      },
    });
    await this.requeue(runId);
    return { ok: true, decision, saved: decision === 'save' ? filled.length : 0 };
  }

  /** Put a paused run back in the queue and announce it so a worker re-claims. */
  private async requeue(runId: string) {
    await prisma.run.update({ where: { id: runId }, data: { status: 'queued' } });
    this.bus.publish({ kind: 'run.status', runId, status: 'queued', at: new Date().toISOString() });
  }

  /**
   * Persist an LLM Request Log record (#7) from the worker. Best-effort: an
   * audit write must never break the run, so failures are swallowed. The `id`
   * path param is the authoritative runId.
   */
  async logLlmRequest(runId: string, rec: Record<string, unknown>) {
    try {
      const s = (v: unknown) => (typeof v === 'string' ? v : undefined);
      const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
      await prisma.llmRequestLog.create({
        data: {
          runId,
          runStepId: s(rec.runStepId),
          node: s(rec.node) ?? 'unknown',
          schemaName: s(rec.schemaName),
          model: s(rec.model),
          promptVersion: s(rec.promptVersion),
          workflowVersion: s(rec.workflowVersion),
          systemPrompt: s(rec.systemPrompt),
          userPrompt: s(rec.userPrompt),
          rawResponse: s(rec.rawResponse),
          validatedOutput: (rec.validatedOutput as object) ?? undefined,
          status: s(rec.status) ?? 'ok',
          repaired: rec.repaired === true,
          repairStage: s(rec.repairStage),
          tokens: n(rec.tokens) ?? 0,
          costUsd: n(rec.costUsd) ?? 0,
          durationMs: n(rec.durationMs) ?? 0,
          attempt: n(rec.attempt) ?? 1,
        },
      });
    } catch {
      /* best-effort audit write */
    }
    return { ok: true };
  }

  /** Cheap status-only read for the worker's cancellation poller + UI badges. */
  async getStatus(id: string) {
    const run = await prisma.run.findUnique({ where: { id }, select: { status: true } });
    if (!run) throw new NotFoundException(`Run ${id} not found`);
    return run;
  }

  /**
   * Tester-initiated Stop. A queued/paused run has no active worker holding it,
   * so it's cancelled immediately. A running run is flipped to 'cancelling' —
   * the owning worker's poller notices within one poll interval and SIGKILLs
   * the active child process, finalizing the run to 'cancelled' itself.
   */
  async cancelRun(id: string) {
    const run = await prisma.run.findUnique({ where: { id } });
    if (!run) throw new NotFoundException(`Run ${id} not found`);
    if (run.status === 'queued' || run.status === 'paused') {
      await prisma.run.update({ where: { id }, data: { status: 'cancelled', finishedAt: new Date() } });
      this.bus.publish({ kind: 'run.status', runId: id, status: 'cancelled', at: new Date().toISOString() });
      return { status: 'cancelled' };
    }
    if (run.status === 'running') {
      await prisma.run.update({ where: { id }, data: { status: 'cancelling' } });
      this.bus.publish({ kind: 'run.status', runId: id, status: 'cancelling', at: new Date().toISOString() });
      return { status: 'cancelling' };
    }
    throw new BadRequestException(`Run ${id} is ${run.status} — nothing to cancel`);
  }

  /**
   * Resume a cancelled/failed run exactly at the step that was interrupted —
   * NOT a full restart. Shares resetStepsFrom with regenerateStep.
   */
  async resumeRun(id: string) {
    const run = await prisma.run.findUnique({ where: { id }, include: { steps: { orderBy: { ordinal: 'asc' } } } });
    if (!run) throw new NotFoundException(`Run ${id} not found`);
    if (run.status !== 'cancelled' && run.status !== 'failed') {
      throw new BadRequestException(`Run ${id} is ${run.status} — nothing to resume`);
    }
    const resumable = run.steps.filter((s) => s.status === 'cancelled' || s.status === 'failed');
    if (!resumable.length) throw new BadRequestException('No interrupted step found to resume from');
    const fromOrdinal = Math.min(...resumable.map((s) => s.ordinal));
    await this.resetStepsFrom(id, fromOrdinal);
    return { resumed: true, fromOrdinal };
  }

  /**
   * Regenerate: reset the gate's upstream source node (GATE_SOURCE map) through
   * the gate itself back to pending, with tester feedback threaded into the
   * source node's next prompt. The gate's own prior decision is cleared so it
   * re-asks for approval once the regenerated content is ready — ask/gate nodes
   * strictly BETWEEN source and gate keep their existing human answers and
   * short-circuit straight through on replay.
   */
  async regenerateStep(stepId: string, feedback: string, _userId: string) {
    const gateStep = await prisma.runStep.findUnique({ where: { id: stepId } });
    if (!gateStep) throw new NotFoundException(`Step ${stepId} not found`);
    const sourceName = GATE_SOURCE[gateStep.name as LifecycleNode];
    if (!sourceName) throw new BadRequestException(`"${gateStep.name}" has no regenerate source — use Approve/Reject`);
    const sourceStep = await prisma.runStep.findFirst({ where: { runId: gateStep.runId, name: sourceName } });
    if (!sourceStep) throw new NotFoundException(`Source step "${sourceName}" not found on this run`);

    await prisma.runStep.update({ where: { id: sourceStep.id }, data: { feedback } });
    await prisma.approval.updateMany({
      where: { runStepId: gateStep.id },
      data: { decision: null, feedback: null, decidedById: null, decidedAt: null },
    });
    await this.resetStepsFrom(gateStep.runId, sourceStep.ordinal);
    return { regenerating: true, from: sourceName };
  }

  /** Skip a gate checkpoint the tester doesn't need — gate-type steps only. */
  async skipStep(stepId: string, _userId: string) {
    const step = await prisma.runStep.findUnique({ where: { id: stepId } });
    if (!step) throw new NotFoundException(`Step ${stepId} not found`);
    if (step.type !== 'gate') throw new BadRequestException('Only gate steps can be skipped');
    await prisma.runStep.update({ where: { id: stepId }, data: { status: 'skipped', finishedAt: new Date() } });
    await this.requeue(step.runId);
    return { skipped: true };
  }

  /**
   * Shared primitive: reset every step at ordinal >= fromOrdinal back to
   * pending and re-queue the run so a worker resumes exactly there. Used by
   * both resumeRun (after Stop) and regenerateStep (with feedback).
   */
  private async resetStepsFrom(runId: string, fromOrdinal: number) {
    await prisma.runStep.updateMany({
      where: { runId, ordinal: { gte: fromOrdinal } },
      data: { status: 'pending', startedAt: null, finishedAt: null },
    });
    await prisma.run.update({ where: { id: runId }, data: { status: 'queued', finishedAt: null } });
    this.bus.publish({ kind: 'run.status', runId, status: 'queued', at: new Date().toISOString() });
  }
}
