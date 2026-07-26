/**
 * AI-invocation gate + shadow divergence (BACKLOG-002 VT5, ADR-002 Rev.2 §5).
 *
 * Deterministic decision for WHEN the pyramid falls back to the AI comparator:
 * AI runs only on the RESIDUAL — screens the deterministic layers could not
 * fully evaluate (no structured actual data, or no expected data) — plus a
 * bounded audit sample of clean, fully-evaluated screens. A fully-structured,
 * fully-evaluated screen needs no AI: its deterministic findings (or clean pass)
 * are authoritative. Pure + browser-safe.
 */
import type { VisualComparison, VisualSeverity } from './schemas.js';

export interface AiGateInput {
  identityResolved: boolean; // a frame/screenshot pair was resolved (not a coverage gap)
  fullyStructured: boolean; // an actual StructuredDump was available (no unstructured residual)
  hasExpected: boolean; // expected data (registry components / figma) was available
  deterministicFindings: number; // findings the deterministic layers already produced
  auditSampled?: boolean; // this screen was selected for the bounded audit sample
}

export interface AiGateDecision {
  invoke: boolean;
  reason: string;
}

/**
 * Decide whether to invoke the AI comparator for one screen. Skip when the
 * screen was fully deterministically evaluated (structured + expected present):
 * clean ⇒ nothing to review; deterministic findings ⇒ already classified. Invoke
 * on any residual (missing structure/expected) or when audit-sampled.
 */
export function shouldInvokeAi(i: AiGateInput): AiGateDecision {
  if (!i.identityResolved) return { invoke: false, reason: 'coverage-gap (no pair; not an AI case)' };
  if (!i.fullyStructured) return { invoke: true, reason: 'residual: no structured actual data to evaluate deterministically' };
  if (!i.hasExpected) return { invoke: true, reason: 'residual: no expected data (registry/figma) to compare against' };
  if (i.auditSampled) return { invoke: true, reason: 'audit sample of a fully-evaluated screen' };
  return {
    invoke: false,
    reason: i.deterministicFindings > 0
      ? `deterministic layers found ${i.deterministicFindings} finding(s) — authoritative`
      : 'fully evaluated and clean — no AI needed',
  };
}

/**
 * Deterministic audit sampling: pick roughly `rate` (0..1) of clean screens by
 * index (no randomness → reproducible). rate ≤ 0 disables sampling.
 */
export function isAuditSampled(index: number, rate: number): boolean {
  if (!(rate > 0)) return false;
  const every = Math.max(1, Math.round(1 / rate));
  return index % every === 0;
}

// ── Shadow-mode divergence metrics (cutover decision support) ─────────────────
export interface VisualDivergence {
  legacyScreens: number;
  pyramidScreens: number;
  legacyFindings: number;
  pyramidFindings: number;
  legacyBySeverity: Record<VisualSeverity, number>;
  pyramidBySeverity: Record<VisualSeverity, number>;
  screensCompared: number; // screens present (by name) in BOTH engines
  verdictAgreements: number; // of screensCompared, how many share a verdict
  verdictAgreementRate: number; // 0..1
}

function tallySeverity(vc?: VisualComparison | null): Record<VisualSeverity, number> {
  const t: Record<VisualSeverity, number> = { critical: 0, major: 0, minor: 0, info: 0 };
  for (const s of vc?.screens ?? []) for (const f of s.findings ?? []) t[f.severity] = (t[f.severity] ?? 0) + 1;
  return t;
}

/**
 * Compare a legacy vs pyramid VisualComparison for the same run. Screens are
 * matched by `screen` name; verdict agreement is over the intersection. Pure —
 * same inputs ⇒ same metrics (safe to persist + aggregate across runs).
 */
export function computeVisualDivergence(legacy?: VisualComparison | null, pyramid?: VisualComparison | null): VisualDivergence {
  const lScreens = legacy?.screens ?? [];
  const pScreens = pyramid?.screens ?? [];
  const pByName = new Map(pScreens.map((s) => [s.screen, s]));
  let compared = 0;
  let agree = 0;
  for (const ls of lScreens) {
    const ps = pByName.get(ls.screen);
    if (!ps) continue;
    compared++;
    if (ls.verdict === ps.verdict) agree++;
  }
  const countFindings = (arr: typeof lScreens) => arr.reduce((n, s) => n + (s.findings?.length ?? 0), 0);
  return {
    legacyScreens: lScreens.length,
    pyramidScreens: pScreens.length,
    legacyFindings: countFindings(lScreens),
    pyramidFindings: countFindings(pScreens),
    legacyBySeverity: tallySeverity(legacy),
    pyramidBySeverity: tallySeverity(pyramid),
    screensCompared: compared,
    verdictAgreements: agree,
    verdictAgreementRate: compared ? Math.round((agree / compared) * 100) / 100 : 0,
  };
}
