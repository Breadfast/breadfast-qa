'use strict';

/**
 * L8 residual orchestration (ADR-003 §3.4, Phase 3). Processes ONLY the residual
 * worklist from `runScreens`, using an **injected `judge`** (the AI transport).
 *
 * Transport independence is the whole point: the deterministic engine
 * (resolver · pipeline · run) imports NOTHING from here and has no knowledge of any
 * LLM. This module accepts the judge as a parameter, so the Conformance Engine stays
 * deterministic, reusable, and plugin-aligned. The real judge (Claude vision over
 * the paired frame + screenshot) is supplied by the operator/skill once the
 * vision-transport decision (ADR-003 §4) is ratified — here it is an interface.
 *
 * judge signature: async ({ capability, screen, reason, expected, actual }) => partial Finding[]
 * The runner stamps capability / source:'ai' / layer:'ai-residual'.
 */

const { runScreens } = require('./run');
const { normalizeFinding, computeHealth } = require('./finding');

/** Run the injected judge over each residual item. No judge ⇒ no AI, nothing processed. */
async function runResidual(residual, opts = {}) {
  const judge = typeof opts.judge === 'function' ? opts.judge : null;
  const capabilityId = opts.capability || '';
  const expectedByScreen = opts.expectedByScreen || {};
  const actualByScreen = opts.actualByScreen || {};
  const findings = [];
  const processed = [];
  const findingsByScreen = opts.findingsByScreen || {};
  const list = residual || [];
  if (!judge || !list.length) return { findings, processed, aiInvoked: false };
  for (const item of list) {
    const out = (await judge({
      capability: capabilityId,
      screen: item.screen,
      reason: item.reason,
      expected: expectedByScreen[item.screen],
      actual: actualByScreen[item.screen],
      deterministicFindings: findingsByScreen[item.screen] || [], // context: don't re-detect these
    })) || [];
    for (const f of out) {
      findings.push(normalizeFinding({ ...f, capability: f.capability || capabilityId, layer: f.layer || 'ai-residual', source: f.source || 'ai' }));
    }
    processed.push(item.screen);
  }
  return { findings, processed, aiInvoked: true };
}

function indexByScreen(items, identityOf) {
  const id = typeof identityOf === 'function' ? identityOf : (s) => s && s.screenId;
  const out = {};
  for (const it of items || []) { const k = id(it); if (k) out[k] = it; }
  return out;
}

/**
 * Full story evaluation: deterministic-first (PURE `runScreens`), then AI ONLY on the
 * residual via the injected judge. With no judge it equals `runScreens` (0 AI) — the
 * deterministic engine is complete on its own.
 */
async function evaluateStory(capability, input, opts = {}) {
  const det = runScreens(capability, input, opts); // pure, no AI
  const findingsByScreen = {};
  for (const f of det.findings) {
    if (f.coverageGap) continue;
    (findingsByScreen[f.location] = findingsByScreen[f.location] || []).push(f);
  }
  const res = await runResidual(det.residual, {
    judge: opts.judge,
    capability: capability.id,
    expectedByScreen: indexByScreen(input.expected, input.identityOf),
    actualByScreen: indexByScreen(input.actual, input.identityOf),
    findingsByScreen,
  });
  const findings = [...det.findings, ...res.findings];
  return { ...det, findings, aiInvoked: det.aiInvoked || res.aiInvoked, residualProcessed: res.processed, health: computeHealth(findings) };
}

module.exports = { runResidual, evaluateStory };
