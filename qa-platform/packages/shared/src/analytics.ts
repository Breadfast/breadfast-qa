/**
 * QA Analytics — Roadmap Phase 3.
 *
 * DETERMINISTIC cross-run / cross-story aggregation over the data Phase 1/2 already
 * persist (parity / review confidence / story health / recommendations + run
 * timing/cost + defects + story owner). Adds ZERO AI invocations (ADR-001): it is
 * pure aggregation over persisted rows — same input ⇒ same output.
 *
 * The caller (api AnalyticsService) loads the rows and maps them to
 * AnalyticsRunRecord[]; this module owns all the maths so it is unit-testable.
 */

type TimeInput = Date | string | number | null | undefined;

export interface AnalyticsDefect {
  severity?: string;
  status?: string;
}

export interface AnalyticsRunRecord {
  runId: string;
  storyId: string;
  storyKey: string;
  storyTitle?: string;
  platform?: string;
  ownerId?: string;
  ownerName?: string;
  status: string; // run status (succeeded/failed/…)
  createdAt?: TimeInput;
  startedAt?: TimeInput;
  finishedAt?: TimeInput;
  costUsd?: number;
  tokens?: number;
  parity?: { score?: number; certification?: string } | null;
  review?: { score?: number; level?: string } | null;
  health?: { score?: number; level?: string } | null;
  recommendations?: Array<{ category?: string; severity?: string }> | null;
  /** Story-level defects (attach the story's defects to its latest run, or per run). */
  defects?: AnalyticsDefect[] | null;
}

export interface TeamMemberInsight {
  ownerId: string;
  ownerName: string;
  runs: number;
  completedRuns: number;
  avgStoryHealth: number | null;
  avgReviewConfidence: number | null;
  avgParity: number | null;
  totalCostUsd: number;
  openDefects: number;
}

export interface AnalyticsTrendPoint {
  runId: string;
  storyKey: string;
  at: string | null;
  parity: number | null;
  review: number | null;
  health: number | null;
}

export interface AnalyticsSummary {
  totals: {
    stories: number;
    runs: number;
    completedRuns: number;
    successRate: number; // % of runs that succeeded
    totalCostUsd: number;
    totalTokens: number;
    openDefects: number;
    totalDefects: number;
  };
  averages: { parity: number | null; reviewConfidence: number | null; storyHealth: number | null };
  distributions: {
    parityCertification: Record<string, number>;
    storyHealthLevel: Record<string, number>;
    reviewLevel: Record<string, number>;
  };
  recommendations: { total: number; byCategory: Record<string, number>; bySeverity: Record<string, number> };
  defects: { bySeverity: Record<string, number>; byStatus: Record<string, number> };
  trend: AnalyticsTrendPoint[]; // chronological
  team: TeamMemberInsight[];
  generatedFromRuns: number;
}

const isDone = (status: string) => status === 'succeeded' || status === 'reported' || status === 'signed_off';
const round = (n: number) => Math.round(n);
function toIso(v: TimeInput): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
/** Average of the defined numeric values, or null when none. Deterministic. */
function avg(nums: Array<number | null | undefined>): number | null {
  const xs = nums.filter((n): n is number => typeof n === 'number' && !Number.isNaN(n));
  return xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
}
function bump(rec: Record<string, number>, key: string | undefined | null) {
  const k = (key ?? 'unknown').toString();
  rec[k] = (rec[k] ?? 0) + 1;
}

