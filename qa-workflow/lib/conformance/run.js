'use strict';

/**
 * run — story-level Conformance driver (ADR-003 §3.4). Ties the pieces together:
 *   resolve (L1 identity) → runPipeline per pair (deterministic-first) → aggregate,
 * and emits a non-penalizing **coverage-gap** notice for every expected item that
 * could not be confidently paired (never a forced pair, never a false defect).
 *
 * Capability-neutral: an "item" is a screen (visual), an endpoint (api), a ruleset
 * (a11y)… `identityOf`/`scoreOf` are how the caller expresses identity for its domain.
 * Pure given pure stages/providers.
 */

const { resolvePair } = require('./resolver');
const { runPipeline } = require('./pipeline');
const { normalizeFinding, computeHealth } = require('./finding');

/** Screen/item verdict from its real (non-coverage-gap) findings. */
function verdictOf(findings) {
  const real = (findings || []).filter((f) => !f.coverageGap);
  if (real.some((f) => f.severity === 'critical' || f.severity === 'major')) return 'major';
  if (real.some((f) => f.severity === 'minor' || f.severity === 'info')) return 'minor';
  return 'pass';
}

/** Default identity: `.screenId` (visual). */
function defaultIdentityOf(item) {
  return item && item.screenId;
}

/**
 * Does a PAIRED screen still need the AI residual? True when the surface is
 * unstructured (no deterministic layer can read it) or there is no expected model
 * to compare against (deterministic layers would be dormant → a silent pass). This
 * is the deterministic worklist the operator/skill hands to the LLM (ADR-003 §3.4).
 */
function residualReason(expected, actual, ctx) {
  if ((ctx && ctx.unstructured) || (actual && actual.unstructured)) return 'unstructured-surface';
  const hasModel = expected && (((expected.components || []).length) || ((expected.texts || []).length));
  if (!hasModel) return 'no-expected-model';
  return null;
}

/**
 * Default heuristic: 0 if platform/locale conflict; else Jaccard of id/name tokens.
 * Keeps unrelated screens from ever being force-paired.
 */
function defaultScoreOf(e, a) {
  if (!e || !a) return 0;
  if (e.platform && a.platform && e.platform !== a.platform) return 0;
  if (e.locale && a.locale && e.locale !== a.locale) return 0;
  const toks = (x) => new Set(String(x || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const es = toks(e.screenId || e.name);
  const as = toks(a.screenId || a.name);
  if (!es.size || !as.size) return 0;
  let inter = 0;
  for (const t of es) if (as.has(t)) inter++;
  return inter / new Set([...es, ...as]).size;
}

/**
 * @param {import('./capability').ConformanceCapability} capability
 * @param {{ expected:any[], actual:any[], identityOf?:Function, scoreOf?:Function, floor?:number, ctx?:object }} input
 * @param {{ aiSkip?:Function, aiRun?:Function }} [opts]
 * @returns {{ screens:object[], findings:object[], coverageGaps:number, aiInvoked:boolean, health:object }}
 */
function runScreens(capability, input, opts = {}) {
  const identityOf = typeof input.identityOf === 'function' ? input.identityOf : defaultIdentityOf;
  const scoreOf = typeof input.scoreOf === 'function' ? input.scoreOf : defaultScoreOf;
  const { pairs, coverageGaps } = resolvePair(input.expected || [], input.actual || [], { identityOf, scoreOf, floor: input.floor });

  const findings = [];
  const screens = [];
  const residual = []; // paired screens the deterministic pass could not fully evaluate → hand to the LLM
  let aiInvoked = false;

  for (const p of pairs) {
    const screenId = identityOf(p.expected) || identityOf(p.actual) || '';
    const ctx = { ...(input.ctx || {}), screen: screenId, pairMethod: p.method };
    // Per-screen ValidationProfile (from the expected side) wins over the run default.
    if (p.expected && p.expected.tolerances) ctx.tolerances = p.expected.tolerances;
    if (p.expected && p.expected.enabledLayers) ctx.enabledLayers = p.expected.enabledLayers;
    const r = runPipeline(capability, { expected: p.expected, actual: p.actual, ctx }, opts);
    aiInvoked = aiInvoked || r.aiInvoked;
    findings.push(...r.findings);
    screens.push({ screen: screenId, method: p.method, verdict: verdictOf(r.findings), findingCount: r.findings.length });
    const reason = residualReason(p.expected, p.actual, ctx);
    if (reason) residual.push({ screen: screenId, reason });
  }

  for (const g of coverageGaps) {
    const screenId = identityOf(g.expected) || '';
    findings.push(normalizeFinding({
      capability: capability.id,
      category: 'components',
      dimension: 'coverage',
      severity: 'info',
      subject: screenId,
      location: screenId,
      coverageGap: true,
      source: 'deterministic',
      description: 'No actual could be confidently paired to this expected item (coverage gap, not a defect).',
    }));
    screens.push({ screen: screenId, method: 'none', verdict: 'coverage-gap', findingCount: 0 });
  }

  return { screens, findings, coverageGaps: coverageGaps.length, residual, aiInvoked, health: computeHealth(findings) };
}

module.exports = { runScreens, verdictOf, residualReason, defaultIdentityOf, defaultScoreOf };
