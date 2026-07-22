---
name: qa-implementation-validation
type: workflow
version: 1.0
description: Post-Development QA — reconcile & reuse Pre-Dev artifacts, then validate the delivered implementation.
purpose: Reuse the shift-left baseline (regenerating only what changed), then run execution, visual, defects, and QA summary.
---

# Workflow 2 — Post-Development (Implementation Validation)

> **Scaffold stub.** Full sequencing authored in the implementation phase.
> Methodology: [`../../docs/ai/QA_PROCESS.md`](../../docs/ai/QA_PROCESS.md) Phases 4–6.
> Reuse contract + freshness algorithm: [`../../docs/ai/architecture/qa-artifact-contract.md`](../../docs/ai/architecture/qa-artifact-contract.md) §5.

## Sequence
0. **Reconcile** — run the freshness engine (`lib/freshness`) over `<TICKET>/qa-state.json`:
   reuse valid baseline artifacts; regenerate only the stale set (+ downstream cascade);
   honor human edits (never overwrite) and surface conflicts. *(Contract §5.)*
1. `exploratory-testing` (inline)
2. `test-design` (test-case phase) → `testcases`
3. `browserstack-mgmt` (inline) → `browserstack-import`
4. `automation-gen` → `automation`
5. Execution (4 combos) → `execution`
6. `visual-testing` → `visual-findings` (+ annotated Design-Bug evidence)
7. `defect-reporting` (inline) → `defects` (functional + design)
8. QA Summary → `qa-summary`

## Inputs
The Workflow-1 baseline in `<TICKET>/` (reused via Reconcile) + live sources (Jira, Figma) for freshness checks.
