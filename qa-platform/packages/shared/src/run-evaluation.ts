/**
 * Run Evaluation engine — Roadmap Phase 1 #5 (and the shared substrate that
 * Review Confidence + Story Health will reuse in Phase 2).
 *
 * A deterministic evaluation of a completed (or in-progress) run's state. This
 * module computes the Platform Parity Certification: an overall score, the
 * required vs executed platform×locale combos, the missing-coverage dimensions
 * (workflow stages, AC, visual, automation), and a certification verdict.
 *
 * Pure and side-effect-free: all inputs are plain data assembled by the caller
 * (the worker's html_report node). Weights/thresholds are documented constants so
 * the score is explainable and tunable — never a black box.
 */
import { platformNeeds, type Platform } from './domain.js';

// ── Inputs (all optional/defensive — evaluation degrades gracefully) ──────────
export interface RunEvaluationInput {
  platform: string;
  locales: string[];
  /** Node names the tester enabled (null/empty ⇒ all nodes). */
  enabledNodes?: readonly string[] | null;
  /** Node names that reached a successful terminal state. */
  completedNodes?: readonly string[];
  acceptanceCriteria?: { criteria?: Array<{ id: string; testable?: boolean }> } | null;
  testCases?: {
    cases?: Array<{ title: string; automationStatus?: string; sources?: Array<{ kind: string; ref: string }> }>;
  } | null;
  execution?: {
    executed?: boolean;
    matrix?: string[];
    summary?: { total?: number; passed?: number };
    cases?: Array<{ status: string; combo: string; evidence?: unknown[]; sources?: Array<{ kind: string; ref: string }> }>;
  } | null;
  /** From FigmaAnalysis — how many frames were exported (visual reference exists?). */
  figmaFrameCount?: number;
  /** From VisualComparison (#6) — screens actually compared to a frame. */
  visual?: { comparedScreens?: number; screens?: Array<{ combo: string; verdict: string }> } | null;
  automation?: { specsWritten?: number } | null;
}

export type CertificationStatus = 'certified' | 'partial' | 'not-certified';

export interface ParityCertification {
  score: number; // 0–100
  certification: CertificationStatus;
  requiredCombos: string[];
  executedCombos: string[];
  missingWorkflowStages: string[];
  missingAcCoverage: string[]; // testable AC ids not covered by a citing test case
  missingVisualCoverage: string[]; // required combos with no visual comparison (only when frames exist)
  missingAutomationCoverage: string[]; // test cases not marked Automated
  acCoverageRate: number; // 0–1
  comboCoverageRate: number; // 0–1
  notes: string;
}

// Tunable weights/thresholds (documented, deterministic).
const W_AC = 0.6; // weight of AC-pass coverage in the overall score
const W_COMBO = 0.4; // weight of platform×locale combo coverage
const CERTIFIED_MIN = 90;
const PARTIAL_MIN = 60;

/** Node → the ctx.state key that proves it ran (for missing-stage detection). */
export const NODE_STATE_KEY: Record<string, string> = {
  requirements_analysis: 'requirements',
  acceptance_criteria: 'acceptanceCriteria',
  comments_analysis: 'comments',
  linked_stories: 'linkedStories',
  figma_analysis: 'figma',
  impact_analysis: 'impact',
  generate_hls: 'hls',
  generate_testcases: 'testcases',
  exploratory_testing: 'exploratory',
  automation_generation: 'automationPlan',
  execution: 'execution',
};

/** Required platform×locale combos, e.g. ["android · en-US","ios · ar-EG"]. */
export function requiredCombos(platform: string, locales: string[]): string[] {
  const needs = platformNeeds(platform as Platform);
  const plats: string[] = [];
  if (needs.web) plats.push('web');
  if (needs.android) plats.push('android');
  if (needs.ios) plats.push('ios');
  const locs = locales.length ? locales : ['en-US'];
  const combos: string[] = [];
  for (const p of plats) for (const l of locs) combos.push(`${p} · ${l}`);
  return combos;
}

