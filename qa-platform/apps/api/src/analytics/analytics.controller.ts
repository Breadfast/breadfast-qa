import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthenticatedGuard } from '../common/authenticated.guard.js';
import { AnalyticsService } from './analytics.service.js';

@Controller()
@UseGuards(AuthenticatedGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /** Phase 3 — QA Analytics (trends, distributions, recommendations, defects, team insights). */
  @Get('analytics')
  getAnalytics() {
    return this.analytics.analytics();
  }

  /** Phase 4 — Coverage Matrix (per-story AC / combo / automation / visual coverage). */
  @Get('coverage')
  getCoverage() {
    return this.analytics.coverage();
  }
}
