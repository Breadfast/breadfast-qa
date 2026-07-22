---
name: story-analysis
type: task
version: 1.0
description: Phase 1 — Requirements Analysis — scaffold stub; authored in the implementation phase.
phase: Phase 1 — Requirements Analysis
workflow: [qa-shift-left]
runsAs: subagent
consumes:
  sources: [jira]
  artifacts: []
  domains: [card, payment]
produces:
  artifacts: [requirements]
methodology: docs/ai/QA_PROCESS.md
---

# story-analysis (task skill — scaffold)

> **Scaffold stub.** Thin wrapper; the **how** lives in `docs/ai/QA_PROCESS.md` (source of truth).
> Contract fields above are provisional and validated in the implementation phase.

## Purpose
See `docs/ai/QA_PROCESS.md`. Produces: `requirements`.

## Inputs / Outputs
- Consumes (by path): artifacts []; sources [jira]; domains [card, payment].
- Produces: `requirements` under `<TICKET>/`; returns `{ artifactPath, status, summary }` to the workflow.

## qa-state
Update `<TICKET>/qa-state.json` per `docs/ai/architecture/qa-artifact-contract.md` and validate
against `docs/ai/architecture/qa-state.schema.json`.
