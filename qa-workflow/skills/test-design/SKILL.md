---
name: test-design
type: task
version: 1.0
description: HLS + Test Case Generation — scaffold stub; authored in the implementation phase.
phase: HLS + Test Case Generation
workflow: [qa-shift-left, qa-implementation-validation]
runsAs: subagent
consumes:
  sources: []
  artifacts: [requirements, figma-analysis, impact, clarifications]
  domains: [card, payment, marketing]
produces:
  artifacts: [hls, testcases]
methodology: docs/ai/testing-process.md
---

# test-design (task skill — scaffold)

> **Scaffold stub.** Thin wrapper; the **how** lives in `docs/ai/testing-process.md` (source of truth).
> Contract fields above are provisional and validated in the implementation phase.

## Purpose
See `docs/ai/testing-process.md`. Produces: `hls, testcases`.

## Inputs / Outputs
- Consumes (by path): artifacts [requirements, figma-analysis, impact, clarifications]; sources []; domains [card, payment, marketing].
- Produces: `hls, testcases` under `<TICKET>/`; returns `{ artifactPath, status, summary }` to the workflow.

## qa-state
Update `<TICKET>/qa-state.json` per `docs/ai/architecture/qa-artifact-contract.md` and validate
against `docs/ai/architecture/qa-state.schema.json`.
