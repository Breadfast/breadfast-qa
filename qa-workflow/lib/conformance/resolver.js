'use strict';

/**
 * resolver — generic identity-first pairing (Conformance L1 · ADR-003).
 * Generalizes qa-platform `visual-resolver`: registry/identity match (confidence 1)
 * → heuristic score gated by a confidence floor → **ABSTAIN** (coverage gap; never
 * force-pair). Capability-neutral: visual pairs frame↔shot, a11y pairs rule↔element,
 * api pairs endpoint↔response — same algorithm, different `identityOf`/`scoreOf`.
 * Pure, zero-dependency.
 */

const DEFAULT_FLOOR = 0.3; // mirrors visual-resolver DEFAULT_MATCH_FLOOR

/**
 * Pair expected items to actual items by stable identity, else heuristic, else abstain.
 * @param {any[]} expected
 * @param {any[]} actual
 * @param {object} opts
 * @param {(item:any)=>(string|undefined)} [opts.identityOf] stable id (undefined/'' ⇒ none)
 * @param {(e:any,a:any)=>number} [opts.scoreOf]             heuristic similarity 0..1
 * @param {number} [opts.floor]                              strict-min heuristic to pair (default 0.3)
 * @returns {{ pairs:Array<{expected,actual,method:('identity'|'heuristic'),confidence:number}>, coverageGaps:Array<{expected:any}> }}
 */
function resolvePair(expected, actual, opts = {}) {
  const identityOf = typeof opts.identityOf === 'function' ? opts.identityOf : () => undefined;
  const scoreOf = typeof opts.scoreOf === 'function' ? opts.scoreOf : () => 0;
  const floor = typeof opts.floor === 'number' ? opts.floor : DEFAULT_FLOOR;
  const exp = expected || [];
  const act = actual || [];
  const usedActual = new Set();
  const pairs = [];
  const coverageGaps = [];
  const pendingHeuristic = [];

  // Pass 1 — identity matches (confidence 1). Each actual used at most once.
  for (const e of exp) {
    const eid = identityOf(e);
    if (eid == null || eid === '') { pendingHeuristic.push(e); continue; }
    const idx = act.findIndex((a, i) => !usedActual.has(i) && identityOf(a) === eid);
    if (idx >= 0) { usedActual.add(idx); pairs.push({ expected: e, actual: act[idx], method: 'identity', confidence: 1 }); }
    else pendingHeuristic.push(e);
  }

  // Pass 2 — heuristic (strict '>' floor; first-wins tie-break), else ABSTAIN.
  for (const e of pendingHeuristic) {
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < act.length; i++) {
      if (usedActual.has(i)) continue;
      const s = scoreOf(e, act[i]);
      if (s > bestScore) { bestScore = s; best = i; }
    }
    if (best >= 0 && bestScore > floor) {
      usedActual.add(best);
      pairs.push({ expected: e, actual: act[best], method: 'heuristic', confidence: bestScore });
    } else {
      coverageGaps.push({ expected: e }); // never force-pair below the floor
    }
  }

  return { pairs, coverageGaps };
}

module.exports = { DEFAULT_FLOOR, resolvePair };
