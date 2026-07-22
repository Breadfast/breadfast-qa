---
name: exploratory-testing
type: task
version: 1.0
description: Exploratory Testing — scaffold stub; authored in the implementation phase.
phase: Exploratory Testing
workflow: [qa-implementation-validation]
runsAs: inline
consumes:
  sources: []
  artifacts: [requirements]
  domains: []
produces:
  artifacts: [exploratory-notes]
methodology: docs/ai/exploratory-testing.md
---

# exploratory-testing (task skill — scaffold)

> **Scaffold stub.** Thin wrapper; the **how** lives in `docs/ai/exploratory-testing.md` (source of truth).
> Contract fields above are provisional and validated in the implementation phase.

## Purpose
See `docs/ai/exploratory-testing.md`. Produces: `exploratory-notes`.

## Inputs / Outputs
- Consumes (by path): artifacts [requirements]; sources []; domains [].
- Produces: `exploratory-notes` under `<TICKET>/`; returns `{ artifactPath, status, summary }` to the workflow.

## qa-state
Update `<TICKET>/qa-state.json` per `docs/ai/architecture/qa-artifact-contract.md` and validate
against `docs/ai/architecture/qa-state.schema.json`.