export function computeParityCertification(input: RunEvaluationInput): ParityCertification {
  const required = requiredCombos(input.platform, input.locales);

  // Executed combos: from the execution matrix (preferred) or per-case combos.
  const executed = [
    ...new Set([
      ...(input.execution?.matrix ?? []),
      ...((input.execution?.cases ?? []).map((c) => c.combo)),
    ]),
  ].filter(Boolean);
  const executedRequired = required.filter((c) => executed.includes(c));
  const comboCoverageRate = required.length ? executedRequired.length / required.length : 0;

  // AC coverage: testable AC ids referenced by a test case citation (kind 'ac').
  const testableAc = (input.acceptanceCriteria?.criteria ?? []).filter((a) => a.testable !== false).map((a) => a.id);
  const citedAc = new Set<string>();
  for (const c of input.testCases?.cases ?? []) {
    for (const s of c.sources ?? []) if (s.kind === 'ac') citedAc.add(s.ref);
  }
  // Citations are new (may be absent). Only report AC as "missing" when at least
  // one AC citation exists anywhere — otherwise linkage is simply unavailable.
  const haveAcCitations = citedAc.size > 0;
  const missingAcCoverage = haveAcCitations ? testableAc.filter((id) => !citedAc.has(id)) : [];
  const acCoverageRate = !testableAc.length ? 1 : haveAcCitations ? citedAc.size / testableAc.length : 0;

  // Missing workflow stages: enabled nodes that produced no state output.
  const enabled = input.enabledNodes && input.enabledNodes.length ? new Set(input.enabledNodes) : null;
  const completed = new Set(input.completedNodes ?? []);
  const missingWorkflowStages = Object.entries(NODE_STATE_KEY)
    .filter(([node]) => (!enabled || enabled.has(node)) && !completed.has(node))
    .map(([node]) => node);

  // Visual coverage: only meaningful when Figma frames were exported.
  const hasFrames = (input.figmaFrameCount ?? 0) > 0;
  // VT1-S2: a coverage-gap screen did NOT actually compare a frame, so it must
  // not count as covering its combo.
  const visualCombos = new Set((input.visual?.screens ?? []).filter((s) => s.verdict !== 'coverage-gap').map((s) => s.combo));
  const missingVisualCoverage = hasFrames ? required.filter((c) => !visualCombos.has(c)) : [];

  // Automation coverage: test cases not marked Automated.
  const missingAutomationCoverage = (input.testCases?.cases ?? [])
    .filter((c) => (c.automationStatus ?? 'Not Automated') !== 'Automated')
    .map((c) => c.title);

  // Overall score: weighted AC-coverage + combo-coverage (both 0–1).
  const score = Math.round(100 * (W_AC * acCoverageRate + W_COMBO * comboCoverageRate));

  const certification: CertificationStatus =
    score >= CERTIFIED_MIN && missingWorkflowStages.length === 0 && missingAcCoverage.length === 0
      ? 'certified'
      : score >= PARTIAL_MIN
        ? 'partial'
        : 'not-certified';

  const notes = [
    !haveAcCitations && testableAc.length ? 'AC↔case citations unavailable — AC coverage not measured.' : '',
    !hasFrames ? 'No Figma frames exported — visual coverage not evaluated.' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    score,
    certification,
    requiredCombos: required,
    executedCombos: executedRequired,
    missingWorkflowStages,
    missingAcCoverage,
    missingVisualCoverage,
    missingAutomationCoverage,
    acCoverageRate,
    comboCoverageRate,
    notes,
  };
}

