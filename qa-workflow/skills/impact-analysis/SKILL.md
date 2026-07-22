---
name: impact-analysis
type: task
version: 1.0
description: Impact Analysis (QA_PROCESS / CLAUDE.md STEP 4). Produce Impacted / Regression / Smoke / Automation areas from requirements + figma-analysis. Runs as a subagent in qa-shift-left.
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

# impact-analysis (task skill)

> Thin wrapper. The **how** is in [`docs/ai/regression-strategy.md`](../../../docs/ai/regression-strategy.md) §1
> and `CLAUDE.md` §2 STEP 4. Do not re-inline methodology.

## Purpose
Determine the blast radius of the change and the regression/smoke/automation scope.

## Inputs (by path — reused, not regenerated)
- `<storyDir>/requirements-analysis/requirements.md`
- `<storyDir>/figma-analysis/analysis.md`

## Steps (per methodology)
1. Read the requirements + figma-analysis artifacts.
2. Produce: **Impacted Areas · Regression Areas · Smoke Coverage · Automation Impact.**
3. Write **`impact-analysis/impact.md`**.

## Output & recording
- Writes: `<storyDir>/impact-analysis/impact.md`.
- Return: `{ artifactPath, regressionAreaCount, summary }`.
- Recorded with provenance from its upstream artifacts:
  ```
  node qa-workflow/bin/qa-cli.js record "<storyDir>" impact \
       --path impact-analysis/impact.md --generator impact-analysis@1.0 \
       --derive-artifacts requirements,figma-analysis
  ```
