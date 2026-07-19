import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { prisma, Prisma } from '@qa/db';
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

  /**
   * Paused-run queue (Run Lifecycle Management, §6b): every run across ALL
   * stories currently needing tester attention (paused/failed/cancelled),
   * with enough context to act on it — resume, retry, or drill in — without
   * opening each story page individually. `blockingStep` is whichever step
   * caused the run to stop (failed/interrupted/cancelled/awaiting a gate or
   * clarification); null for a plain manual pause, which stopped cleanly at a
   * step boundary rather than on any particular step.
   */
  async listInterrupted() {
    const runs = await prisma.run.findMany({
      where: { status: { in: ['paused', 'failed', 'cancelled'] } },
      orderBy: { createdAt: 'desc' },
      include: {
        story: { select: { id: true, jiraKey: true, title: true } },
        steps: {
          where: { status: { in: ['failed', 'interrupted', 'cancelled', 'awaiting_approval', 'awaiting_input'] } },
          orderBy: { ordinal: 'asc' },
          select: { id: true, name: true, type: true, status: true, attempt: true },
        },
      },
    });
    return runs.map((r) => ({
      id: r.id,
      status: r.status,
      pauseReason: r.pauseReason,
      totalCostUsd: r.totalCostUsd,
      createdAt: r.createdAt,
      finishedAt: r.finishedAt,
      story: r.story,
      blockingStep: r.steps[0] ?? null,
    }));
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
      include: {
        steps: { orderBy: { ordinal: 'asc' }, include: { approval: true, clarification: true } },
        statusEvents: { orderBy: { at: 'asc' } },
      },
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
      statusEvents: run.statusEvents.map((e) => ({ status: e.status, reason: e.reason, at: e.at })),
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

  /**
   * Worker claims the oldest queued run (FIFO). Compare-and-swap: the plain
   * findFirst+update this replaced was a TOCTOU race if two worker processes
   * claim concurrently — not a real risk with a single worker, but the paused-
   * run queue (Run Lifecycle Management) lets a tester requeue several runs at
   * once, so this is now a correctness requirement, not just tidiness. Bounded
   * retry: if another worker wins the race for the oldest candidate, try the
   * next-oldest rather than looping forever.
   */
  async claimNext(workerId: string) {
    for (let attempt = 0; attempt < 5; attempt++) {
      // No `skip` needed: once another worker wins a candidate its status is no
      // longer 'queued', so it naturally drops out of this filter next attempt.
      const next = await prisma.run.findFirst({
        where: { status: 'queued' },
        orderBy: { createdAt: 'asc' },
      });
      if (!next) return null;
      const { count } = await prisma.run.updateMany({
        where: { id: next.id, status: 'queued' }, // guard: still queued at write time
        data: { status: 'running', workerId, startedAt: new Date() },
      });
      if (count === 1) {
        return prisma.run.findUnique({
          where: { id: next.id },
          include: { steps: { orderBy: { ordinal: 'asc' } }, story: true },
        });
      }
      // Someone else claimed `next` between findFirst and updateMany — retry
      // against the next-oldest candidate instead of re-claiming the same one.
    }
    return null;
  }

  /**
   * Ingest a RunEvent from the worker: persist the relevant state, then
   * re-broadcast on the bus so connected SSE clients update live.
   */
  async ingest(event: RunEvent) {
    switch (event.kind) {
      case 'run.status': {
        // pauseReason rides along with the status that caused it, and is
        // cleared the moment the run leaves paused/pausing — never left
        // stale from a prior pause once the run moves on. The worker's OWN
        // 'paused' event (runner.ts's isPausing()/PausedForInput branches)
        // never carries a reason — it's derived here from what's actually
        // blocking (a gate/ask/credential step) or, if nothing is, from
        // whatever pauseRun() already stamped moments earlier (a manual
        // pause finalizing at a step boundary).
        const pauseReason =
          event.status === 'paused' || event.status === 'pausing'
            ? event.reason ?? (await this.derivePauseReason(event.runId))
            : null;
        await prisma.run.update({
          where: { id: event.runId },
          data: {
            status: event.status,
            pauseReason,
            ...(event.status === 'succeeded' || event.status === 'failed'
              ? { finishedAt: new Date() }
              : {}),
          },
        });
        // Record the DERIVED reason (whatever actually ended up on the run),
        // not the raw event's — the worker's own 'paused' event rarely
        // carries one, so recording that verbatim would leave every gate/
        // ask/credential/manual pause unlabeled in the Activity Timeline.
        await this.recordStatusEvent(event.runId, event.status, pauseReason ?? event.reason);
        break;
      }
      case 'step.started':
        await prisma.runStep.update({
          where: { id: event.stepId },
          data: { status: 'running', startedAt: new Date() },
        });
        break;
      case 'step.log':
        // Persist the live progress/diagnostic lines the worker emits (incl. the
        // runner's "ERROR …" line on failure) into RunStep.logs so a failed or
        // completed run stays fully diagnosable from the UI + DB after the live
        // SSE stream is gone — no reliance on the worker's inherited terminal
        // stdout. Append + cap; the worker serializes ingests per run (each
        // ingest() is awaited), so this read-modify-write is race-free per step.
        {
          const LOG_CAP = 64 * 1024; // keep the tail; oldest lines drop first
          const existing = (await prisma.runStep.findUnique({
            where: { id: event.stepId },
            select: { logs: true },
          }))?.logs;
          const next = ((existing ? existing + '\n' : '') + event.line).slice(-LOG_CAP);
          await prisma.runStep.update({ where: { id: event.stepId }, data: { logs: next } });
        }
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
            // Structured Failure Recovery diagnostics — cleared on a successful
            // finish so a later retry's success doesn't leave a stale error
            // behind from a previous attempt.
            errorJson: event.error ? (event.error as object) : event.status === 'succeeded' ? Prisma.JsonNull : undefined,
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
    await this.requeue(approval.runStep.runId, 'gate');
    return approval;
  }

  /** Tester answers to a clarification → re-queue the run so a worker resumes it. */
  async answerClarification(stepId: string, answers: unknown, userId: string) {
    const clar = await prisma.clarification.update({
      where: { runStepId: stepId },
      data: { answersJson: answers as object, answeredById: userId, answeredAt: new Date() },
      include: { runStep: { select: { runId: true } } },
    });
    await this.requeue(clar.runStep.runId, 'ask');
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
      await prisma.run.update({ where: { id: runId }, data: { status: 'cancelled', finishedAt: new Date(), pauseReason: null } });
      this.bus.publish({ kind: 'run.status', runId, status: 'cancelled', at: new Date().toISOString() });
      await this.recordStatusEvent(runId, 'cancelled', 'credential');
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
    await this.requeue(runId, 'credential');
    return { ok: true, decision, saved: decision === 'save' ? filled.length : 0 };
  }

  /**
   * Put a paused run back in the queue and announce it so a worker re-claims.
   * `reason` labels the cause for the Activity Timeline (e.g. 'gate'/'ask'/
   * 'credential' when a per-step answer unblocks the run) — free-text, not the
   * RunEvent wire's RunPauseReason (that field is only about *why paused*).
   */
  private async requeue(runId: string, reason?: string) {
    await prisma.run.update({ where: { id: runId }, data: { status: 'queued', pauseReason: null } });
    this.bus.publish({ kind: 'run.status', runId, status: 'queued', at: new Date().toISOString() });
    await this.recordStatusEvent(runId, 'queued', reason);
  }

  /**
   * Derive WHY a run is (becoming) 'paused' when the worker's own event
   * didn't say — true for every gate/ask/credential pause (those pause via a
   * plain `ingest(status(run.id, 'paused'))` with no reason field) and for a
   * manual pause finalizing at a step boundary. Looks at whichever step is
   * currently awaiting a decision; with none, falls back to whatever reason
   * is already stamped on the run (pauseRun() sets it directly, moments
   * before the worker's finalizing event arrives here).
   */
  private async derivePauseReason(runId: string): Promise<string | null> {
    const blocking = await prisma.runStep.findFirst({
      where: { runId, status: { in: ['awaiting_approval', 'awaiting_input'] } },
      include: { clarification: true },
    });
    if (blocking?.status === 'awaiting_approval') return 'gate';
    if (blocking?.status === 'awaiting_input') {
      const q = blocking.clarification?.questionsJson as { credentialRequest?: unknown } | undefined;
      return q && typeof q === 'object' && 'credentialRequest' in q ? 'credential' : 'ask';
    }
    const existing = await prisma.run.findUnique({ where: { id: runId }, select: { pauseReason: true } });
    return existing?.pauseReason ?? 'manual';
  }

  /**
   * Append a Run.status transition to the audit history (RunStatusEvent) that
   * powers the Activity Timeline's pause/resume/retry/restart/cancel entries.
   * Best-effort like logLlmRequest: an audit write must never break the run.
   */
  private async recordStatusEvent(runId: string, status: string, reason?: string | null) {
    try {
      await prisma.runStatusEvent.create({ data: { runId, status, reason: reason ?? null } });
    } catch {
      /* best-effort audit write */
    }
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

  /**
   * Artifact versioning (Run Lifecycle Management, §5b): the next version
   * number for a logical artifact name (e.g. "hls/hls.md") within this run's
   * story. Pure read — `name`'s version-suffix-stripped form is the stable
   * identity versions share; the worker asks this BEFORE writing so it knows
   * whether to suffix the file path (v2+) or write the bare name (v1).
   */
  async nextArtifactVersion(runId: string, name: string): Promise<{ version: number }> {
    const run = await prisma.run.findUnique({ where: { id: runId }, select: { storyId: true } });
    if (!run) throw new NotFoundException(`Run ${runId} not found`);
    const latest = await prisma.artifact.findFirst({
      where: { storyId: run.storyId, name },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return { version: (latest?.version ?? 0) + 1 };
  }

  /**
   * Record a written artifact version (Run Lifecycle Management, §5b).
   * Best-effort like logLlmRequest: an audit write must never break the run.
   */
  async recordArtifact(runId: string, rec: { kind: string; name: string; version: number; localPath: string }) {
    try {
      const run = await prisma.run.findUnique({ where: { id: runId }, select: { storyId: true } });
      if (!run) return { ok: false };
      await prisma.artifact.create({
        data: { storyId: run.storyId, runId, kind: rec.kind, name: rec.name, version: rec.version, localPath: rec.localPath },
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
      await prisma.run.update({ where: { id }, data: { status: 'cancelled', finishedAt: new Date(), pauseReason: null } });
      this.bus.publish({ kind: 'run.status', runId: id, status: 'cancelled', at: new Date().toISOString() });
      await this.recordStatusEvent(id, 'cancelled');
      return { status: 'cancelled' };
    }
    if (run.status === 'running') {
      await prisma.run.update({ where: { id }, data: { status: 'cancelling' } });
      this.bus.publish({ kind: 'run.status', runId: id, status: 'cancelling', at: new Date().toISOString() });
      await this.recordStatusEvent(id, 'cancelling');
      return { status: 'cancelling' };
    }
    throw new BadRequestException(`Run ${id} is ${run.status} — nothing to cancel`);
  }

  /**
   * Manual Pause (Run Lifecycle Management): stop gracefully at the next step
   * boundary rather than aborting the in-flight step (that's Stop/cancel). A
   * queued run has no active worker holding it, so it's paused immediately; a
   * running run is flipped to 'pausing' and the worker's poller (same
   * mechanism as the existing Stop poll, just without aborting) notices within
   * one interval, lets the current step finish normally, then stops.
   */
  async pauseRun(id: string) {
    const run = await prisma.run.findUnique({ where: { id } });
    if (!run) throw new NotFoundException(`Run ${id} not found`);
    if (run.status === 'queued') {
      await prisma.run.update({ where: { id }, data: { status: 'paused', pauseReason: 'manual' } });
      this.bus.publish({ kind: 'run.status', runId: id, status: 'paused', reason: 'manual', at: new Date().toISOString() });
      await this.recordStatusEvent(id, 'paused', 'manual');
      return { status: 'paused' };
    }
    if (run.status === 'running') {
      await prisma.run.update({ where: { id }, data: { status: 'pausing', pauseReason: 'manual' } });
      this.bus.publish({ kind: 'run.status', runId: id, status: 'pausing', reason: 'manual', at: new Date().toISOString() });
      await this.recordStatusEvent(id, 'pausing', 'manual');
      return { status: 'pausing' };
    }
    throw new BadRequestException(`Run ${id} is ${run.status} — nothing to pause`);
  }

  /**
   * Resume a run. Three distinct cases, dispatched by status/pauseReason:
   *  - cancelled/failed: the interrupted step needs re-execution — reuses the
   *    existing resetStepsFrom(fromOrdinal) behavior (unchanged from before).
   *  - paused with pauseReason 'manual'/'usage_limit': the run stopped cleanly
   *    at a step boundary (or the interrupted step was left non-terminal, see
   *    the 'interrupted' step status) — nothing needs resetting, just requeue.
   *  - paused with pauseReason 'gate'/'ask'/'credential': there's a dedicated
   *    approve/answer/credential action for this; a generic Resume would just
   *    re-throw PausedForInput immediately, so it's rejected with guidance.
   */
  async resumeRun(id: string) {
    const run = await prisma.run.findUnique({ where: { id }, include: { steps: { orderBy: { ordinal: 'asc' } } } });
    if (!run) throw new NotFoundException(`Run ${id} not found`);

    if (run.status === 'cancelled' || run.status === 'failed') {
      const resumable = run.steps.filter((s) => s.status === 'cancelled' || s.status === 'failed' || s.status === 'interrupted');
      if (!resumable.length) throw new BadRequestException('No interrupted step found to resume from');
      const fromOrdinal = Math.min(...resumable.map((s) => s.ordinal));
      await this.resetStepsFrom(id, fromOrdinal, 'resume');
      return { resumed: true, fromOrdinal };
    }

    if (run.status === 'paused') {
      if (run.pauseReason === 'manual' || run.pauseReason === 'usage_limit') {
        await this.requeue(id, 'resume');
        return { resumed: true };
      }
      throw new BadRequestException(
        `Run ${id} is paused waiting on a ${run.pauseReason ?? 'gate/ask/credential'} — use that action instead of Resume`,
      );
    }

    throw new BadRequestException(`Run ${id} is ${run.status} — nothing to resume`);
  }

  /**
   * Regenerate: a gate-scoped convenience over Restart From Step — resolves
   * the gate's upstream source node (GATE_SOURCE map) and restarts from there
   * with tester feedback threaded in. The gate itself sits at ordinal >=
   * source, so it's inside the reset range restartFromStep/resetStepsFrom
   * already covers — its prior decision is cleared along with everything
   * else in range, no separate step needed. Kept as its own method for the
   * existing gate-card UX/controller contract.
   */
  async regenerateStep(stepId: string, feedback: string, userId: string) {
    const gateStep = await prisma.runStep.findUnique({ where: { id: stepId } });
    if (!gateStep) throw new NotFoundException(`Step ${stepId} not found`);
    const sourceName = GATE_SOURCE[gateStep.name as LifecycleNode];
    if (!sourceName) throw new BadRequestException(`"${gateStep.name}" has no regenerate source — use Approve/Reject`);
    const sourceStep = await prisma.runStep.findFirst({ where: { runId: gateStep.runId, name: sourceName } });
    if (!sourceStep) throw new NotFoundException(`Source step "${sourceName}" not found on this run`);
    await this.restartFromStep(sourceStep.id, feedback, userId);
    return { regenerating: true, from: sourceName };
  }

  /**
   * Restart From Step (Run Lifecycle Management): re-run this step AND every
   * step after it, discarding what they already produced — works on ANY step
   * regardless of its current status (succeeded, failed, skipped...), unlike
   * Retry Failed Step which only ever touches a single failed/interrupted
   * step. Refuses while a worker currently owns the run (running/pausing/
   * cancelling) — resetting steps out from under an active execution would
   * race the worker's in-memory step snapshot.
   */
  async restartFromStep(stepId: string, feedback: string | undefined, _userId: string) {
    const step = await prisma.runStep.findUnique({ where: { id: stepId }, include: { run: { select: { status: true } } } });
    if (!step) throw new NotFoundException(`Step ${stepId} not found`);
    if (['running', 'pausing', 'cancelling'].includes(step.run.status)) {
      throw new BadRequestException(`Run is ${step.run.status} — pause or stop it before restarting from a step`);
    }
    if (feedback) await prisma.runStep.update({ where: { id: stepId }, data: { feedback } });
    await this.resetStepsFrom(step.runId, step.ordinal, 'restart');
    return { restarted: true, from: step.name };
  }

  /**
   * Retry Failed Step (Run Lifecycle Management): re-run ONLY the step that
   * failed/was interrupted — not the whole run from that point. There's
   * nothing downstream to reset: a failure/interruption is a hard stop, so no
   * step after it ever started. Distinct from Restart From Step, which
   * discards and rebuilds everything from a chosen point forward.
   */
  async retryStep(stepId: string, _userId: string) {
    const step = await prisma.runStep.findUnique({ where: { id: stepId } });
    if (!step) throw new NotFoundException(`Step ${stepId} not found`);
    if (step.status !== 'failed' && step.status !== 'interrupted') {
      throw new BadRequestException(`Step "${step.name}" is ${step.status} — only a failed/interrupted step can be retried`);
    }
    await prisma.runStep.update({
      where: { id: stepId },
      data: { status: 'pending', startedAt: null, finishedAt: null, attempt: { increment: 1 } },
    });
    await this.requeue(step.runId, 'retry');
    return { retried: true, step: step.name, attempt: step.attempt + 1 };
  }

  /**
   * Bulk Retry Failed Steps — the paused-run queue's primary bulk action. A
   * single run only ever has ONE failed/interrupted step at a time (the loop
   * stops at the first failure), so "the failed step" per run is unambiguous.
   * Applies retryStep run-by-run and reports per-run outcomes so a partial
   * failure in the batch is visible, never silently swallowed.
   */
  async retryFailedRuns(runIds: string[], userId: string): Promise<{ results: Array<{ runId: string; ok: boolean; error?: string }> }> {
    const results: Array<{ runId: string; ok: boolean; error?: string }> = [];
    for (const runId of runIds) {
      try {
        const step = await prisma.runStep.findFirst({ where: { runId, status: { in: ['failed', 'interrupted'] } } });
        if (!step) throw new BadRequestException(`Run ${runId} has no failed/interrupted step`);
        await this.retryStep(step.id, userId);
        results.push({ runId, ok: true });
      } catch (e) {
        results.push({ runId, ok: false, error: (e as Error).message });
      }
    }
    return { results };
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
   * pending — including wiping their stale outputJson/logs/errorJson/tokens/
   * costUsd and Approval/Clarification rows, since Restart From Step means
   * "discard what these steps produced, not just re-flag them pending" — and
   * re-queue the run so a worker resumes exactly there. Run-level rollups
   * (totalTokens/totalCostUsd) are recomputed from the steps that REMAIN
   * (ordinal < fromOrdinal) rather than decremented incrementally, so there's
   * no drift risk. If the reset range reaches back to/through html_report,
   * its Parity/Review/Story Health/Recommendations snapshots are cleared too
   * — they'd otherwise show a stale pre-restart snapshot until it reruns.
   * Used by resumeRun (after Stop/failure), retryStep, and restartFromStep.
   */
  private async resetStepsFrom(runId: string, fromOrdinal: number, reason?: string) {
    const resetSteps = await prisma.runStep.findMany({
      where: { runId, ordinal: { gte: fromOrdinal } },
      select: { id: true },
    });
    const resetIds = resetSteps.map((s) => s.id);

    await prisma.runStep.updateMany({
      where: { runId, ordinal: { gte: fromOrdinal } },
      data: {
        status: 'pending', startedAt: null, finishedAt: null,
        outputJson: Prisma.JsonNull, logs: null, errorJson: Prisma.JsonNull,
        tokens: 0, costUsd: 0,
      },
    });
    if (resetIds.length) {
      await prisma.approval.deleteMany({ where: { runStepId: { in: resetIds } } });
      await prisma.clarification.deleteMany({ where: { runStepId: { in: resetIds } } });
    }

    const remaining = await prisma.runStep.findMany({
      where: { runId, ordinal: { lt: fromOrdinal } },
      select: { tokens: true, costUsd: true },
    });
    const totalTokens = remaining.reduce((sum, s) => sum + s.tokens, 0);
    const totalCostUsd = remaining.reduce((sum, s) => sum + s.costUsd, 0);

    const htmlReportOrdinal = LIFECYCLE_GRAPH.findIndex((n) => n.name === 'html_report');
    const clearsHtmlReport = htmlReportOrdinal >= 0 && fromOrdinal <= htmlReportOrdinal;

    await prisma.run.update({
      where: { id: runId },
      data: {
        status: 'queued', finishedAt: null, pauseReason: null,
        totalTokens, totalCostUsd,
        ...(clearsHtmlReport
          ? {
              parityJson: Prisma.JsonNull,
              reviewJson: Prisma.JsonNull,
              storyHealthJson: Prisma.JsonNull,
              recommendationsJson: Prisma.JsonNull,
            }
          : {}),
      },
    });
    this.bus.publish({ kind: 'run.status', runId, status: 'queued', at: new Date().toISOString() });
    await this.recordStatusEvent(runId, 'queued', reason);
  }
}