// ── Review Confidence (Phase 2 M2) ────────────────────────────────────────────
// DETERMINISTIC confidence from execution evidence + workflow completeness —
// NOT an LLM self-estimate. Same input → same output; changes only when evidence
// changes. Each signal is scored only when APPLICABLE (the phase it depends on
// was enabled), and a reduction reason is produced for every applicable signal
// that is unmet.
export interface ReviewSignal {
  key: string;
  label: string;
  applicable: boolean;
  satisfied: boolean;
  /** Human reason shown when applicable && !satisfied. */
  reduction?: string;
}
export type ReviewLevel = 'high' | 'medium' | 'low';
export interface ReviewConfidence {
  score: number; // 0–100 over applicable signals
  level: ReviewLevel;
  signals: ReviewSignal[];
  reductions: string[]; // why confidence is below 100
}

export function computeReviewConfidence(input: RunEvaluationInput): ReviewConfidence {
  const enabled = input.enabledNodes && input.enabledNodes.length ? new Set(input.enabledNodes) : null;
  const on = (node: string) => !enabled || enabled.has(node);
  const done = new Set(input.completedNodes ?? []);

  const testableAc = (input.acceptanceCriteria?.criteria ?? []).filter((a) => a.testable !== false);
  const citedAc = new Set<string>();
  for (const c of input.testCases?.cases ?? []) for (const s of c.sources ?? []) if (s.kind === 'ac') citedAc.add(s.ref);
  const anyCitations = citedAc.size > 0;
  const execRan = input.execution?.executed !== false && (input.execution?.summary?.total ?? 0) >= 0 && !!input.execution;
  const anyEvidence = (input.execution?.cases ?? []).some((c) => (c as { evidence?: unknown[] }).evidence?.length);
  const hasFrames = (input.figmaFrameCount ?? 0) > 0;

  const S = (key: string, label: string, applicable: boolean, satisfied: boolean, reduction: string): ReviewSignal => ({
    key,
    label,
    applicable,
    satisfied,
    reduction: applicable && !satisfied ? reduction : undefined,
  });

  const signals: ReviewSignal[] = [
    S('requirements_analyzed', 'Requirements analyzed', on('requirements_analysis'), done.has('requirements_analysis'),
      'Requirements analysis did not complete'),
    S('ac_mapped', 'Acceptance Criteria mapped', on('acceptance_criteria') && testableAc.length > 0, anyCitations,
      'Acceptance Criteria not fully mapped to test cases'),
    S('comments_analyzed', 'Story comments analyzed', on('comments_analysis'), done.has('comments_analysis'),
      'Story comments not analyzed'),
    S('figma_analyzed', 'Figma analyzed', on('figma_analysis'), hasFrames,
      'Missing Figma analysis (no frames)'),
    S('visual_comparison', 'Visual comparison completed', on('figma_analysis') && hasFrames,
      (input.visual?.comparedScreens ?? 0) > 0, 'Visual comparison skipped'),
    S('testcases_generated', 'BrowserStack test cases generated', on('generate_testcases'),
      (input.testCases?.cases?.length ?? 0) > 0, 'No test cases generated'),
    S('browserstack_imported', 'BrowserStack import verified', on('gate_upload_browserstack'),
      done.has('gate_upload_browserstack'), 'BrowserStack import not verified'),
    S('automation_generated', 'Automation generated', on('automation_generation'),
      (input.automation?.specsWritten ?? 0) > 0, 'Automation not generated'),
    S('automation_executed', 'Automation / execution ran', on('execution'), execRan,
      'Automation not executed'),
    S('report_generated', 'HTML report generated', on('html_report'), done.has('html_report') || true,
      'Report not generated'),
    S('evidence_collected', 'Evidence collected', on('execution'), anyEvidence,
      'Missing evidence'),
    S('defects_reviewed', 'Defects reviewed', on('gate_file_bugs'), done.has('gate_file_bugs'),
      'Defects not reviewed'),
    S('traceability', 'Traceability complete', (input.testCases?.cases?.length ?? 0) > 0, anyCitations,
      'Traceability incomplete (artifacts lack citations)'),
  ];

  const applicable = signals.filter((s) => s.applicable);
  const satisfied = applicable.filter((s) => s.satisfied);
  const score = applicable.length ? Math.round((satisfied.length / applicable.length) * 100) : 100;
  const level: ReviewLevel = score >= 80 ? 'high' : score >= 50 ? 'medium' : 'low';
  const reductions = applicable.filter((s) => !s.satisfied).map((s) => s.reduction as string);

  return { score, level, signals, reductions };
}

