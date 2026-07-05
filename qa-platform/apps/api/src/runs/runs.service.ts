import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@qa/db';
import { GATE_SOURCE, LIFECYCLE_GRAPH, type LifecycleNode, type RunEvent } from '@qa/shared';
import { EventsBus } from './events.bus.js';

@Injectable()
export class RunsService {
  constructor(private readonly bus: EventsBus) {}

  /** Create a queued run with one RunStep per MVP graph node. */
  async createRun(storyId: string, triggeredById: string) {
    const story = await prisma.story.findUnique({ where: { id: storyId } });
    if (!story) throw new NotFoundException(`Story ${storyId} not found`);

    const run = await prisma.run.create({
      data: {
        storyId,
        triggeredById,
        status: 'queued',
        steps: {
          create: LIFECYCLE_GRAPH.map((node, i) => ({
            name: node.name,
            type: node.type,
            ordinal: i,
            status: 'pending',
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

  /** Put a paused run back in the queue and announce it so a worker re-claims. */
  private async requeue(runId: string) {
    await prisma.run.update({ where: { id: runId }, data: { status: 'queued' } });
    this.bus.publish({ kind: 'run.status', runId, status: 'queued', at: new Date().toISOString() });
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
