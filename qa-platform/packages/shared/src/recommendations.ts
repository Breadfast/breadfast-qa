/**
 * Recommendation Engine — Roadmap Phase 2, Milestone 5.
 *
 * DETERMINISTIC + rule-based (Layers 1 & 2 per the approved strategy). Adds ZERO
 * AI invocations (ADR-001): every recommendation is derived from structured
 * outputs other steps already produced — Parity Certification, Review Confidence,
 * Story Health, Visual findings + M3.5 patterns, defects, and traceability.
 *
 *   Layer 1 (deterministic) — one recommendation per concrete gap/signal.
 *   Layer 2 (rule-based)     — thresholds/grouping that turn many findings into a
 *                              single root-cause recommendation (reuses the M3.5
 *                              pattern detector: "5 sentence-case findings → fix
 *                              the shared typography token").
 *   Layer 3 (AI)            — NOT built. The Recommendation[] shape + this
 *                              pipeline are the seam a future AI recommender would
 *                              append to (with its own AI Impact Statement).
 *
 * Pure and side-effect-free: same inputs ⇒ same output, same order.
 */
import type { ParityCertification, ReviewConfidence, StoryHealth } from './run-evaluation.js';
import type { VisualComparison, VisualPattern, Citation } from './schemas.js';
import type { VisualHealth } from './visual.js';

export const RECOMMENDATION_CATEGORIES = [
  'Visual', 'Automation', 'Test Coverage', 'Regression', 'Design System', 'Accessibility',
  'Performance', 'Maintainability', 'Test Data', 'Knowledge', 'Framework', 'Process',
] as const;
export type RecommendationCategory = (typeof RECOMMENDATION_CATEGORIES)[number];

export const RECOMMENDATION_SEVERITIES = ['critical', 'major', 'minor', 'info'] as const;
export type RecommendationSeverity = (typeof RECOMMENDATION_SEVERITIES)[number];
export type Magnitude = 'high' | 'medium' | 'low';

export interface Recommendation {
  id: string; // stable, derived from the theme key (deterministic)
  title: string;
  category: RecommendationCategory;
  severity: RecommendationSeverity;
  impact: Magnitude;
  effort: Magnitude;
  expectedBenefit: string;
  confidence: Magnitude; // DETERMINISTIC (evidence strength), NOT a model estimate
  priorityScore: number; // deterministic ordering
  rootCause: string;
  actions: string[];
  eliminatesFindings: number; // how many findings one fix clears (drives priority)
  layer: 'deterministic' | 'rule';
  sources: Citation[]; // reuses Citation & Traceability
  derivedFrom: string[]; // which signal(s) produced/corroborated it → explainability
}

export interface RecommendationInput {
  parity: ParityCertification;
  review: ReviewConfidence;
  health: StoryHealth;
  visual?: VisualComparison | null;
  visualHealth?: VisualHealth | null;
  defects?: Array<{ title?: string; severity?: string; caseTitle?: string; component?: string }> | null;
  testCases?: { cases?: Array<{ title: string; automationStatus?: string }> } | null;
}

// ── Deterministic weights (documented + tunable) ──────────────────────────────
const SEV_W: Record<RecommendationSeverity, number> = { critical: 4, major: 3, minor: 2, info: 1 };
const MAG_W: Record<Magnitude, number> = { high: 3, medium: 2, low: 1 };
const CONF_RANK: Record<Magnitude, number> = { high: 3, medium: 2, low: 1 };
const DEFECT_SEV: Record<string, RecommendationSeverity> = { Critical: 'critical', High: 'major', Medium: 'minor', Low: 'info' };

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}
const maxConf = (a: Magnitude, b: Magnitude): Magnitude => (CONF_RANK[a] >= CONF_RANK[b] ? a : b);
const maxSev = (a: RecommendationSeverity, b: RecommendationSeverity): RecommendationSeverity =>
  SEV_W[a] >= SEV_W[b] ? a : b;

/**
 * Compute the prioritized, deterministic recommendation set for a run. Themes are
 * keyed so multiple corroborating signals MERGE into one recommendation (raising
 * confidence + accumulating provenance) rather than producing duplicates.
 */
