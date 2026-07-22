---
name: figma-analysis
type: task
version: 1.0
description: Phase 2 — Figma Analysis — scaffold stub; authored in the implementation phase.
phase: Phase 2 — Figma Analysis
workflow: [qa-shift-left]
runsAs: subagent
consumes:
  sources: [figma]
  artifacts: []
  domains: []
produces:
  artifacts: [figma-analysis]
methodology: docs/ai/testing-process.md
---

# figma-analysis (task skill — scaffold)

> **Scaffold stub.** Thin wrapper; the **how** lives in `docs/ai/testing-process.md` (source of truth).
> Contract fields above are provisional and validated in the implementation phase.

## Purpose
See `docs/ai/testing-process.md`. Produces: `figma-analysis`.

## Inputs / Outputs
- Consumes (by path): artifacts []; sources [figma]; domains [].
- Produces: `figma-analysis` under `<TICKET>/`; returns `{ artifactPath, status, summary }` to the workflow.

## qa-state
Update `<TICKET>/qa-state.json` per `docs/ai/architecture/qa-artifact-contract.md` and validate
against `docs/ai/architecture/qa-state.schema.json`.
