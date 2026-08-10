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
  // exploratory-notes is CONDITIONAL (run only when exploration would improve coverage), so it is
  // optional: reconcile includes it only when a record already exists. Were it unconditionally in
  // BASELINE, every story that legitimately needed no exploration would report it permanently stale.
  'exploratory-notes':   { sources: [],        upstream: ['requirements', 'figma-analysis', 'impact'], optional: true },
  hls:                   { sources: [],        upstream: ['requirements', 'figma-analysis', 'impact', 'clarifications'] },
  // testcases moved into the WF1 baseline (2026-08-09): coverage is DEFINED before development and
  // reconciled — not regenerated — after it. exploratory-notes/clarifications are context: they inform
  // case design but must not cascade-invalidate an approved, imported suite.
  testcases:             { sources: [],        upstream: ['hls', 'requirements', 'impact'], context: ['clarifications', 'exploratory-notes'] },
  // The mandatory review gate. `complete` == reviewed AND operator-approved; nothing reaches
  // BrowserStack ahead of it (qa-cli PHASE_DEPS + APPROVAL_DEPS enforce both halves).
  'testcase-review':     { sources: [],        upstream: ['testcases'] },
  'browserstack-import': { sources: [],        upstream: ['testcase-review'] },
  // ── Workflow 2 outputs (optional to track) ──────────────────────────
  // The WF2 delta log over the approved baseline (added/updated/removed/split/merged + justification).
  // Optional: it exists only when validation actually changed the suite.
  'testcase-reconciliation': { sources: [],    upstream: ['testcases'], context: ['execution', 'exploratory-notes'], optional: true },
  automation:            { sources: [],        upstream: ['testcases'] },
  'visual-findings':     { sources: [],        upstream: ['figma-analysis'] },
  execution:             { sources: [],        upstream: [] },
  defects:               { sources: [],        upstream: ['execution', 'visual-findings'] },
  'qa-summary':          { sources: [],        upstream: ['execution', 'visual-findings', 'defects'] },
};

/**
 * The Workflow-1 reusable baseline keys, in no particular order.
 * Grown 5 → 8 on 2026-08-09: test-case creation, its review gate and the BrowserStack import are
 * shift-left outputs, so Workflow 2 RECONCILES them (contract §5) instead of regenerating a suite.
 */
const BASELINE = [
  'requirements', 'figma-analysis', 'clarifications', 'impact', 'hls',
  'testcases', 'testcase-review', 'browserstack-import',
];

/** Baseline members that are conditional — reconciled only once a record for them exists. */
const BASELINE_OPTIONAL = Object.keys(DAG).filter((k) => DAG[k].optional);

/**
 * The set reconcile() should default to for a story: the required baseline plus any optional
 * artifact this story actually produced.
 * @param {object} artifacts  qaState.artifacts (may be undefined)
 */
function baselineFor(artifacts) {
  // DAG declaration order, so the printed regeneration plan reads in the order a workflow runs it.
  return Object.keys(DAG).filter((k) =>
    BASELINE.includes(k) || (DAG[k].optional && artifacts && artifacts[k]));
}

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

module.exports = { DAG, BASELINE, BASELINE_OPTIONAL, baselineFor, topoOrder, dependentsOf };