// ── Story Health (Phase 2 M4) ─────────────────────────────────────────────────
// A deterministic six-dimension roll-up of overall story quality, computed by
// REUSING existing evaluation outputs — Parity Certification, Review Confidence,
// and Visual Health — plus persisted execution/defect/citation data. Adds ZERO
// AI invocations (ADR-001): it derives entirely from data other steps already
// produced. Each dimension is scored 0–100 and gated by applicability (its phase
// ran / its precondition holds), so a skipped phase never unfairly lowers health.
export type HealthLevel = 'high' | 'medium' | 'low';

export interface StoryHealthDimension {
  key: string;
  label: string;
  applicable: boolean;
  score: number; // 0–100 (only meaningful when applicable)
  level: HealthLevel;
  detail: string; // human, evidence-based explanation
}

export interface StoryHealth {
  score: number; // 0–100 mean of applicable dimensions
  level: HealthLevel;
  dimensions: StoryHealthDimension[];
  reductions: string[]; // plain-language reasons health is below 100
  summary: string;
}

// Defect burden penalties (severity-weighted), documented + tunable.
const DEFECT_PENALTY: Record<string, number> = { Critical: 30, High: 15, Medium: 6, Low: 2 };
const levelOf = (n: number): HealthLevel => (n >= 80 ? 'high' : n >= 50 ? 'medium' : 'low');

export interface StoryHealthExtras {
  /** From computeVisualHealth() — passed in so we never recompute (frugality). */
  visualHealth?: { visualHealth: number; screensValidated: number; screensCoverageGap?: number } | null;
  /** Defects surfaced during execution (severity drives the Defects dimension). */
  defects?: Array<{ severity?: string }> | null;
}

/**
 * Deterministic overall Story Health. Reuses the Parity Certification and Review
 * Confidence already computed for the run, plus the same RunEvaluationInput and
 * (optionally) the Visual Health + defects. Pure — same inputs ⇒ same output.
 */
