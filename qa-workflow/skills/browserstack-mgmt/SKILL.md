---
name: browserstack-mgmt
type: task
version: 1.0
description: BrowserStack Management — scaffold stub; authored in the implementation phase.
phase: BrowserStack Management
workflow: [qa-implementation-validation]
runsAs: inline
consumes:
  sources: []
  artifacts: [testcases]
  domains: []
produces:
  artifacts: [browserstack-import]
methodology: docs/ai/browserstack-process.md
---

# browserstack-mgmt (task skill — scaffold)

> **Scaffold stub.** Thin wrapper; the **how** lives in `docs/ai/browserstack-process.md` (source of truth).
> Contract fields above are provisional and validated in the implementation phase.

## Purpose
See `docs/ai/browserstack-process.md`. Produces: `browserstack-import`.

## Inputs / Outputs
- Consumes (by path): artifacts [testcases]; sources []; domains [].
- Produces: `browserstack-import` under `<TICKET>/`; returns `{ artifactPath, status, summary }` to the workflow.

## qa-state
Update `<TICKET>/qa-state.json` per `docs/ai/architecture/qa-artifact-contract.md` and validate
against `docs/ai/architecture/qa-state.schema.json`.