/** Compute the deterministic analytics summary from per-run records. Pure. */
export function computeAnalytics(records: AnalyticsRunRecord[]): AnalyticsSummary {
  const storyIds = new Set(records.map((r) => r.storyId));
  const completed = records.filter((r) => isDone(r.status));

  const parityCertification: Record<string, number> = {};
  const storyHealthLevel: Record<string, number> = {};
  const reviewLevel: Record<string, number> = {};
  const recByCategory: Record<string, number> = {};
  const recBySeverity: Record<string, number> = {};
  const defBySeverity: Record<string, number> = {};
  const defByStatus: Record<string, number> = {};

  let totalCostUsd = 0;
  let totalTokens = 0;
  let recTotal = 0;

  // Defects are counted once per story (dedupe by storyId) so multiple runs of the
  // same story don't double-count its defect set.
  const defectsByStory = new Map<string, AnalyticsDefect[]>();

  for (const r of records) {
    totalCostUsd += r.costUsd ?? 0;
    totalTokens += r.tokens ?? 0;
    if (r.parity?.certification) bump(parityCertification, r.parity.certification);
    if (r.health?.level) bump(storyHealthLevel, r.health.level);
    if (r.review?.level) bump(reviewLevel, r.review.level);
    for (const rec of r.recommendations ?? []) {
      recTotal++;
      bump(recByCategory, rec.category);
      bump(recBySeverity, rec.severity);
    }
    if (r.defects && !defectsByStory.has(r.storyId)) defectsByStory.set(r.storyId, r.defects);
  }

  let openDefects = 0;
  let totalDefects = 0;
  for (const defects of defectsByStory.values()) {
    for (const d of defects) {
      totalDefects++;
      bump(defBySeverity, d.severity);
      bump(defByStatus, d.status);
      if ((d.status ?? 'open') === 'open') openDefects++;
    }
  }

  // Team insights — group by story owner.
  const byOwner = new Map<string, AnalyticsRunRecord[]>();
  for (const r of records) {
    const id = r.ownerId ?? 'unknown';
    (byOwner.get(id) ?? byOwner.set(id, []).get(id)!).push(r);
  }
  const team: TeamMemberInsight[] = [...byOwner.entries()]
    .map(([ownerId, rs]) => {
      const ownerStories = new Set(rs.map((r) => r.storyId));
      let owed = 0;
      for (const sid of ownerStories) {
        for (const d of defectsByStory.get(sid) ?? []) if ((d.status ?? 'open') === 'open') owed++;
      }
      return {
        ownerId,
        ownerName: rs.find((r) => r.ownerName)?.ownerName ?? ownerId,
        runs: rs.length,
        completedRuns: rs.filter((r) => isDone(r.status)).length,
        avgStoryHealth: avg(rs.map((r) => r.health?.score)),
        avgReviewConfidence: avg(rs.map((r) => r.review?.score)),
        avgParity: avg(rs.map((r) => r.parity?.score)),
        totalCostUsd: Math.round(rs.reduce((a, r) => a + (r.costUsd ?? 0), 0) * 10000) / 10000,
        openDefects: owed,
      };
    })
    .sort((a, b) => a.ownerName.localeCompare(b.ownerName));

  const trend: AnalyticsTrendPoint[] = records
    .map((r) => ({
      runId: r.runId,
      storyKey: r.storyKey,
      at: toIso(r.createdAt ?? r.startedAt),
      parity: r.parity?.score ?? null,
      review: r.review?.score ?? null,
      health: r.health?.score ?? null,
    }))
    .sort((a, b) => (a.at && b.at ? (a.at < b.at ? -1 : a.at > b.at ? 1 : a.runId.localeCompare(b.runId)) : a.at ? -1 : b.at ? 1 : a.runId.localeCompare(b.runId)));

  return {
    totals: {
      stories: storyIds.size,
      runs: records.length,
      completedRuns: completed.length,
      successRate: records.length ? round((completed.length / records.length) * 100) : 0,
      totalCostUsd: Math.round(totalCostUsd * 10000) / 10000,
      totalTokens,
      openDefects,
      totalDefects,
    },
    averages: {
      parity: avg(records.map((r) => r.parity?.score)),
      reviewConfidence: avg(records.map((r) => r.review?.score)),
      storyHealth: avg(records.map((r) => r.health?.score)),
    },
    distributions: { parityCertification, storyHealthLevel, reviewLevel },
    recommendations: { total: recTotal, byCategory: recByCategory, bySeverity: recBySeverity },
    defects: { bySeverity: defBySeverity, byStatus: defByStatus },
    trend,
    team,
    generatedFromRuns: records.length,
  };
}