export function computeStoryHealth(
  input: RunEvaluationInput,
  parity: ParityCertification,
  review: ReviewConfidence,
  extras: StoryHealthExtras = {},
): StoryHealth {
  const enabled = input.enabledNodes && input.enabledNodes.length ? new Set(input.enabledNodes) : null;
  const on = (node: string) => !enabled || enabled.has(node);

  // Requirements — captured & testable.
  const ac = input.acceptanceCriteria?.criteria ?? [];
  const testableAc = ac.filter((a) => a.testable !== false);
  const reqApplicable = on('requirements_analysis') || on('acceptance_criteria');
  const reqDone = (input.completedNodes ?? []).includes('requirements_analysis');
  const testableRatio = ac.length ? testableAc.length / ac.length : 1;
  const reqScore = Math.round(((reqDone ? 0.5 : 0) + 0.5 * testableRatio) * 100);

  // Coverage — AC↔case mapping + platform×locale combo coverage (reuse parity).
  const citedAc = new Set<string>();
  for (const c of input.testCases?.cases ?? []) for (const s of c.sources ?? []) if (s.kind === 'ac') citedAc.add(s.ref);
  const acMeasurable = citedAc.size > 0 || testableAc.length === 0;
  const covApplicable = on('generate_testcases') && (input.testCases?.cases?.length ?? 0) >= 0;
  const covScore = Math.round(100 * (0.6 * (acMeasurable ? parity.acCoverageRate : 0) + 0.4 * parity.comboCoverageRate));

  // Execution — pass rate of executed cases.
  const sum = input.execution?.summary ?? {};
  const execTotal = sum.total ?? 0;
  const execApplicable = on('execution') && input.execution?.executed !== false && !!input.execution;
  const execScore = execTotal > 0 ? Math.round(((sum.passed ?? 0) / execTotal) * 100) : 0;

  // Visual — reuse Visual Health (M3).
  const visApplicable = (extras.visualHealth?.screensValidated ?? 0) > 0;
  const visScore = extras.visualHealth?.visualHealth ?? 0;

  // Defects — inverse severity-weighted burden (fewer/less severe ⇒ healthier).
  const defects = extras.defects ?? [];
  const defApplicable = execApplicable;
  const defPenalty = defects.reduce((acc, d) => acc + (DEFECT_PENALTY[d.severity ?? 'Medium'] ?? 6), 0);
  const defScore = Math.max(0, 100 - defPenalty);

  // Traceability — citations across test cases + defects.
  const cases = input.testCases?.cases ?? [];
  const casesWithCite = cases.filter((c) => (c.sources ?? []).length > 0).length;
  const traceApplicable = cases.length > 0;
  const traceScore = cases.length ? Math.round((casesWithCite / cases.length) * 100) : 0;

  const dims: StoryHealthDimension[] = [
    { key: 'requirements', label: 'Requirements', applicable: reqApplicable, score: reqScore, level: levelOf(reqScore),
      detail: reqApplicable ? `${testableAc.length}/${ac.length || 0} acceptance criteria testable; analysis ${reqDone ? 'completed' : 'incomplete'}.` : 'Requirements phase not enabled.' },
    { key: 'coverage', label: 'Coverage', applicable: covApplicable, score: covScore, level: levelOf(covScore),
      detail: covApplicable ? `${Math.round(parity.acCoverageRate * 100)}% AC mapped to cases; ${parity.executedCombos.length}/${parity.requiredCombos.length} combos covered.` : 'Test-case generation not enabled.' },
    { key: 'execution', label: 'Execution', applicable: execApplicable, score: execScore, level: levelOf(execScore),
      detail: execApplicable ? `${sum.passed ?? 0}/${execTotal} passed.` : 'Execution not run.' },
    { key: 'visual', label: 'Visual', applicable: visApplicable, score: visScore, level: levelOf(visScore),
      detail: visApplicable
        ? `Visual health ${visScore} across ${extras.visualHealth?.screensValidated} screen(s).${(extras.visualHealth?.screensCoverageGap ?? 0) > 0 ? ` ${extras.visualHealth?.screensCoverageGap} coverage gap(s).` : ''}`
        : 'No visual comparison performed.' },
    { key: 'defects', label: 'Defects', applicable: defApplicable, score: defScore, level: levelOf(defScore),
      detail: defApplicable ? `${defects.length} defect(s); severity-weighted burden ${defPenalty}.` : 'No execution ⇒ no defect signal.' },
    { key: 'traceability', label: 'Traceability', applicable: traceApplicable, score: traceScore, level: levelOf(traceScore),
      detail: traceApplicable ? `${casesWithCite}/${cases.length} test cases carry citations.` : 'No test cases to trace.' },
  ];

  const applicable = dims.filter((d) => d.applicable);
  const score = applicable.length ? Math.round(applicable.reduce((a, d) => a + d.score, 0) / applicable.length) : 100;
  const level = levelOf(score);
  const reductions = applicable
    .filter((d) => d.level !== 'high')
    .map((d) => `${d.label}: ${d.detail}`);
  const summary = `Overall Story Health ${score}/100 (${level}) across ${applicable.length} applicable dimension(s). Review Confidence ${review.score}, Parity ${parity.score}.`;

  return { score, level, dimensions: dims, reductions, summary };
}
