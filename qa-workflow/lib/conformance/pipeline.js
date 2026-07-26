'use strict';

/**
 * pipeline — the Conformance runner (ADR-003 §3.4). **Deterministic-first:** run the
 * deterministic stages in declared order (collect-all), then invoke the AI residual
 * ONLY when the AI-skip predicate fails. A clean, fully-structured surface ⇒ **0 AI**.
 *
 * Stages declared without a `run` are recorded in `pending` (unwired) and skipped —
 * never a crash — so a capability is wired one layer at a time (visual today declares
 * L1–L8 but wires them incrementally). Pure given pure stages.
 */

const { normalizeFinding, computeHealth } = require('./finding');
const { deterministicStages, residualStages } = require('./capability');

/** Default AI-skip: skip residual iff nothing was flagged `needsResidual` and the surface is structured. */
function defaultAiSkip(deterministicFindings, ctx) {
  const needsResidual = (deterministicFindings || []).some((f) => f.needsResidual);
  const unstructured = !!(ctx && ctx.unstructured);
  return !needsResidual && !unstructured;
}

function tag(f, capabilityId, layer, source) {
  return normalizeFinding({ ...f, capability: f.capability || capabilityId, layer: f.layer || layer, source: f.source || source });
}

/**
 * Run one resolved (expected, actual) pair through a capability's pipeline.
 * @param {import('./capability').ConformanceCapability} capability
 * @param {{ expected:any, actual:any, ctx?:object }} input
 * @param {{ aiSkip?:Function, aiRun?:Function }} [opts]  aiRun = fallback residual runner (the LLM), injected
 * @returns {{ findings:object[], aiInvoked:boolean, skipped:boolean, stagesRun:string[], pending:string[], health:object }}
 */
function runPipeline(capability, input, opts = {}) {
  const ctx = (input && input.ctx) || {};
  const expected = input && input.expected;
  const actual = input && input.actual;
  const findings = [];
  const stagesRun = [];
  const pending = [];

  // Optional per-run layer gating from the ValidationProfile (ctx.enabledLayers).
  // A disabled layer is deliberately skipped — neither run nor "pending".
  const enabled = Array.isArray(ctx.enabledLayers) && ctx.enabledLayers.length ? new Set(ctx.enabledLayers) : null;

  // Deterministic stages, cheapest/most-structural first — always run to completion.
  for (const stage of deterministicStages(capability)) {
    if (enabled && !enabled.has(stage.layer)) continue; // profile-disabled
    if (typeof stage.run !== 'function') { pending.push(stage.id); continue; }
    stagesRun.push(stage.id);
    const out = stage.run(expected, actual, ctx) || [];
    for (const f of out) findings.push(tag(f, capability.id, stage.layer, 'deterministic'));
  }

  // AI residual — only on the residual, only when the skip predicate says so.
  const skip = (typeof opts.aiSkip === 'function' ? opts.aiSkip : defaultAiSkip)(findings, ctx);
  let aiInvoked = false;
  if (!skip) {
    const residualCtx = { ...ctx, residualCandidates: findings.filter((f) => f.needsResidual) };
    for (const stage of residualStages(capability)) {
      const runner = typeof stage.run === 'function' ? stage.run : opts.aiRun;
      if (typeof runner !== 'function') { pending.push(stage.id); continue; }
      aiInvoked = true;
      stagesRun.push(stage.id);
      const out = runner(expected, actual, residualCtx) || [];
      for (const f of out) findings.push(tag(f, capability.id, stage.layer, 'ai'));
    }
  }

  return { findings, aiInvoked, skipped: skip, stagesRun, pending, health: computeHealth(findings) };
}

module.exports = { defaultAiSkip, runPipeline };
