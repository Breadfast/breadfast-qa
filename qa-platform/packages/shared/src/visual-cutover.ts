/**
 * Cutover-readiness evaluator (BACKLOG-002 VT6-S1, CP-5).
 *
 * Deterministic GO / NO-GO over the shadow-mode divergence metrics collected in
 * VT5 (`computeVisualDivergence`, persisted per shadow run). The pyramid may
 * become the default engine ONLY on a GO. Pure — same evidence ⇒ same verdict —
 * so the cutover decision is reproducible and auditable, never a judgment call.
 * Browser-safe.
 */
import type { VisualDivergence } from './visual-ai-gate.js';

export interface CutoverThresholds {
  minScreensCompared: number; // enough evidence to decide
  minVerdictAgreement: number; // 0..1 — pyramid must agree with legacy on this fraction of screens
  maxFindingRegression: number; // 0..1 — pyramid may find at most this fraction FEWER findings than legacy
}

export const DEFAULT_CUTOVER_THRESHOLDS: CutoverThresholds = {
  minScreensCompared: 20,
  minVerdictAgreement: 0.9,
  maxFindingRegression: 0.1,
};

export interface CutoverDecision {
  verdict: 'go' | 'no-go';
  reasons: string[];
  metrics: {
    shadowRuns: number;
    screensCompared: number;
    verdictAgreementRate: number; // 0..1
    findingRatio: number; // pyramidFindings ÷ legacyFindings (1 when legacy found none)
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Aggregate the divergences from one or more shadow runs and decide. NO-GO on
 * insufficient evidence, low verdict agreement, or finding under-detection —
 * each with an explicit reason. This is the ONLY sanctioned basis for flipping
 * the default engine (VT6-S2) or removing the legacy path (VT6-S3).
 */
export function evaluateCutover(divergences: VisualDivergence[], thresholds: CutoverThresholds = DEFAULT_CUTOVER_THRESHOLDS): CutoverDecision {
  const screensCompared = divergences.reduce((n, d) => n + d.screensCompared, 0);
  const agreements = divergences.reduce((n, d) => n + d.verdictAgreements, 0);
  const legacyFindings = divergences.reduce((n, d) => n + d.legacyFindings, 0);
  const pyramidFindings = divergences.reduce((n, d) => n + d.pyramidFindings, 0);
  const verdictAgreementRate = screensCompared ? agreements / screensCompared : 0;
  const findingRatio = legacyFindings === 0 ? 1 : pyramidFindings / legacyFindings; // can't regress below zero

  const reasons: string[] = [];
  if (screensCompared < thresholds.minScreensCompared) {
    reasons.push(`Insufficient evidence: ${screensCompared}/${thresholds.minScreensCompared} screens compared across ${divergences.length} shadow run(s).`);
  }
  if (verdictAgreementRate < thresholds.minVerdictAgreement) {
    reasons.push(`Verdict agreement ${Math.round(verdictAgreementRate * 100)}% < required ${Math.round(thresholds.minVerdictAgreement * 100)}%.`);
  }
  if (findingRatio < 1 - thresholds.maxFindingRegression) {
    reasons.push(`Pyramid produced ${Math.round(findingRatio * 100)}% of legacy findings (floor ${Math.round((1 - thresholds.maxFindingRegression) * 100)}%) — under-detection risk.`);
  }

  const verdict: CutoverDecision['verdict'] = reasons.length ? 'no-go' : 'go';
  if (!reasons.length) reasons.push('All cutover thresholds met — pyramid is at or above legacy parity.');
  return {
    verdict,
    reasons,
    metrics: { shadowRuns: divergences.length, screensCompared, verdictAgreementRate: round2(verdictAgreementRate), findingRatio: round2(findingRatio) },
  };
}
