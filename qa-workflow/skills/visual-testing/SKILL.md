---
name: visual-testing
type: task
version: 1.0
description: Phase 5 — Visual Testing — scaffold stub; authored in the implementation phase.
phase: Phase 5 — Visual Testing
workflow: [qa-implementation-validation]
runsAs: subagent
consumes:
  sources: []
  artifacts: [figma-analysis]
  domains: [marketing]
produces:
  artifacts: [visual-findings]
methodology: docs/ai/visual-testing/CLAUDE_CODE_OPERATOR.md
---

# visual-testing (task skill — scaffold)

> **Scaffold stub.** Thin wrapper; the **how** lives in `docs/ai/visual-testing/CLAUDE_CODE_OPERATOR.md` (source of truth).
> Contract fields above are provisional and validated in the implementation phase.

## Purpose
See `docs/ai/visual-testing/CLAUDE_CODE_OPERATOR.md`. Produces: `visual-findings`.

## Inputs / Outputs
- Consumes (by path): artifacts [figma-analysis]; sources []; domains [marketing].
- Produces: `visual-findings` under `<TICKET>/`; returns `{ artifactPath, status, summary }` to the workflow.

## qa-state
Update `<TICKET>/qa-state.json` per `docs/ai/architecture/qa-artifact-contract.md` and validate
against `docs/ai/architecture/qa-state.schema.json`.
