import { Injectable } from '@nestjs/common';
import { prisma } from '@qa/db';
import {
  computeAnalytics,
  computeCoverageMatrix,
  type AnalyticsRunRecord,
  type AnalyticsSummary,
  type CoverageMatrix,
  type CoverageStoryRecord,
} from '@qa/shared';

/**
 * Phase 3 (QA Analytics) + Phase 4 (Coverage Matrix) read-side.
 *
 * DETERMINISTIC aggregation over PERSISTED data only — no AI (ADR-001). Loads the
 * per-run intelligence snapshots (parity/review/storyHealth/recommendations) +
 * run cost/timing + story owner + defects, and delegates all maths to the pure
 * @qa/shared engines.
 */
@Injectable()
export class AnalyticsService {
  /** Load defects grouped by story once (dedup handled downstream). */
  private async defectsByStory(): Promise<Map<string, Array<{ severity?: string; status?: string }>>> {
    const defects = await prisma.defect.findMany({ select: { storyId: true, severity: true, status: true } });
    const map = new Map<string, Array<{ severity?: string; status?: string }>>();
    for (const d of defects) {
      const arr = map.get(d.storyId) ?? map.set(d.storyId, []).get(d.storyId)!;
      arr.push({ severity: d.severity, status: d.status });
    }
    return map;
  }

  /** Phase 3 — cross-run analytics + team insights. */
  async analytics(): Promise<AnalyticsSummary> {
    const runs = await prisma.run.findMany({
      orderBy: { createdAt: 'asc' },
      include: { story: { include: { owner: { select: { id: true, name: true } } } } },
    });
    const defMap = await this.defectsByStory();
    // Attach a story's defects to only its FIRST run so computeAnalytics dedupes by storyId.
    const seenStory = new Set<string>();

    const records: AnalyticsRunRecord[] = runs.map((r) => {
      const firstForStory = !seenStory.has(r.storyId);
      seenStory.add(r.storyId);
      return {
        runId: r.id,
        storyId: r.storyId,
        storyKey: r.story?.jiraKey ?? r.storyId,
        storyTitle: r.story?.title,
        platform: r.story?.platform,
        ownerId: r.story?.owner?.id ?? r.story?.ownerId,
        ownerName: r.story?.owner?.name,
        status: r.status,
        createdAt: r.createdAt,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        costUsd: r.totalCostUsd,
        tokens: r.totalTokens,
        parity: (r.parityJson as AnalyticsRunRecord['parity']) ?? null,
        review: (r.reviewJson as AnalyticsRunRecord['review']) ?? null,
        health: (r.storyHealthJson as AnalyticsRunRecord['health']) ?? null,
        recommendations: (r.recommendationsJson as AnalyticsRunRecord['recommendations']) ?? null,
        defects: firstForStory ? defMap.get(r.storyId) ?? [] : null,
      };
    });
    return computeAnalytics(records);
  }

  /** Phase 4 — cross-story coverage matrix (latest parity-bearing run per story). */
  async coverage(): Promise<CoverageMatrix> {
    const stories = await prisma.story.findMany({
      include: {
        _count: { select: { testCases: true } },
        runs: { orderBy: { createdAt: 'desc' } },
      },
    });
    const records: CoverageStoryRecord[] = stories.map((s) => {
      const runWithParity = s.runs.find((r) => r.parityJson != null);
      return {
        storyId: s.id,
        storyKey: s.jiraKey,
        title: s.title,
        platform: s.platform,
        locales: (s.locales ?? '').split(',').filter(Boolean),
        parity: (runWithParity?.parityJson as CoverageStoryRecord['parity']) ?? null,
        testCaseCount: s._count.testCases,
        latestRunAt: s.runs[0]?.createdAt ?? null,
      };
    });
    return computeCoverageMatrix(records);
  }
}
