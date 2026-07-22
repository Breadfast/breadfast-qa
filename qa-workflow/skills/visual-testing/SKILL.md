---
name: visual-testing
type: task
version: 1.0
description: Visual Testing (QA_PROCESS Phase 5). Compare each actual screen to its Figma design, apply the dynamic-vs-defect rules, and produce annotated Design-Bug evidence. Runs as a subagent.
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

# visual-testing (task skill)

> Thin wrapper. The **how** is the operator playbook
> [`docs/ai/visual-testing/CLAUDE_CODE_OPERATOR.md`](../../../docs/ai/visual-testing/CLAUDE_CODE_OPERATOR.md)
> (identify → pair → re-baseline → reconstruct → compare 18 dimensions → **dynamic-vs-defect exclusion
> rules** → finding schema → group → annotated evidence → Design Bug). Do not re-inline it.

## Inputs (by path)
`figma-analysis` (Expected frames + analysis) + captured screenshots from Execution.

## Steps (per playbook)
1. Per screen: pair Expected (Figma) ↔ Actual; re-baseline to the correct design version; reconstruct multi-image screens.
2. Compare across all dimensions; **classify each difference as DEFECT vs DYNAMIC DATA / STATE** (exclude the latter).
3. Record confirmed findings (Component · Category · Severity · Expected · Actual · Root Cause · Recommendation); group recurring.
4. Generate annotated side-by-side evidence via `automation/helpers/VisualComparisonHelper.js`
   (`compareScreenWithFindings` → red-annotated PNGs for Jira). Only confirmed defects are annotated.
5. Write `evidence/visual-findings.md` (+ evidence files).

## Recording
```
node qa-workflow/bin/qa-cli.js record "<storyDir>" visual-findings \
     --path evidence/visual-findings.md --generator visual-testing@1.0 \
     --derive-artifacts figma-analysis --domains marketing
```
Returns `{ screens, confirmedDefects, excludedStateDiffs }` (compact).
