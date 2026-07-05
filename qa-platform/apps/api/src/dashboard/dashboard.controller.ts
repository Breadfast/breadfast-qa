import { Controller, Get, UseGuards } from '@nestjs/common';
import { prisma } from '@qa/db';
import { AuthenticatedGuard } from '../common/authenticated.guard.js';

@Controller('dashboard')
@UseGuards(AuthenticatedGuard)
export class DashboardController {
  /** Aggregated cards for the dashboard landing page. */
  @Get()
  async summary() {
    const [active, completed, running, defects, recentRuns, awaitingGates] = await Promise.all([
      prisma.story.count({ where: { status: { in: ['analyzing', 'awaiting_approval', 'ready', 'executing'] } } }),
      prisma.story.count({ where: { status: { in: ['reported', 'signed_off'] } } }),
      prisma.run.count({ where: { status: 'running' } }),
      prisma.defect.count({ where: { status: 'open' } }),
      prisma.run.findMany({
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: { story: { select: { jiraKey: true, title: true } } },
      }),
      prisma.runStep.count({ where: { status: { in: ['awaiting_approval', 'awaiting_input'] } } }),
    ]);

    return {
      cards: { active, completed, running, defects, awaitingGates },
      recentRuns,
      // Coverage is wired in Phase 2 (execution); placeholder until then.
      coverage: null,
    };
  }
}
