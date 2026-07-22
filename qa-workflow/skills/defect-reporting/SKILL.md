---
name: defect-reporting
type: task
version: 1.0
description: Defect Reporting — scaffold stub; authored in the implementation phase.
phase: Defect Reporting
workflow: [qa-implementation-validation]
runsAs: inline
consumes:
  sources: []
  artifacts: [execution, visual-findings]
  domains: []
produces:
  artifacts: [defects]
methodology: docs/ai/bug-reporting.md
---

# defect-reporting (task skill — scaffold)

> **Scaffold stub.** Thin wrapper; the **how** lives in `docs/ai/bug-reporting.md` (source of truth).
> Contract fields above are provisional and validated in the implementation phase.

## Purpose
See `docs/ai/bug-reporting.md`. Produces: `defects`.

## Inputs / Outputs
- Consumes (by path): artifacts [execution, visual-findings]; sources []; domains [].
- Produces: `defects` under `<TICKET>/`; returns `{ artifactPath, status, summary }` to the workflow.

## qa-state
Update `<TICKET>/qa-state.json` per `docs/ai/architecture/qa-artifact-contract.md` and validate
against `docs/ai/architecture/qa-state.schema.json`.
