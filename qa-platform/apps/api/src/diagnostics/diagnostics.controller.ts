import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthenticatedGuard } from '../common/authenticated.guard.js';
import { DiagnosticsService } from './diagnostics.service.js';

@Controller('diagnostics')
export class DiagnosticsController {
  constructor(private readonly svc: DiagnosticsService) {}

  @Get()
  @UseGuards(AuthenticatedGuard)
  report() {
    return this.svc.report();
  }

  /** Re-run checks (simple + correct: re-runs all and returns the fresh report). */
  @Post(':id/retest')
  @UseGuards(AuthenticatedGuard)
  retest(@Param('id') _id: string) {
    return this.svc.report();
  }
}
