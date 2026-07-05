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
import { ApproveGateInput, AnswerClarificationInput, RegenerateStepInput, type RunEvent } from '@qa/shared';

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

  @Get('runs/:id')
  @UseGuards(AuthenticatedGuard)
  get(@Param('id') id: string) {
    return this.runs.getRun(id);
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

  @Post('runs/:id/cancel')
  @UseGuards(AuthenticatedGuard)
  cancel(@Param('id') id: string) {
    return this.runs.cancelRun(id);
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
}
