import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Sse,
  UseGuards,
  type MessageEvent,
} from '@nestjs/common';
import type { Request } from 'express';
import { map, type Observable } from 'rxjs';
import { RunsService } from './runs.service.js';
import { EventsBus } from './events.bus.js';
import { AuthenticatedGuard } from '../common/authenticated.guard.js';
import type { SessionUser } from '../auth/session.serializer.js';
import {
  ApproveGateInput,
  AnswerClarificationInput,
  RegenerateStepInput,
  RestartStepInput,
  RetryFailedRunsInput,
  SubmitCredentialInput,
  type RunEvent,
} from '@qa/shared';

@Controller()
export class RunsController {
  constructor(
    private readonly runs: RunsService,
    private readonly bus: EventsBus,
  ) {}

  // ── Tester-facing ────────────────────────────────────────────────────────
  @Post('stories/:storyId/runs')
  @UseGuards(AuthenticatedGuard)
  create(@Param('storyId') storyId: string, @Req() req: Request) {
    const user = req.user as SessionUser;
    return this.runs.createRun(storyId, user.id);
  }

  /**
   * Paused-run queue (Run Lifecycle Management, §6b). MUST be declared before
   * the `runs/:id` route below — Nest/Express match in registration order, so
   * a literal segment route needs to win before the `:id` wildcard would
   * otherwise swallow it.
   */
  @Get('runs/interrupted')
  @UseGuards(AuthenticatedGuard)
  interrupted() {
    return this.runs.listInterrupted();
  }

  @Get('runs/:id')
  @UseGuards(AuthenticatedGuard)
  get(@Param('id') id: string) {
    return this.runs.getRun(id);
  }

  /** AI Explainability (M2): per-artifact explanations + Review Confidence. */
  @Get('runs/:id/explain')
  @UseGuards(AuthenticatedGuard)
  explain(@Param('id') id: string) {
    return this.runs.explain(id);
  }

  /** Activity Timeline (M6): deterministic milestone timeline from persisted steps. */
  @Get('runs/:id/timeline')
  @UseGuards(AuthenticatedGuard)
  timeline(@Param('id') id: string) {
    return this.runs.timeline(id);
  }

  /** Live timeline. SSE stream of RunEvents for one run. */
  @Sse('runs/:id/events')
  events(@Param('id') id: string): Observable<MessageEvent> {
    return this.bus.forRun(id).pipe(map((e: RunEvent) => ({ data: e, type: e.kind })));
  }

  @Post('runs/:runId/steps/:stepId/approve')
  @UseGuards(AuthenticatedGuard)
  approve(@Param('stepId') stepId: string, @Body() body: ApproveGateInput, @Req() req: Request) {
    const user = req.user as SessionUser;
    const dto = ApproveGateInput.parse(body);
    return this.runs.decideGate(stepId, dto.decision, dto.feedback, user.id);
  }

  @Post('runs/:runId/steps/:stepId/answer')
  @UseGuards(AuthenticatedGuard)
  answer(@Param('stepId') stepId: string, @Body() body: AnswerClarificationInput, @Req() req: Request) {
    const user = req.user as SessionUser;
    const dto = AnswerClarificationInput.parse(body);
    return this.runs.answerClarification(stepId, dto.answers, user.id);
  }

  @Post('runs/:runId/steps/:stepId/credential')
  @UseGuards(AuthenticatedGuard)
  credential(@Param('stepId') stepId: string, @Body() body: SubmitCredentialInput, @Req() req: Request) {
    const user = req.user as SessionUser;
    const dto = SubmitCredentialInput.parse(body);
    return this.runs.submitCredential(stepId, dto.decision, dto.values, user.id);
  }

  @Post('runs/:runId/steps/:stepId/regenerate')
  @UseGuards(AuthenticatedGuard)
  regenerate(@Param('stepId') stepId: string, @Body() body: RegenerateStepInput, @Req() req: Request) {
    const user = req.user as SessionUser;
    const dto = RegenerateStepInput.parse(body);
    return this.runs.regenerateStep(stepId, dto.feedback, user.id);
  }

