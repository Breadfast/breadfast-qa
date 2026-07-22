---
name: defect-reporting
type: task
version: 1.0
description: Defect Reporting (QA_PROCESS Phase 6). File Jira bugs — functional and visual Design bugs — with evidence, severity, and priority. Inline (files to Jira).
phase: Defect Reporting
workflow: [qa-implementation-validation]
runsAs: inline
consumes:
  sources: []
  artifacts: [execution, visual-findings]
  domains: []
produces:
  artifacts: [defects]
methodology: docs/ai/bug-reporting.md
---

# defect-reporting (task skill)

> Thin wrapper. The **how** is in [`docs/ai/bug-reporting.md`](../../../docs/ai/bug-reporting.md)
> (severity/priority, Jira template, reclassification, env-limitation template). Do not re-inline.

## Inputs (by path)
`execution` (functional failures + evidence) + `visual-findings` (confirmed Design defects + annotated evidence).

## Steps
1. For each confirmed defect (functional or visual), assign severity/priority per the rubric.
2. File the Jira bug (Atlassian MCP) with the finding record + attach evidence (annotated side-by-side for visual).
3. Link each bug to the story. Group recurring issues (shared component/token) into one bug where appropriate.
4. Write `defects/defects.md` (index of filed bugs with keys, severity, evidence links).

## Guardrail
Filing Jira bugs is an outward action — file per the story process; do not fabricate or duplicate existing bugs.

## Recording
```
node qa-workflow/bin/qa-cli.js record "<storyDir>" defects \
     --path defects/defects.md --generator defect-reporting@1.0 --derive-artifacts execution,visual-findings
```