export function computeRecommendations(input: RecommendationInput): Recommendation[] {
  const map = new Map<string, Recommendation>();

  // Upsert-by-theme so corroborating signals strengthen a single recommendation.
  const upsert = (
    key: string,
    r: Omit<Recommendation, 'id' | 'priorityScore'> & { priorityScore?: number },
  ) => {
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...r, id: slug(key), priorityScore: 0 });
      return;
    }
    existing.severity = maxSev(existing.severity, r.severity);
    existing.confidence = maxConf(existing.confidence, r.confidence);
    existing.eliminatesFindings = Math.max(existing.eliminatesFindings, r.eliminatesFindings);
    existing.derivedFrom = [...new Set([...existing.derivedFrom, ...r.derivedFrom])];
    existing.actions = [...new Set([...existing.actions, ...r.actions])];
    for (const s of r.sources) if (!existing.sources.some((e) => e.kind === s.kind && e.ref === s.ref)) existing.sources.push(s);
  };

  // ── Layer 2 — Visual/Design-System patterns (root cause: fix one, clear many) ──
  for (const p of (input.visual?.patterns ?? []) as VisualPattern[]) {
    const isDs = !!(p.component || p.token);
    const key = `ds:${p.key}`;
    const sev: RecommendationSeverity = p.severity;
    upsert(key, {
      title: p.recommendation || `Resolve recurring ${p.dimension} issue`,
      category: isDs ? 'Design System' : 'Visual',
      severity: sev,
      impact: p.occurrences >= 5 || sev === 'critical' || sev === 'major' ? 'high' : 'medium',
      // A single token change is low-effort; a shared component change is medium.
      effort: p.token && !p.component ? 'low' : 'medium',
      expectedBenefit: `One fix eliminates ${p.occurrences} finding(s) across ${p.screens.length || p.occurrences} screen(s).`,
      confidence: p.occurrences >= 3 ? 'high' : 'medium',
      rootCause: p.rootCause,
      actions: [p.recommendation].filter(Boolean) as string[],
      eliminatesFindings: p.occurrences,
      layer: 'rule',
      sources: [
        ...(p.component ? [{ kind: 'rule' as const, ref: p.component, label: p.component }] : []),
        ...(p.token ? [{ kind: 'rule' as const, ref: `token/${p.token.kind}`, label: `${p.token.kind} token` }] : []),
      ],
      derivedFrom: ['visual.patterns'],
    });
  }

  // ── Layer 1 — one-off visual findings not explained by a pattern ──
  const totalFindings = (input.visual?.screens ?? []).reduce((n, s) => n + (s.findings?.length ?? 0), 0);
  const patternedFindings = (input.visual?.patterns ?? []).reduce((n, p) => n + p.occurrences, 0);
  const oneOff = Math.max(0, totalFindings - patternedFindings);
  if (oneOff > 0) {
    upsert('visual:one-off', {
      title: `Address ${oneOff} one-off visual finding(s)`,
      category: 'Visual',
      severity: 'minor',
      impact: 'medium',
      effort: 'medium',
      expectedBenefit: 'Brings the remaining screens in line with the Figma design.',
      confidence: 'high',
      rootCause: 'Individual visual discrepancies without a shared root cause.',
      actions: ['Review the per-screen visual findings and correct each against its Figma frame.'],
      eliminatesFindings: oneOff,
      layer: 'deterministic',
      sources: [],
      derivedFrom: ['visual.findings'],
    });
  }

  // ── Layer 1 — Missing AC coverage (Test Coverage) ──
  if (input.parity.missingAcCoverage.length) {
    const ids = input.parity.missingAcCoverage;
    upsert('coverage:ac', {
      title: `Cover ${ids.length} unmapped acceptance criterion(s) with test cases`,
      category: 'Test Coverage',
      severity: 'major',
      impact: 'high',
      effort: 'medium',
      expectedBenefit: 'Closes the AC↔test-case traceability gap and raises Coverage + Parity.',
      confidence: 'high',
      rootCause: 'Testable acceptance criteria have no citing test case.',
      actions: [`Create test cases covering: ${ids.join(', ')}.`],
      eliminatesFindings: ids.length,
      layer: 'deterministic',
      sources: ids.map((id) => ({ kind: 'ac' as const, ref: id })),
      derivedFrom: ['parity.missingAcCoverage'],
    });
  }

  // ── Layer 1+2 — Automation coverage (establish vs extend) ──
  const cases = input.testCases?.cases ?? [];
  const missingAuto = input.parity.missingAutomationCoverage;
  if (missingAuto.length) {
    const all = cases.length > 0 && missingAuto.length === cases.length;
    upsert('automation', {
      title: all ? 'Establish automation coverage for this story' : `Extend automation to ${missingAuto.length} remaining case(s)`,
      category: 'Automation',
      severity: all ? 'major' : 'minor',
      impact: all ? 'high' : 'medium',
      effort: all ? 'high' : 'medium',
      expectedBenefit: 'Reduces manual regression effort and stabilizes future runs.',
      confidence: 'high',
      rootCause: all ? 'No test case is automated yet.' : 'Some test cases are not automated.',
      actions: [all ? 'Add automated specs reusing the shared page objects/helpers.' : `Automate: ${missingAuto.slice(0, 8).join(', ')}${missingAuto.length > 8 ? ', …' : ''}.`],
      eliminatesFindings: missingAuto.length,
      layer: all ? 'rule' : 'deterministic',
      sources: [],
      derivedFrom: ['parity.missingAutomationCoverage'],
    });
  }

  // ── Layer 1 — Missing visual coverage (combos with frames but no comparison) ──
  if (input.parity.missingVisualCoverage.length) {
    const combos = input.parity.missingVisualCoverage;
    upsert('visual:coverage', {
      title: `Run visual comparison for ${combos.length} uncovered combo(s)`,
      category: 'Visual',
      severity: 'minor',
      impact: 'medium',
      effort: 'low',
      expectedBenefit: 'Completes Figma↔implementation validation across all required platform·locale combos.',
      confidence: 'high',
      rootCause: 'Figma frames exist but some combos were not visually compared.',
      actions: [`Capture screenshots and compare for: ${combos.join(', ')}.`],
      eliminatesFindings: combos.length,
      layer: 'deterministic',
      sources: [],
      derivedFrom: ['parity.missingVisualCoverage'],
    });
  }

  // ── Layer 1 — Missing workflow stages (Process) ──
  if (input.parity.missingWorkflowStages.length) {
    const stages = input.parity.missingWorkflowStages;
    upsert('process:stages', {
      title: `Complete ${stages.length} incomplete workflow stage(s)`,
      category: 'Process',
      severity: 'minor',
      impact: 'medium',
      effort: 'low',
      expectedBenefit: 'Restores full lifecycle coverage and Platform Parity.',
      confidence: 'high',
      rootCause: 'Enabled workflow stages produced no output.',
      actions: [`Re-run or complete: ${stages.join(', ')}.`],
      eliminatesFindings: stages.length,
      layer: 'deterministic',
      sources: [],
      derivedFrom: ['parity.missingWorkflowStages'],
    });
  }

  // ── Layer 1+2 — Defects (severity-driven; group by shared component when present) ──
  const defects = input.defects ?? [];
  const bySharedComponent = new Map<string, number>();
  for (const d of defects) if (d.component) bySharedComponent.set(d.component, (bySharedComponent.get(d.component) ?? 0) + 1);
  for (const [component, count] of bySharedComponent) {
    if (count < 2) continue; // Layer 2: a shared root cause across defects
    upsert(`defects:component:${slug(component)}`, {
      title: `Investigate the shared root cause behind ${count} defects in ${component}`,
      category: 'Regression',
      severity: 'major',
      impact: 'high',
      effort: 'medium',
      expectedBenefit: `Fixing ${component} resolves ${count} related defect(s).`,
      confidence: 'high',
      rootCause: `${count} defects share the ${component} component.`,
      actions: [`Debug the ${component} component; one fix likely clears all ${count}.`],
      eliminatesFindings: count,
      layer: 'rule',
      sources: [{ kind: 'rule', ref: component, label: component }],
      derivedFrom: ['execution.defects'],
    });
  }
  const highDefects = defects.filter((d) => d.severity === 'Critical' || d.severity === 'High');
  if (highDefects.length) {
    upsert('defects:high', {
      title: `Prioritize ${highDefects.length} high-severity defect(s) before release`,
      category: 'Regression',
      severity: highDefects.some((d) => d.severity === 'Critical') ? 'critical' : 'major',
      impact: 'high',
      effort: 'medium',
      expectedBenefit: 'Removes release-blocking or high-risk defects.',
      confidence: 'high',
      rootCause: 'High-severity defects were found during execution.',
      actions: ['Triage and fix the Critical/High defects; re-run the affected combos.'],
      eliminatesFindings: highDefects.length,
      layer: 'deterministic',
      sources: [],
      derivedFrom: ['execution.defects'],
    });
  }

  // ── Layer 1 — Review Confidence reductions (fill gaps not already covered) ──
  const SIGNAL_MAP: Record<string, { key: string; category: RecommendationCategory; title: string; action: string }> = {
    evidence_collected: { key: 'evidence', category: 'Process', title: 'Collect execution evidence', action: 'Capture screenshots/logs for each executed case.' },
    browserstack_imported: { key: 'process:bs-import', category: 'Process', title: 'Verify the BrowserStack import', action: 'Confirm the test-case import succeeded and the folder count matches.' },
    comments_analyzed: { key: 'process:comments', category: 'Process', title: 'Analyze story comments', action: 'Review Jira comments for AC overrides/clarifications.' },
    traceability: { key: 'traceability', category: 'Maintainability', title: 'Add citations to generated artifacts', action: 'Attach AC/Figma/rule citations so every artifact is traceable.' },
    defects_reviewed: { key: 'process:defects-review', category: 'Process', title: 'Review defects before filing', action: 'Confirm defects are triaged at the file-bugs gate.' },
    figma_analyzed: { key: 'visual:figma', category: 'Visual', title: 'Analyze the Figma design', action: 'Export and analyze the design frames for this story.' },
  };
  for (const s of input.review.signals) {
    if (!s.applicable || s.satisfied) continue;
    const m = SIGNAL_MAP[s.key];
    if (!m) continue;
    upsert(m.key, {
      title: m.title,
      category: m.category,
      severity: 'minor',
      impact: 'medium',
      effort: 'low',
      expectedBenefit: 'Raises Review Confidence and audit readiness.',
      confidence: 'medium',
      rootCause: s.reduction ?? m.title,
      actions: [m.action],
      eliminatesFindings: 1,
      layer: 'deterministic',
      sources: [],
      derivedFrom: [`review.${s.key}`],
    });
  }

  // ── Corroboration — Story Health reductions strengthen matching themes ──
  for (const d of input.health.dimensions) {
    if (!d.applicable || d.level === 'high') continue;
    const themeByDim: Record<string, string> = {
      coverage: 'coverage:ac', execution: 'defects:high', visual: 'visual:one-off',
      defects: 'defects:high', traceability: 'traceability',
    };
    const k = themeByDim[d.key];
    const existing = k && map.get(k);
    if (existing) existing.derivedFrom = [...new Set([...existing.derivedFrom, `health.${d.key}`])];
  }

  // ── Finalize — deterministic priority + stable ordering ──
  const recs = [...map.values()];
  for (const r of recs) {
    r.priorityScore = Math.round(
      (SEV_W[r.severity] * MAG_W[r.impact] * (1 + Math.min(r.eliminatesFindings, 20))) / MAG_W[r.effort] * 10,
    );
  }
  recs.sort(
    (a, b) =>
      b.priorityScore - a.priorityScore ||
      SEV_W[b.severity] - SEV_W[a.severity] ||
      b.eliminatesFindings - a.eliminatesFindings ||
      a.id.localeCompare(b.id),
  );
  return recs;
}
