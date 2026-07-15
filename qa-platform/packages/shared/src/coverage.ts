/**
 * Coverage Matrix — Roadmap Phase 4.
 *
 * DETERMINISTIC cross-story coverage view built by REUSING the Run Evaluation
 * engine's per-run ParityCertification (AC coverage, platform×locale combo
 * coverage, missing visual/automation coverage) plus test-case counts. Adds ZERO
 * AI invocations (ADR-001): pure aggregation over persisted parity snapshots.
 *
 * The caller (api AnalyticsService) supplies one record per story (its latest
 * completed run's parity + test-case count); this module owns the maths.
 */
import type { ParityCertification } from './run-evaluation.js';

export interface CoverageStoryRecord {
  storyId: string;
  storyKey: string;
  title?: string;
  platform?: string;
  locales?: string[];
  parity?: Partial<ParityCertification> | null;
  testCaseCount?: number;
  latestRunAt?: Date | string | number | null;
}

export interface CoverageRow {
  storyKey: string;
  title: string;
  platform: string;
  acCoverage: number | null; // % testable AC mapped to a citing test case (null = unmeasured)
  comboCoverage: number; // % required platform×locale combos executed
  automationCoverage: number | null; // % test cases automated (null = no test cases)
  visualCoverage: number | null; // % required combos visually compared (null = no Figma frames)
  requiredCombos: number;
  executedCombos: number;
  testCaseCount: number;
  certified: boolean;
  gaps: string[];
}

export interface CoverageMatrix {
  rows: CoverageRow[];
  overall: {
    stories: number;
    storiesCertified: number;
    acCoverage: number | null; // average across stories where measured
    comboCoverage: number;
    automationCoverage: number | null;
    visualCoverage: number | null;
  };
  gaps: {
    storiesWithMissingAc: number;
    storiesWithMissingCombos: number;
    storiesWithMissingAutomation: number;
    storiesWithMissingVisual: number;
  };
}

const pct = (n: number) => Math.round(n * 100);
function avg(nums: Array<number | null>): number | null {
  const xs = nums.filter((n): n is number => typeof n === 'number');
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
}

/** Build the deterministic coverage matrix from per-story parity records. Pure. */
export function computeCoverageMatrix(stories: CoverageStoryRecord[]): CoverageMatrix {
  const rows: CoverageRow[] = stories
    .map((s) => {
      const p = s.parity ?? {};
      const required = p.requiredCombos?.length ?? 0;
      const executed = p.executedCombos?.length ?? 0;
      const tcCount = s.testCaseCount ?? 0;

      // AC coverage: measured only when parity established AC↔case linkage
      // (acCoverageRate is 0 with an "unavailable" note when no citations exist).
      const acMeasured = (p.missingAcCoverage?.length ?? 0) > 0 || (p.acCoverageRate ?? 0) > 0;
      const acCoverage = acMeasured ? pct(p.acCoverageRate ?? 0) : null;

      const comboCoverage = required ? Math.round((executed / required) * 100) : 0;

      const missingAuto = p.missingAutomationCoverage?.length ?? 0;
      const automationCoverage = tcCount > 0 ? Math.round(((tcCount - missingAuto) / tcCount) * 100) : null;

      // Visual coverage is only meaningful when Figma frames existed; the parity
      // engine leaves missingVisualCoverage empty otherwise. Treat "no missing +
      // no frames" as unmeasured (null) vs "frames present" as a real %.
      const missingVisual = p.missingVisualCoverage?.length ?? 0;
      const visualMeasured = missingVisual > 0 || required === 0 ? missingVisual > 0 : false;
      const visualCoverage = visualMeasured ? Math.round(((required - missingVisual) / Math.max(required, 1)) * 100) : null;

      const gaps: string[] = [];
      if (p.missingAcCoverage?.length) gaps.push(`${p.missingAcCoverage.length} AC uncovered`);
      if (required && executed < required) gaps.push(`${required - executed} combo(s) not executed`);
      if (missingAuto) gaps.push(`${missingAuto} case(s) not automated`);
      if (missingVisual) gaps.push(`${missingVisual} combo(s) no visual check`);

      return {
        storyKey: s.storyKey,
        title: s.title ?? '',
        platform: s.platform ?? '',
        acCoverage,
        comboCoverage,
        automationCoverage,
        visualCoverage,
        requiredCombos: required,
        executedCombos: executed,
        testCaseCount: tcCount,
        certified: p.certification === 'certified',
        gaps,
      };
    })
    .sort((a, b) => a.storyKey.localeCompare(b.storyKey));

  return {
    rows,
    overall: {
      stories: rows.length,
      storiesCertified: rows.filter((r) => r.certified).length,
      acCoverage: avg(rows.map((r) => r.acCoverage)),
      comboCoverage: avg(rows.map((r) => r.comboCoverage)) ?? 0,
      automationCoverage: avg(rows.map((r) => r.automationCoverage)),
      visualCoverage: avg(rows.map((r) => r.visualCoverage)),
    },
    gaps: {
      storiesWithMissingAc: rows.filter((r) => r.gaps.some((g) => g.includes('AC uncovered'))).length,
      storiesWithMissingCombos: rows.filter((r) => r.gaps.some((g) => g.includes('combo(s) not executed'))).length,
      storiesWithMissingAutomation: rows.filter((r) => r.gaps.some((g) => g.includes('not automated'))).length,
      storiesWithMissingVisual: rows.filter((r) => r.gaps.some((g) => g.includes('no visual check'))).length,
    },
  };
}
