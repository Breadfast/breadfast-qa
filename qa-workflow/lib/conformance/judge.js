'use strict';

/**
 * Generic Judge machinery (ADR-003 §3.4 · Decision 1). A `judge` is the AI transport
 * `evaluateStory` injects to process the residual worklist. This module composes a
 * judge from three **transport-agnostic** parts, so the Conformance Engine never
 * depends on Claude, Anthropic, or any specific provider:
 *
 *   render(item)          → request     build the prompt + artifact refs from a residual item
 *   transport(request)    → rawText     call the AI — the ONLY provider-specific part (INJECTED)
 *   parse(rawText, item)  → Finding[]   turn the response into partial findings
 *
 * The deterministic engine (resolver · pipeline · run) imports nothing from here;
 * this is opt-in orchestration. Concrete adapters (e.g. ClaudeJudge) live in a
 * capability and supply `transport`. `evaluateStory(cap, input, { judge })` accepts
 * any function of this shape — provider-neutral by construction.
 *
 * @typedef {(item:{capability:string,screen:string,reason:string,expected:any,actual:any,deterministicFindings?:object[]})=>Promise<object[]>} Judge
 */

/** Compose a Judge from render/transport/parse. `transport` is required (the AI call). */
function composeJudge({ render, transport, parse } = {}) {
  if (typeof transport !== 'function') throw new Error('composeJudge: a `transport` function is required');
  const doRender = typeof render === 'function' ? render : (item) => ({ item });
  const doParse = typeof parse === 'function' ? parse : () => [];
  return async function judge(item) {
    const request = await doRender(item);
    const raw = await transport(request, item);
    return doParse(raw, item) || [];
  };
}

/** A judge that never contributes findings (safe default / "no transport configured"). */
const noopJudge = async () => [];

module.exports = { composeJudge, noopJudge };
