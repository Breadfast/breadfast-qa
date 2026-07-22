---
name: exploratory-testing
type: task
version: 1.0
description: Exploratory Testing (QA_PROCESS Phase 4 / Web+Mobile process). Charter-based exploration of the delivered build to surface risks before/with scripted execution. Inline (drives the app).
phase: Exploratory Testing
workflow: [qa-implementation-validation]
runsAs: inline
consumes:
  sources: []
  artifacts: [requirements, figma-analysis, impact]
  domains: []
produces:
  artifacts: [exploratory-notes]
methodology: docs/ai/exploratory-testing.md
---

# exploratory-testing (task skill)

> Thin wrapper. The **how** is in [`docs/ai/exploratory-testing.md`](../../../docs/ai/exploratory-testing.md)
> (charters, failure-pattern heuristics, fragile flows, timing). Do not re-inline methodology.

## Inputs (by path)
`requirements` · `figma-analysis` · `impact` (for risk hot-spots) + the running app (web/mobile).

## Steps
1. Derive charters from impact/regression areas and figma gaps.
2. Explore; log observations, anomalies, and candidate defects with repro notes.
3. Write `evidence/exploratory-notes.md`; feed findings into `test-design` (Phase B) and defects.

## Recording
```
node qa-workflow/bin/qa-cli.js record "<storyDir>" exploratory-notes \
     --path evidence/exploratory-notes.md --generator exploratory-testing@1.0 \
     --derive-artifacts requirements,figma-analysis,impact
```
Returns `{ artifactPath, charters, findings }` (compact).