  @Post('runs/:runId/steps/:stepId/skip')
  @UseGuards(AuthenticatedGuard)
  skip(@Param('stepId') stepId: string, @Req() req: Request) {
    const user = req.user as SessionUser;
    return this.runs.skipStep(stepId, user.id);
  }

  /** Retry Failed Step (Run Lifecycle Management): re-run just this one step. */
  @Post('runs/:runId/steps/:stepId/retry')
  @UseGuards(AuthenticatedGuard)
  retry(@Param('stepId') stepId: string, @Req() req: Request) {
    const user = req.user as SessionUser;
    return this.runs.retryStep(stepId, user.id);
  }

  /** Bulk Retry Failed Steps across the paused-run queue. */
  @Post('runs/retry-failed')
  @UseGuards(AuthenticatedGuard)
  retryFailed(@Body() body: RetryFailedRunsInput, @Req() req: Request) {
    const user = req.user as SessionUser;
    const dto = RetryFailedRunsInput.parse(body);
    return this.runs.retryFailedRuns(dto.runIds, user.id);
  }

  /** Restart From Step (Run Lifecycle Management): re-run this step + everything after it. */
  @Post('runs/:runId/steps/:stepId/restart')
  @UseGuards(AuthenticatedGuard)
  restart(@Param('stepId') stepId: string, @Body() body: RestartStepInput, @Req() req: Request) {
    const user = req.user as SessionUser;
    const dto = RestartStepInput.parse(body);
    return this.runs.restartFromStep(stepId, dto.feedback, user.id);
  }

  @Post('runs/:id/cancel')
  @UseGuards(AuthenticatedGuard)
  cancel(@Param('id') id: string) {
    return this.runs.cancelRun(id);
  }

  /** Manual Pause (Run Lifecycle Management): graceful stop at the next step boundary. */
  @Post('runs/:id/pause')
  @UseGuards(AuthenticatedGuard)
  pause(@Param('id') id: string) {
    return this.runs.pauseRun(id);
  }

  @Post('runs/:id/resume')
  @UseGuards(AuthenticatedGuard)
  resume(@Param('id') id: string) {
    return this.runs.resumeRun(id);
  }

  // ── Worker-facing (local trusted worker; unguarded) ───────────────────────
  /** Full run detail for the worker (resume/hydration). Unguarded — local worker. */
  @Get('runs/:id/detail')
  detail(@Param('id') id: string) {
    return this.runs.getRun(id);
  }

  /** Cheap status-only poll for the worker's cancellation check. Unguarded — local worker. */
  @Get('runs/:id/status')
  runStatus(@Param('id') id: string) {
    return this.runs.getStatus(id);
  }

  @Post('runs/claim')
  @HttpCode(200)
  claim(@Query('workerId') workerId: string) {
    return this.runs.claimNext(workerId ?? 'local-dev');
  }

  @Post('runs/:id/ingest')
  @HttpCode(200)
  ingest(@Body() event: RunEvent) {
    return this.runs.ingest(event);
  }

  /** LLM Request Log capture from the worker's ai() seam (#7). Unguarded — local worker. */
  @Post('runs/:id/llm-log')
  @HttpCode(200)
  llmLog(@Param('id') id: string, @Body() rec: Record<string, unknown>) {
    return this.runs.logLlmRequest(id, rec);
  }

  /** Artifact versioning (Run Lifecycle Management, §5b). Unguarded — local worker. */
  @Get('runs/:id/artifacts/next-version')
  nextArtifactVersion(@Param('id') id: string, @Query('name') name: string) {
    return this.runs.nextArtifactVersion(id, name);
  }

  @Post('runs/:id/artifacts')
  @HttpCode(200)
  recordArtifact(@Param('id') id: string, @Body() rec: { kind: string; name: string; version: number; localPath: string }) {
    return this.runs.recordArtifact(id, rec);
  }
}
