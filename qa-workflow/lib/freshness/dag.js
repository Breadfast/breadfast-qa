'use strict';

/**
 * Artifact dependency graph for QA reuse/freshness.
 * See docs/ai/architecture/qa-artifact-contract.md §2.
 *
 * Each artifact declares:
 *   sources[]         live sources it derives from directly ('jira' | 'figma')
 *   upstream[]        upstream artifact keys it depends on (cascade edges)
 *   context[]         upstream artifacts that INFORM it but do NOT cascade-invalidate it
 *                     (documentation only — reconcile ignores these for staleness)
 *   materialityGate   true → a source change marks it *candidate*-stale, deferred to a
 *                     materiality decision (see reconcile). Used for `clarifications` so an
 *                     immaterial AC/comment edit doesn't needlessly re-open the interactive gate.
 */
const DAG = {
  // ── Workflow 1 baseline ─────────────────────────────────────────────
  requirements:          { sources: ['jira'],  upstream: [] },
  'figma-analysis':      { sources: ['figma'], upstream: [] },
  // clarifications: triggered ONLY by a material jira (AC/comments) change — requirements &
  // figma-analysis are context, not cascade edges, so the materiality gate is not defeated.
  clarifications:        { sources: ['jira'],  upstream: [], context: ['requirements', 'figma-analysis'], materialityGate: true },
  impact:                { sources: [],        upstream: ['requirements', 'figma-analysis'] },
  hls:                   { sources: [],        upstream: ['requirements', 'figma-analysis', 'impact', 'clarifications'] },
  // ── Workflow 2 outputs (optional to track) ──────────────────────────
  testcases:             { sources: [],        upstream: ['hls', 'requirements'] },
  'browserstack-import': { sources: [],        upstream: ['testcases'] },
  automation:            { sources: [],        upstream: ['testcases'] },
  'visual-findings':     { sources: [],        upstream: ['figma-analysis'] },
  execution:             { sources: [],        upstream: [] },
  defects:               { sources: [],        upstream: ['execution', 'visual-findings'] },
  'qa-summary':          { sources: [],        upstream: ['execution', 'visual-findings', 'defects'] },
};

/** The Workflow-1 reusable baseline keys, in no particular order. */
const BASELINE = ['requirements', 'figma-analysis', 'clarifications', 'impact', 'hls'];

/** Return the topological order (upstream before dependents) for the given keys. */
function topoOrder(keys) {
  const set = new Set(keys);
  const visited = new Set();
  const out = [];
  const visit = (k) => {
    if (visited.has(k) || !set.has(k)) return;
    visited.add(k);
    for (const up of (DAG[k] ? DAG[k].upstream : [])) visit(up);
    out.push(k);
  };
  for (const k of keys) visit(k);
  return out;
}

/** Keys that depend (transitively) on `key`, among `universe` (defaults to all DAG keys). */
function dependentsOf(key, universe) {
  const keys = universe || Object.keys(DAG);
  const result = new Set();
  let changed = true;
  const direct = (k) => keys.filter((c) => DAG[c] && DAG[c].upstream.includes(k));
  let frontier = direct(key);
  while (frontier.length) {
    const next = [];
    for (const c of frontier) {
      if (!result.has(c)) { result.add(c); next.push(...direct(c)); }
    }
    frontier = next;
  }
  return [...result];
}

module.exports = { DAG, BASELINE, topoOrder, dependentsOf };
