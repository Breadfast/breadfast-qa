---
name: automation-gen
type: task
version: 1.0
description: Automation Generation — scaffold stub; authored in the implementation phase.
phase: Automation Generation
workflow: [qa-implementation-validation]
runsAs: subagent
consumes:
  sources: []
  artifacts: [testcases]
  domains: []
produces:
  artifacts: [automation]
methodology: docs/ai/automation/playwright-framework.md
---

# automation-gen (task skill — scaffold)

> **Scaffold stub.** Thin wrapper; the **how** lives in `docs/ai/automation/playwright-framework.md` (source of truth).
> Contract fields above are provisional and validated in the implementation phase.

## Purpose
See `docs/ai/automation/playwright-framework.md`. Produces: `automation`.

## Inputs / Outputs
- Consumes (by path): artifacts [testcases]; sources []; domains [].
- Produces: `automation` under `<TICKET>/`; returns `{ artifactPath, status, summary }` to the workflow.

## qa-state
Update `<TICKET>/qa-state.json` per `docs/ai/architecture/qa-artifact-contract.md` and validate
against `docs/ai/architecture/qa-state.schema.json`.
