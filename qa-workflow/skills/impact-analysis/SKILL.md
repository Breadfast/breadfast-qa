---
name: impact-analysis
type: task
version: 1.0
description: Impact Analysis — scaffold stub; authored in the implementation phase.
phase: Impact Analysis
workflow: [qa-shift-left]
runsAs: subagent
consumes:
  sources: []
  artifacts: [requirements, figma-analysis]
  domains: []
produces:
  artifacts: [impact]
methodology: docs/ai/regression-strategy.md
---

# impact-analysis (task skill — scaffold)

> **Scaffold stub.** Thin wrapper; the **how** lives in `docs/ai/regression-strategy.md` (source of truth).
> Contract fields above are provisional and validated in the implementation phase.

## Purpose
See `docs/ai/regression-strategy.md`. Produces: `impact`.

## Inputs / Outputs
- Consumes (by path): artifacts [requirements, figma-analysis]; sources []; domains [].
- Produces: `impact` under `<TICKET>/`; returns `{ artifactPath, status, summary }` to the workflow.

## qa-state
Update `<TICKET>/qa-state.json` per `docs/ai/architecture/qa-artifact-contract.md` and validate
against `docs/ai/architecture/qa-state.schema.json`.
